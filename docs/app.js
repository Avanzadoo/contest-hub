'use strict';

/* ============ 常量与字典 ============ */
const LABEL = {
  region: { cn: '国内', intl: '国际' },
  organizerType: {
    gov: '政府 / 部委',
    university: '高校 / 教指委',
    company: '企业主办',
    org: '学会 / 机构',
    intlorg: '国际组织',
    community: '社区 / 平台',
    other: '其他',
  },
  field: {
    entrepreneurship: '创新创业',
    ai: 'AI / 算法',
    data: '数据科学',
    math: '数学建模',
    language: '外语 / 演讲',
    bio: '生科 / 医学',
    business: '金融 / 商科',
    design: '设计 / 创意',
    engineering: '工程技术',
    tech: '科技 / 公益',
    science: '科研',
    algorithm: '算法 / 编程',
    hackathon: '黑客松',
    law: '法学 / 辩论',
    comprehensive: '综合',
    other: '其他',
  },
  status: { ongoing: '常年 / 滚动', open: '报名中', urgent: '即将截止', closed: '已截止' },
};

const FILTER_GROUPS = [
  { key: 'region', title: '地域', items: [{ v: 'all', l: '全部' }, { v: 'cn', l: '国内' }, { v: 'intl', l: '国际' }] },
  {
    key: 'organizerType',
    title: '主办方',
    items: [
      { v: 'all', l: '全部' },
      { v: 'gov', l: '政府/部委' },
      { v: 'university', l: '高校/教指委' },
      { v: 'company', l: '企业' },
      { v: 'org', l: '学会/机构' },
      { v: 'intlorg', l: '国际组织' },
      { v: 'community', l: '社区/平台' },
    ],
  },
  {
    key: 'prize',
    title: '奖金',
    items: [
      { v: 'all', l: '全部' },
      { v: 'any', l: '有现金奖' },
      { v: 'w1', l: '≥1 万' },
      { v: 'w10', l: '≥10 万' },
      { v: 'w100', l: '≥100 万' },
    ],
  },
  {
    key: 'source',
    title: '数据来源',
    items: [
      { v: 'all', l: '全部' },
      { v: 'curated', l: '精选收录' },
      { v: 'live', l: '实时抓取' },
      { v: 'user', l: '我添加的' },
    ],
  },
  {
    key: 'status',
    title: '状态',
    items: [
      { v: 'all', l: '全部' },
      { v: 'open', l: '报名中' },
      { v: 'urgent', l: '14 天内截止' },
      { v: 'ongoing', l: '常年/滚动' },
      { v: 'closed', l: '已截止' },
    ],
  },
  {
    key: 'field',
    title: '领域',
    items: [
      { v: 'all', l: '全部' },
      { v: 'entrepreneurship', l: '创新创业' },
      { v: 'ai', l: 'AI/算法' },
      { v: 'data', l: '数据科学' },
      { v: 'math', l: '数学建模' },
      { v: 'algorithm', l: '算法/编程' },
      { v: 'hackathon', l: '黑客松' },
      { v: 'language', l: '外语/演讲' },
      { v: 'bio', l: '生科/医学' },
      { v: 'business', l: '金融/商科' },
      { v: 'design', l: '设计/创意' },
      { v: 'engineering', l: '工程技术' },
      { v: 'tech', l: '科技/公益' },
      { v: 'law', l: '法学/辩论' },
      { v: 'comprehensive', l: '综合' },
    ],
  },
];

/* ============ 状态 ============ */
const state = {
  items: [],
  stats: {},
  filters: { region: 'all', organizerType: 'all', field: 'all', prize: 'all', status: 'all', source: 'all' },
  q: '',
  sort: 'deadline',
  favOnly: false,
  knownIds: new Set(),
  mode: 'snapshot', // server | snapshot
  extraItems: [], // 浏览器端实时抓取到的赛事
  liveReport: [],
  nextRefreshAt: 0,
  updatedAt: 0,
  lastFetch: 0,
};

// file:// 或隐私模式下 localStorage 可能不可用，做安全封装
const LS = (() => {
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    return localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k),
    };
  }
})();

const FAV_KEY = 'contest-hub-fav';
const USER_KEY = 'contest-hub-user';
const fav = new Set(JSON.parse(LS.getItem(FAV_KEY) || '[]'));
const saveFav = () => LS.setItem(FAV_KEY, JSON.stringify([...fav]));
const getLocalUser = () => JSON.parse(LS.getItem(USER_KEY) || '[]');
const addLocalUser = (item) => {
  const arr = getLocalUser();
  arr.push({ ...item, id: `user-${Date.now()}`, source: 'user', sourceLabel: '手动添加', addedAt: Date.now() });
  LS.setItem(USER_KEY, JSON.stringify(arr));
};

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============ 工具 ============ */
function fmtMoney(n) {
  if (!n) return '';
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿元`;
  if (n >= 10000) return `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1)} 万元`;
  return `${n} 元`;
}

function countdownText(c) {
  if (c.status === 'closed') return '<span style="color:var(--muted)">已截止</span>';
  if (c.status === 'ongoing') return '<span>常年 / 滚动开放</span>';
  const target = new Date(`${c.deadline}T23:59:59+08:00`).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return '<span style="color:var(--muted)">已截止</span>';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const color = d < 7 ? 'var(--red)' : d < 30 ? 'var(--amber)' : 'var(--text)';
  const txt = d > 0 ? `${d} 天 ${h} 小时` : `${h} 小时 ${m} 分 ${s} 秒`;
  return `<span class="d-num" style="color:${color}">${txt}</span>`;
}

function tierText(t) {
  const n = Number(t) || 3;
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function relativeTime(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return `${Math.floor(s / 3600)} 小时前`;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

/* ============ 渲染 ============ */
function renderFilters() {
  $('#filterGroups').innerHTML = FILTER_GROUPS.map(
    (g) => `
    <div class="fgroup">
      <h3>${g.title}</h3>
      <div class="chips">${g.items
        .map(
          (i) =>
            `<button class="chip ${state.filters[g.key] === i.v ? 'on' : ''}" data-key="${g.key}" data-v="${i.v}">${i.l}</button>`
        )
        .join('')}</div>
    </div>`
  ).join('');

  document.querySelectorAll('.chip').forEach((btn) => {
    btn.onclick = () => {
      state.filters[btn.dataset.key] = btn.dataset.v;
      renderFilters();
      fetchData();
    };
  });
  $('#favCount').textContent = fav.size;
}

function renderStats(s) {
  const cards = [
    { l: '收录赛事总数', v: s.total, cls: '' },
    { l: '国内赛事', v: s.cn, cls: '' },
    { l: '国际赛事', v: s.intl, cls: 'blue' },
    { l: '有现金奖', v: s.withPrize, cls: 'accent' },
    { l: '报名中 / 常年开放', v: s.open, cls: 'green' },
    { l: '14 天内截止', v: s.urgent, cls: 'accent' },
    { l: '自动抓取实时更新', v: s.live, cls: 'blue' },
    { l: '手动添加', v: s.user, cls: '' },
  ];
  $('#stats').innerHTML = cards
    .map((c) => `<div class="stat ${c.cls}"><b>${c.v}</b><span>${c.l}</span></div>`)
    .join('');
}

/** 删除自己添加的比赛（服务端模式走接口，离线模式改本地存储） */
async function removeItem(id) {
  const c = state.items.find((x) => x.id === id);
  if (!c || !confirm(`确定删除「${c.name}」？此操作只影响你手动添加的比赛。`)) return;
  try {
    if (state.mode === 'server') {
      const res = await fetch(`/api/competitions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!d.ok) throw new Error('删除失败');
    } else {
      const arr = getLocalUser().filter((x) => x.id !== id);
      LS.setItem(USER_KEY, JSON.stringify(arr));
    }
    state.knownIds.delete(id);
    toast('已删除');
    fetchData();
  } catch (e) {
    toast(e.message || '删除失败');
  }
}

function renderSources(sources) {
  const el = $('#sourceBar');
  if (!sources || !sources.length) {
    el.innerHTML =
      '<span class="src-pill"><span class="led" style="background:var(--amber)"></span>' +
      '离线快照：数据是上次生成时的内容 · 运行 <b>start.bat</b> 后会每 15 分钟自动抓取更新</span>';
    return;
  }
  el.innerHTML = sources
    .map(
      (s) =>
        `<span class="src-pill ${s.ok ? '' : 'bad'}"><span class="led"></span>` +
        `自动源 <b>${esc(s.label)}</b>：${s.ok ? `<b>${s.count}</b> 条` : '抓取失败'}` +
        `<span class="meta">${s.ok ? s.ms + 'ms' : esc(s.error || '')}</span></span>`
    )
    .join('');

  // 云端定时更新说明（GitHub Actions 每 30 分钟重新抓取，页面每 3 分钟自动取新版）
  if (state.mode !== 'server') {
    el.innerHTML +=
      '<span class="src-pill"><span class="led"></span>云端自动更新：<b>每 30 分钟</b>' +
      '<span class="meta">由 GitHub Actions 抓取，页面自动获取最新版</span></span>';
  }

  // 手动触发过的浏览器实时抓取结果
  if (state.liveReport && state.liveReport.length) {
    el.innerHTML += state.liveReport
      .map(
        (r) =>
          `<span class="src-pill ${r.ok ? '' : 'bad'}"><span class="led"></span>` +
          `浏览器实时 <b>${esc(r.label)}</b>：${r.ok ? `<b>${r.count}</b> 条（${esc(r.proxy || '')}）` : '代理不可用'}` +
          `<span class="meta">${r.ok ? r.ms + 'ms' : esc(r.error || '')}</span></span>`
      )
      .join('');
  }
}

function renderGrid() {
  const list = state.items;
  $('#countNum').textContent = list.length;
  $('#empty').hidden = list.length > 0;

  $('#grid').innerHTML = list
    .map((c) => {
      const prizeCls = c.hasCashPrize ? '' : 'none';
      const prizeTxt = c.hasCashPrize
        ? `💰 ${esc(c.prizeText || '设奖金')}${c.prizeAmount ? ' · 约 ' + fmtMoney(c.prizeAmount) : ''}`
        : c.hasCashPrize === null
        ? '🎁 奖池以官网为准'
        : '📜 以荣誉 / 证书为主';

      return `
      <article class="card ${c.isNew ? 'is-new' : ''}" data-id="${esc(c.id)}">
        <div class="card-head">
          <div>
            <h3>${esc(c.name)}</h3>
            ${c.alias ? `<div class="alias">${esc(c.alias)}</div>` : ''}
          </div>
          <button class="fav ${fav.has(c.id) ? 'on' : ''}" data-fav="${esc(c.id)}" title="收藏">${fav.has(c.id) ? '★' : '☆'}</button>
        </div>
        <div class="badges">
          <span class="badge region-${esc(c.region)}">${LABEL.region[c.region] || '国内'}</span>
          <span class="badge type">${LABEL.organizerType[c.organizerType] || '其他'}</span>
          <span class="badge field">${LABEL.field[c.field] || '其他'}</span>
          <span class="badge tier">${tierText(c.tier)} 含金量</span>
        </div>
        <p class="prize ${prizeCls}">${prizeTxt}</p>
        <p class="summary">${esc(c.summary || '暂无简介')}</p>
        <div class="meta-row">
          <span class="deadline" data-cd="${esc(c.deadline || '')}" data-status="${c.status}">⏳ ${countdownText(c)}</span>
          <span>🏢 ${esc(c.organizer || '—')}</span>
        </div>
        <div class="tag-list">${(c.tags || []).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="card-actions">
          <button class="btn btn-ghost" data-detail="${esc(c.id)}">详情</button>
          <a class="btn btn-primary" href="${esc(c.url)}" target="_blank" rel="noopener">↗ 原地址</a>
          ${c.source === 'user' ? `<button class="btn btn-del" data-del="${esc(c.id)}" title="删除我添加的比赛">✕</button>` : ''}
        </div>
      </article>`;
    })
    .join('');

  document.querySelectorAll('[data-detail]').forEach((b) => (b.onclick = () => openDrawer(b.dataset.detail)));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => removeItem(b.dataset.del)));
  document.querySelectorAll('[data-fav]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.fav;
      if (fav.has(id)) fav.delete(id);
      else fav.add(id);
      saveFav();
      renderGrid();
      renderFilters();
    };
  });
}

function openDrawer(id) {
  const c = state.items.find((x) => x.id === id);
  if (!c) return;
  $('#dRegion').textContent = LABEL.region[c.region] || '国内';
  $('#dRegion').className = `badge region-${c.region}`;
  $('#dType').textContent = LABEL.organizerType[c.organizerType] || '其他';
  $('#dType').className = 'badge type';
  $('#dField').textContent = LABEL.field[c.field] || '其他';
  $('#dField').className = 'badge field';
  $('#dName').textContent = c.name;
  $('#dAlias').textContent = c.alias || '';

  $('#dGrid').innerHTML = `
    <div class="d-cell"><span>含金量</span><b style="color:var(--amber)">${tierText(c.tier)}</b></div>
    <div class="d-cell"><span>奖金规模</span><b>${c.hasCashPrize ? fmtMoney(c.prizeAmount) || '设奖金' : c.hasCashPrize === null ? '未公开' : '无现金奖'}</b></div>
    <div class="d-cell"><span>截止状态</span><b>${LABEL.status[c.status] || '—'}</b></div>
    <div class="d-cell"><span>赛事周期</span><b>${esc(c.cycle || '—')}</b></div>`;

  $('#dSummary').textContent = c.summary || '暂无简介';
  $('#dPrize').textContent = c.prizeText || '以官网公布为准';
  $('#dDeadline').innerHTML = `${c.deadline ? c.deadline : '—'}　${c.deadlineNote ? '（' + esc(c.deadlineNote) + '）' : ''}`;
  $('#dEligibility').textContent = c.eligibility || '以官网公布为准';
  $('#dTags').innerHTML = (c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  $('#dUrl').href = c.url;
  const u2 = $('#dUrl2');
  if (c.extraUrl) { u2.href = c.extraUrl; u2.hidden = false; } else { u2.hidden = true; }
  $('#dFav').textContent = fav.has(c.id) ? '★ 已收藏' : '☆ 收藏';
  $('#dFav').onclick = () => {
    if (fav.has(c.id)) fav.delete(c.id); else fav.add(c.id);
    saveFav(); $('#dFav').textContent = fav.has(c.id) ? '★ 已收藏' : '☆ 收藏';
    renderGrid(); renderFilters();
  };
  $('#dCopy').onclick = () => {
    navigator.clipboard?.writeText(c.url).then(() => toast('已复制官网链接'), () => toast('复制失败，请手动复制'));
  };
  $('#dSource').textContent = `数据来源：${c.sourceLabel || '精选收录'}｜主办：${c.organizer || '—'}｜原地址：${c.url}`;

  $('#drawer').hidden = false;
  $('#drawerMask').hidden = false;
}

function closeDrawer() { $('#drawer').hidden = true; $('#drawerMask').hidden = true; }

/* ============ 数据 ============ */
function decorateLocal(c) {
  if (!c.deadline) return { ...c, status: 'ongoing', daysLeft: null };
  const t = new Date(`${c.deadline}T23:59:59+08:00`).getTime();
  if (!Number.isFinite(t)) return { ...c, status: 'ongoing', daysLeft: null };
  const diff = t - Date.now();
  const daysLeft = Math.ceil(diff / 86400000);
  const status = diff < 0 ? 'closed' : diff < 14 * 86400000 ? 'urgent' : 'open';
  return { ...c, status, daysLeft };
}

/** 归一化赛事名，用于去重（去掉年份、届次、标点） */
function normName(s) {
  return String(s || '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/20\d{2}\s*年?/g, '')
    .replace(/第[一二三四五六七八九十百\d]+届/g, '')
    .replace(/[!！,，。.、:：\s"'“”‘’·\-—_/|【】]/g, '')
    .toLowerCase();
}

/** 无后端时的离线快照兜底（双击 index.html / 静态部署） */
function applyLocal(list) {
  const f = state.filters;
  let out = list.map(decorateLocal);

  // 去重：同一 id/url 只保留一条；与精选库同名的自动抓取项让位给官方地址
  const curatedNames = out.filter((c) => c.source === 'curated').map((c) => normName(c.name)).filter((n) => n.length >= 4);
  const seen = new Set();
  out = out.filter((c) => {
    const key = c.id || c.url;
    if (seen.has(key)) return false;
    seen.add(key);
    if (c.source !== 'curated' && c.source !== 'user') {
      const n = normName(c.name);
      if (n.length >= 4 && curatedNames.some((cn) => cn.includes(n) || n.includes(cn))) return false;
    }
    return true;
  });

  if (f.region !== 'all') out = out.filter((c) => c.region === f.region);
  if (f.organizerType !== 'all') out = out.filter((c) => c.organizerType === f.organizerType);
  if (f.field !== 'all') out = out.filter((c) => c.field === f.field);
  if (f.status !== 'all') out = out.filter((c) => c.status === f.status);
  if (f.prize !== 'all') {
    const th = { any: 1, w1: 10000, w10: 100000, w100: 1000000 }[f.prize] || 1;
    out = out.filter((c) => c.hasCashPrize === true && c.prizeAmount >= th);
  }
  if (f.source !== 'all') {
    if (f.source === 'live') out = out.filter((c) => c.source === 'mlh');
    else if (f.source === 'user') out = out.filter((c) => c.source === 'user');
    else out = out.filter((c) => c.source !== 'mlh' && c.source !== 'user');
  }
  if (state.q) {
    const kw = state.q.toLowerCase();
    out = out.filter((c) =>
      [c.name, c.alias, c.organizer, c.summary, c.prizeText, c.eligibility, (c.tags || []).join(' ')]
        .filter(Boolean).join(' ').toLowerCase().includes(kw)
    );
  }
  if (state.favOnly) out = out.filter((c) => fav.has(c.id));
  const cmp = {
    deadline: (a, b) => {
      const ax = a.deadline ? Date.parse(a.deadline) : Infinity;
      const bx = b.deadline ? Date.parse(b.deadline) : Infinity;
      return ax !== bx ? ax - bx : b.tier - a.tier;
    },
    prize: (a, b) => b.prizeAmount - a.prizeAmount || b.tier - a.tier,
    tier: (a, b) => b.tier - a.tier || b.prizeAmount - a.prizeAmount,
    updated: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
  }[state.sort] || ((a, b) => b.tier - a.tier);

  state.items = [...out].sort(cmp);
  const raw = (window.__SNAPSHOT__?.items || []).map(decorateLocal);
  state.stats = localStats(raw);
  state.mode = 'snapshot';
  renderStats(state.stats);
  renderSources(window.__SNAPSHOT__?.sources);
  renderGrid();
  $('#syncDot').className = 'dot';
  $('#syncText').innerHTML =
    `离线快照模式（数据 ${relativeTime(window.__SNAPSHOT__?.updatedAt)}生成）· ` +
    `运行 <b>start.bat</b> 开启自动更新`;
}

/** 重载当前数据源（快照 / 浏览器实时抓取 / 手动添加 合并） */
function reloadLocal() {
  if (!window.__SNAPSHOT__) return;
  applyLocal([...(window.__SNAPSHOT__.items || []), ...state.extraItems, ...getLocalUser()]);
}

/**
 * 静态站真正的「实时更新」：GitHub Actions 会把最新的 snapshot.js 提交到仓库，
 * 页面每隔几分钟重新拉一次这个文件，只要有新版本就自动换上并提示。
 * 这样无需后端、无需代理，数据一样能持续刷新。
 */
async function pollSnapshot() {
  if (state.mode === 'server') return;
  try {
    const res = await fetch(`snapshot.js?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const txt = (await res.text()).trim();
    const m = /window\.__SNAPSHOT__=(\{[\s\S]*\});?$/.exec(txt);
    if (!m) return;
    const payload = JSON.parse(m[1]);
    const prev = window.__SNAPSHOT__;
    if (!prev) {
      window.__SNAPSHOT__ = payload;
      reloadLocal();
      return;
    }
    if (payload.updatedAt > prev.updatedAt) {
      const before = prev.items.length;
      window.__SNAPSHOT__ = payload;
      reloadLocal();
      renderSources(payload.sources);
      const diff = payload.items.length - before;
      toast(`数据已更新：${payload.items.length} 条${diff > 0 ? `（新增 ${diff} 条）` : ''}`);
    }
  } catch (e) {
    /* 离线或文件被缓存，忽略，等下一轮 */
  }
}

/** 浏览器端实时抓取：静态站没有后端，靠公开 CORS 代理直连源站（默认不自动跑，点刷新才试） */
async function maybeBrowserLive(force) {
  if (!window.LiveFetch || state.mode === 'server') return;
  const dot = $('#syncDot');
  if (force) dot.className = 'dot busy';
  try {
    const r = await window.LiveFetch.run(force);
    state.extraItems = r.items || [];
    state.liveReport = r.report || [];
    if (state.extraItems.length) {
      const before = state.knownIds.size;
      reloadLocal();
      if (force) toast(`浏览器实时抓取成功：${state.extraItems.length} 条最新赛事`);
      else if (before && state.extraItems.some((i) => !state.knownIds.has(i.id))) toast('已抓取到新的赛事');
    }
  } catch (e) {
    if (force) toast('实时抓取失败：当前网络无法访问公开代理');
  }
  renderSources(window.__SNAPSHOT__?.sources);
  dot.className = 'dot';
}

function localStats(items) {
  const s = { total: items.length, cn: 0, intl: 0, withPrize: 0, live: 0, user: 0, urgent: 0, open: 0 };
  for (const c of items) {
    if (c.region === 'intl') s.intl++; else s.cn++;
    if (c.hasCashPrize === true) s.withPrize++;
    if (c.source === 'user') s.user++;
    if (c.source !== 'curated' && c.source !== 'user') s.live++;
    if (c.status === 'urgent') s.urgent++;
    if (c.status === 'open' || c.status === 'urgent') s.open++;
  }
  return s;
}

async function fetchData() {
  if (location.protocol === 'file:' || !navigator.onLine) {
    if (window.__SNAPSHOT__) return applyLocal([...(window.__SNAPSHOT__.items || []), ...getLocalUser()]);
  }
  const p = new URLSearchParams({
    region: state.filters.region,
    organizer: state.filters.organizerType,
    field: state.filters.field,
    prize: state.filters.prize,
    status: state.filters.status,
    source: state.filters.source,
    q: state.q,
    sort: state.sort,
  });
  try {
    const res = await fetch(`/api/competitions?${p}`);
    const data = await res.json();
    if (!data.ok) throw new Error('接口异常');

    let list = data.items;
    if (state.favOnly) list = list.filter((c) => fav.has(c.id));

    const incoming = list.filter((c) => c.id);
    // 首次加载只登记，不提示；之后出现的新 id 才提示
    const fresh = state.knownIds.size ? incoming.filter((c) => !state.knownIds.has(c.id) && c.isNew) : [];
    incoming.forEach((c) => state.knownIds.add(c.id));

    state.items = list;
    state.stats = data.stats;
    state.mode = 'server';
    state.updatedAt = data.updatedAt;
    state.nextRefreshAt = data.nextRefreshAt;
    state.lastFetch = Date.now();

    renderStats(data.stats);
    renderSources(data.sources);
    renderGrid();
    updateSync();
    if (fresh.length) toast(`自动更新：新收录 ${fresh.length} 场比赛`);
  } catch (e) {
    if (window.__SNAPSHOT__) {
      applyLocal([...(window.__SNAPSHOT__.items || []), ...getLocalUser()]);
      return;
    }
    $('#syncDot').className = 'dot err';
    $('#syncText').textContent = '数据拉取失败，重试中…';
    $('#grid').innerHTML =
      '<div class="empty"><p>数据加载失败：既连不上本地服务，也没有可用快照。</p>' +
      '<p style="font-size:12px">请在项目目录运行 <b>start.bat</b> 或 <b>node server.js</b> 后刷新页面。</p></div>';
  }
}

async function refreshLive() {
  $('#syncDot').className = 'dot busy';
  $('#syncText').textContent = '正在拉取实时数据源…';
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    const ok = (data.sources || []).filter((s) => s.ok).length;
    toast(ok ? `实时源已更新（${ok} 个源成功）` : '实时源抓取失败，已保留上次缓存');
    await fetchData();
  } catch {
    if (state.mode === 'server') {
      toast('刷新失败');
      updateSync();
      return;
    }
    // 静态站：改走浏览器端实时抓取
    await maybeBrowserLive(true);
  }
}

function updateSync() {
  const el = $('#syncText');
  if (state.mode === 'snapshot') {
    const snapTime = relativeTime(window.__SNAPSHOT__?.updatedAt);
    const extra = state.extraItems.length ? ` · 浏览器实时 ${state.extraItems.length} 条` : '';
    el.textContent = `云端自动更新（每 30 分钟）· 数据 ${snapTime}生成${extra} · 页面每 3 分钟自动检查新版`;
    $('#syncDot').className = 'dot';
    renderNextRefresh();
    return;
  }
  el.textContent = `数据更新于 ${relativeTime(state.lastFetch || state.updatedAt)}`;
  const bad = (state.stats && state.stats.live === 0) ? 'err' : '';
  $('#syncDot').className = `dot ${bad}`;
  renderNextRefresh();
}

/** 服务端下一次自动抓取的倒计时 */
function renderNextRefresh() {
  const el = $('#nextRefresh');
  if (!el) return;
  if (!state.nextRefreshAt) {
    el.textContent = '自动更新：每 15 分钟一次';
    return;
  }
  const diff = state.nextRefreshAt - Date.now();
  if (diff <= 0) {
    el.textContent = '自动更新：即将开始…';
    return;
  }
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  el.textContent = `自动更新倒计时 ${m}:${String(s).padStart(2, '0')}`;
}

/* ============ 事件 ============ */
$('#searchInput').oninput = (e) => {
  clearTimeout(window.__t);
  window.__t = setTimeout(() => { state.q = e.target.value.trim(); fetchData(); }, 250);
};
$('#sortSelect').onchange = (e) => { state.sort = e.target.value; fetchData(); };
$('#favOnly').onchange = (e) => { state.favOnly = e.target.checked; fetchData(); };
$('#refreshBtn').onclick = refreshLive;
$('#resetBtn').onclick = () => {
  state.filters = { region: 'all', organizerType: 'all', field: 'all', prize: 'all', status: 'all', source: 'all' };
  state.q = ''; state.favOnly = false;
  $('#searchInput').value = ''; $('#favOnly').checked = false;
  renderFilters(); fetchData();
};
$('#drawerClose').onclick = closeDrawer;
$('#drawerMask').onclick = closeDrawer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); $('#addMask').hidden = true; } });

const openAdd = () => ($('#addMask').hidden = false);
const closeAdd = () => ($('#addMask').hidden = true);
$('#addBtn').onclick = openAdd;
$('#addClose').onclick = closeAdd;
$('#addCancel').onclick = closeAdd;
// 点遮罩也能关（点弹窗内部不关）
$('#addMask').onclick = (e) => {
  if (e.target === $('#addMask')) closeAdd();
};
$('#addForm').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.hasCashPrize = Number(body.prizeAmount) > 0;
  body.prizeAmount = Number(body.prizeAmount) || 0;
  body.tags = (body.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (!body.deadline) delete body.deadline;
  try {
    const res = await fetch('/api/competitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!d.ok) throw new Error('保存失败');
  } catch (err) {
    // 无后端时保存到浏览器本地
    addLocalUser(body);
    toast('后端未启动，已保存到本地浏览器');
    $('#addMask').hidden = true;
    e.target.reset();
    if (window.__SNAPSHOT__) return applyLocal([...window.__SNAPSHOT__.items, ...getLocalUser()]);
    return;
  }
  toast('已添加比赛');
  $('#addMask').hidden = true;
  e.target.reset();
  fetchData();
};

/* ============ 启动 ============ */
/** 每秒只刷新倒计时，避免整页重渲染打断操作 */
function tickCountdowns() {
  document.querySelectorAll('[data-cd]').forEach((el) => {
    const dl = el.dataset.cd;
    if (!dl) return;
    el.innerHTML = `⏳ ${countdownText({ deadline: dl, status: el.dataset.status })}`;
  });
  renderNextRefresh();
}

/* ============ 启动 ============ */
// 部分内嵌浏览器会拦截 target=_blank，兜底：被拦截就复制原地址
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[target="_blank"]');
  if (!a || !a.href) return;
  e.preventDefault();
  const win = window.open(a.href, '_blank', 'noopener');
  if (!win) {
    const url = a.href;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
      () => toast('新窗口被拦截，官网地址已复制，请粘贴到浏览器打开'),
      () => toast('新窗口被拦截，官网地址：' + url)
    );
  }
});

renderFilters();
fetchData();
setInterval(() => { if ($('#autoRefresh').checked) fetchData(); }, 60_000);
setInterval(() => { tickCountdowns(); updateSync(); }, 1000);
// 启动后先拉一次（服务端模式触发后端抓取，静态模式检查是否有更新的快照）
setTimeout(pollSnapshot, 1500);
// 静态站：每 3 分钟检查一次云端是否已生成新数据
setInterval(() => { if ($('#autoRefresh').checked) pollSnapshot(); }, 3 * 60 * 1000);
setInterval(() => { if ($('#autoRefresh').checked) maybeBrowserLive(false); }, 10 * 60 * 1000);
