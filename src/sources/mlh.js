'use strict';

/**
 * MLH（Major League Hacking）赛事季实时抓取
 * 页面使用 schema.org/Event 微数据，可直接解析出名称/时间/地点/链接。
 */

const SEASON = 'https://mlh.io/seasons/';

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function pick(re, str) {
  const m = re.exec(str);
  return m ? decodeEntities(m[1]) : '';
}

async function fetchSeason(year, timeoutMs = 15000) {
  const url = `${SEASON}${year}/events`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return { url, ok: false, error: `HTTP ${res.status}`, html: '' };
    return { url, ok: true, html: await res.text() };
  } catch (e) {
    return { url, ok: false, error: e.name === 'AbortError' ? '超时' : e.message, html: '' };
  } finally {
    clearTimeout(timer);
  }
}

function parseSeason(html, seasonUrl) {
  const out = [];
  if (!html) return out;
  const blocks = html.split('<a ');
  for (const raw of blocks) {
    if (!raw.includes('schema.org/Event')) continue;
    const chunk = raw.slice(0, 8000);

    // 注意：href 不在区块开头（前面还有 class 等属性），不能用 ^href 匹配
    let url = pick(/href="([^"]+)"/, chunk);
    if (!url) continue;
    const nameFromUtm = /utm_content=([^&"]+)/.exec(url);
    url = url.split('?')[0];
    if (!/^https?:\/\//i.test(url)) continue;

    let name = nameFromUtm ? decodeURIComponent(nameFromUtm[1].replace(/\+/g, ' ')) : '';
    if (!name) name = pick(/itemProp="name"[^>]*content="([^"]+)"/i, chunk);
    if (!name) continue;

    const startDate = pick(/itemProp="startDate"[^>]*content="([^"]+)"/i, chunk);
    const endDate = pick(/itemProp="endDate"[^>]*content="([^"]+)"/i, chunk) || startDate;
    const online = /OnlineEventAttendanceMode/i.test(chunk);
    const free = pick(/itemProp="isAccessibleForFree"[^>]*content="([^"]+)"/i, chunk);
    const image = pick(/itemProp="image"[^>]*content="([^"]+)"/i, chunk);
    const city = pick(/itemProp="addressLocality"[^>]*content="([^"]+)"/i, chunk);
    const country = pick(/itemProp="addressCountry"[^>]*content="([^"]+)"/i, chunk);
    const venue = pick(/itemProp="name"[^>]*>([^<]+)</i, chunk);

    out.push({
      url,
      name: name.replace(/\s+\d{4}\s*$/, '').trim(),
      startDate: startDate || null,
      endDate: endDate || null,
      online,
      free: free === 'true',
      image: image || null,
      location: [city, country].filter(Boolean).join(', ') || venue || '',
      seasonUrl,
    });
  }
  return out;
}

/** 抓取未来可参加的 MLH 赛事 */
async function fetchMLH() {
  const started = Date.now();
  const year = new Date().getUTCFullYear();
  const results = await Promise.all([fetchSeason(year), fetchSeason(year + 1)]);

  const seen = new Set();
  const items = [];
  for (const r of results) {
    if (!r.ok) continue;
    for (const ev of parseSeason(r.html, r.url)) {
      const key = ev.url;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(ev);
    }
  }

  const okResults = results.filter((r) => r.ok);
  const now = Date.now();
  const future = items
    .filter((ev) => {
      if (/test event|do not use|sample event/i.test(ev.name)) return false; // 官方测试赛
      const t = Date.parse(ev.endDate || ev.startDate || '');
      return Number.isFinite(t) && t > now - 86400000;
    })
    .sort((a, b) => Date.parse(a.startDate || 0) - Date.parse(b.startDate || 0))
    // 线上赛事优先展示（海外线下赛对国内同学参与成本高）
    .sort((a, b) => Number(b.online) - Number(a.online))
    .slice(0, 90);

  return {
    source: 'mlh',
    label: 'MLH 全球黑客松赛事季',
    ok: okResults.length > 0,
    count: future.length,
    ms: Date.now() - started,
    error: okResults.length ? null : results.map((r) => r.error).filter(Boolean).join(' / '),
    items: future,
  };
}

/** 把 MLH 原始赛事映射成统一数据模型 */
function toCompetition(ev) {
  const start = ev.startDate ? new Date(ev.startDate) : null;
  const end = ev.endDate ? new Date(ev.endDate) : null;
  const fmt = (d) =>
    d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` : null;

  return {
    id: 'mlh-' + ev.url.replace(/^https?:\/\//i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(-70),
    name: ev.name,
    alias: 'MLH 黑客松',
    organizer: 'Major League Hacking（MLH）',
    organizerType: 'community',
    region: 'intl',
    field: 'hackathon',
    tier: 3,
    hasCashPrize: null,
    prizeAmount: 0,
    prizeText: '黑客松，通常设赞助商奖池与奖品；具体以赛事官网为准',
    deadline: fmt(start),
    deadlineNote: start
      ? `比赛时间 ${fmt(start)}${end && fmt(end) !== fmt(start) ? ' 至 ' + fmt(end) : ''}（以官网为准）`
      : '时间以官网为准',
    cycle: '一次性赛事',
    eligibility: ev.free ? '免费参与，全球开发者与学生' : '全球开发者与学生',
    summary: `${ev.online ? '线上' : '线下'}黑客松${ev.location ? ' · ' + ev.location : ''}${
      ev.free ? ' · 免费' : ''
    }。MLH 官方赛事季收录，适合积累项目与国际开发经历。`,
    url: ev.url,
    image: ev.image,
    tags: ev.online ? ['黑客松', '线上可参加'] : ['黑客松', '线下'],
    source: 'mlh',
    sourceLabel: 'MLH 实时抓取',
  };
}

module.exports = { fetchMLH, toCompetition };
