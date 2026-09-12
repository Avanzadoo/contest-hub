'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const USER_FILE = path.join(DATA_DIR, 'user.json');
const LIVE_FILE = path.join(DATA_DIR, 'live.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

const state = {
  seed: readJson(SEED_FILE, { items: [] }).items || [],
  user: readJson(USER_FILE, { items: [] }).items || [],
  live: readJson(LIVE_FILE, { items: [], sources: [] }),
  firstSeen: readJson(LIVE_FILE, { firstSeen: {} }).firstSeen || {},
  updatedAt: Date.now(),
  nextRefreshAt: Date.now() + 15 * 60 * 1000,
  refreshing: false,
};

function normalize(item, source) {
  return {
    id: item.id || `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: item.name || '未命名赛事',
    alias: item.alias || '',
    organizer: item.organizer || '',
    organizerType: item.organizerType || 'other',
    region: item.region || 'cn',
    field: item.field || 'other',
    tier: Number(item.tier) || 3,
    hasCashPrize: item.hasCashPrize === null ? null : Boolean(item.hasCashPrize),
    prizeAmount: Number(item.prizeAmount) || 0,
    prizeText: item.prizeText || '',
    deadline: item.deadline || null,
    deadlineNote: item.deadlineNote || '',
    cycle: item.cycle || '',
    eligibility: item.eligibility || '',
    summary: item.summary || '',
    url: item.url,
    extraUrl: item.extraUrl || '',
    image: item.image || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    source: item.source || source || 'curated',
    sourceLabel: item.sourceLabel || (source === 'user' ? '手动添加' : '精选收录'),
    addedAt: item.addedAt || Date.now(),
  };
}

function statusOf(c) {
  if (!c.deadline) return 'ongoing';
  const d = new Date(`${c.deadline}T23:59:59+08:00`).getTime();
  if (!Number.isFinite(d)) return 'ongoing';
  const diff = d - Date.now();
  if (diff < 0) return 'closed';
  if (diff < 14 * 86400000) return 'urgent';
  return 'open';
}

function daysLeft(c) {
  if (!c.deadline) return null;
  const d = new Date(`${c.deadline}T23:59:59+08:00`).getTime();
  if (!Number.isFinite(d)) return null;
  return Math.ceil((d - Date.now()) / 86400000);
}

function decorate(c) {
  return { ...c, status: statusOf(c), daysLeft: daysLeft(c) };
}

/** 归一化赛事名，用于判断自动抓取项与精选库是否同一场比赛 */
function normName(s) {
  return String(s || '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/20\d{2}\s*年?/g, '')
    .replace(/第[一二三四五六七八九十百\d]+届/g, '')
    .replace(/[!！,，。.、:：\s"'“”‘’·\-—_/|]/g, '')
    .toLowerCase();
}

/** 自动抓取到的条目若与精选库重复，保留精选库的官方地址 */
function dedupeByCurated(merged) {
  const curatedNames = merged
    .filter((i) => i.source === 'curated')
    .map((i) => normName(i.name))
    .filter((n) => n.length >= 4);

  return merged.filter((item) => {
    if (item.source === 'curated' || item.source === 'user') return true;
    const n = normName(item.name);
    if (n.length < 4) return true;
    return !curatedNames.some((cn) => cn.includes(n) || n.includes(cn));
  });
}

function all() {
  const merged = [
    ...state.seed.map((i) => normalize(i, 'curated')),
    ...state.live.items.map((i) => normalize(i, i.source || 'live')),
    ...state.user.map((i) => normalize(i, 'user')),
  ];

  const seen = new Set();
  const list = [];
  for (const item of dedupeByCurated(merged)) {
    if (!item.url) continue;
    const key = item.id || item.url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // 首次出现时间：用于「新收录」标记
    if (!state.firstSeen[key]) state.firstSeen[key] = Date.now();
    // 精选库与手动添加的条目不算「新收录」，只有自动抓取到的才算
    const auto = item.source !== 'curated' && item.source !== 'user';
    const isNew = auto && Date.now() - state.firstSeen[key] < 24 * 3600 * 1000;
    list.push(decorate({ ...item, firstSeenAt: state.firstSeen[key], isNew }));
  }
  return list;
}

function stats(items) {
  const s = {
    total: items.length,
    cn: 0,
    intl: 0,
    withPrize: 0,
    live: 0,
    user: 0,
    urgent: 0,
    open: 0,
    totalPrize: 0,
    byField: {},
    byOrganizer: {},
  };
  for (const c of items) {
    if (c.region === 'intl') s.intl++;
    else s.cn++;
    if (c.hasCashPrize === true) s.withPrize++;
    if (c.source === 'user') s.user++;
    if (c.source !== 'curated' && c.source !== 'user') s.live++;
    if (c.status === 'urgent') s.urgent++;
    if (c.status === 'open' || c.status === 'urgent') s.open++;
    s.totalPrize += c.prizeAmount || 0;
    s.byField[c.field] = (s.byField[c.field] || 0) + 1;
    s.byOrganizer[c.organizerType] = (s.byOrganizer[c.organizerType] || 0) + 1;
  }
  return s;
}

async function refreshLive(sources) {
  if (state.refreshing) return null;
  state.refreshing = true;
  const reports = [];
  const collected = [];
  try {
    const results = await Promise.all(
      Object.entries(sources).map(async ([key, mod]) => {
        try {
          return await mod.fetch();
        } catch (e) {
          return { source: key, ok: false, count: 0, error: e.message, items: [], label: key };
        }
      })
    );
    for (const r of results) {
      reports.push({
        source: r.source,
        label: r.label || r.source,
        ok: r.ok,
        count: r.count || 0,
        ms: r.ms || 0,
        error: r.error || null,
      });
      if (r.ok && Array.isArray(r.items)) {
        const fn = modMap[r.source];
        for (const raw of r.items) collected.push(fn ? fn(raw) : raw);
      }
    }
    if (collected.length) {
      state.live = { items: collected, savedAt: Date.now(), firstSeen: state.firstSeen };
      writeJson(LIVE_FILE, state.live);
    }
    state.updatedAt = Date.now();
    state.sources = reports;
    return reports;
  } finally {
    state.refreshing = false;
  }
}

// 源 → 原始对象映射函数
const modMap = {};

function registerMapper(name, fn) {
  modMap[name] = fn;
}

function addUser(item) {
  const norm = normalize({ ...item, source: 'user', addedAt: Date.now() }, 'user');
  if (!norm.url || !/^https?:\/\//i.test(norm.url)) throw new Error('缺少合法的官网地址');
  if (!norm.name) throw new Error('缺少赛事名称');
  // 填了奖金金额就视为有现金奖，避免手动添加时漏勾
  if (norm.prizeAmount > 0) norm.hasCashPrize = true;
  norm.id = norm.id.startsWith('user-') ? norm.id : `user-${norm.id}`;
  state.user.push(norm);
  writeJson(USER_FILE, { items: state.user });
  return norm;
}

function removeUser(id) {
  const before = state.user.length;
  state.user = state.user.filter((i) => i.id !== id);
  if (state.user.length !== before) {
    writeJson(USER_FILE, { items: state.user });
    return true;
  }
  return false;
}

function seedSources(list) {
  if (list) {
    state.sources = list;
  }
  return state.sources || [];
}

module.exports = {
  state,
  all,
  stats,
  refreshLive,
  registerMapper,
  addUser,
  removeUser,
  seedSources,
  writeJson,
};
