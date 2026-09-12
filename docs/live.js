'use strict';

/**
 * 浏览器端实时抓取（无后端也能更新）
 * 静态站点没有后端，跨域受限，因此依次尝试多个公开 CORS 代理；
 * 任意一个可用就能在浏览器里直接抓到最新赛事，抓不到就静默回退到快照。
 */
(function () {
  const YEAR = new Date().getUTCFullYear();

  const PROXIES = [
    { name: 'cors.lol', make: (u) => 'https://api.cors.lol/?url=' + encodeURIComponent(u) },
    { name: 'allorigins', make: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u), jsonWrap: true },
    { name: 'codetabs', make: (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
    { name: 'jina', make: (u) => 'https://r.jina.ai/' + u },
    { name: 'corsproxy.io', make: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
  ];

  const decodeEntities = (s) =>
    String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();

  const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  async function grab(url, timeout = 9000) {
    for (const p of PROXIES) {
      try {
        const res = await fetch(p.make(url), {
          signal: AbortSignal.timeout(timeout),
          headers: { Accept: 'text/html,application/json,*/*' },
        });
        if (!res.ok) continue;
        let text = await res.text();
        if (p.jsonWrap && text.trim().startsWith('{')) {
          try {
            const j = JSON.parse(text);
            text = j.contents || '';
          } catch (_) {}
        }
        if (text && text.length > 3000) return { ok: true, text, proxy: p.name };
      } catch (e) {
        /* 换下一个代理 */
      }
    }
    return { ok: false };
  }

  /* ---------- MLH ---------- */
  function parseMLH(html) {
    const out = [];
    const pick = (re, s) => {
      const m = re.exec(s);
      return m ? decodeEntities(m[1]) : '';
    };
    for (const raw of html.split('<a ')) {
      if (!raw.includes('schema.org/Event')) continue;
      const chunk = raw.slice(0, 8000);
      const nameFromUtm = /utm_content=([^&"]+)/.exec(chunk);
      let url = pick(/href="([^"]+)"/, chunk);
      if (!url) continue;
      let name = nameFromUtm ? decodeURIComponent(nameFromUtm[1].replace(/\+/g, ' ')) : '';
      url = url.split('?')[0];
      if (!/^https?:/i.test(url) || !name) continue;
      if (/test event|do not use/i.test(name)) continue;

      const start = pick(/itemProp="startDate"[^>]*content="([^"]+)"/i, chunk);
      const end = pick(/itemProp="endDate"[^>]*content="([^"]+)"/i, chunk) || start;
      if (!start || Date.parse(end || start) < Date.now() - 86400000) continue;

      const online = /OnlineEventAttendanceMode/i.test(chunk);
      const city = pick(/itemProp="addressLocality"[^>]*content="([^"]+)"/i, chunk);
      const country = pick(/itemProp="addressCountry"[^>]*content="([^"]+)"/i, chunk);
      const free = pick(/itemProp="isAccessibleForFree"[^>]*content="([^"]+)"/i, chunk) === 'true';
      const fmt = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

      out.push({
        id: 'mlh-' + url.replace(/^https?:\/\//i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(-70),
        name: name.replace(/\s+\d{4}\s*$/, '').trim(),
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
        deadlineNote: '比赛时间 ' + fmt(start) + ' 至 ' + fmt(end) + '（以官网为准）',
        cycle: '一次性赛事',
        eligibility: '全球开发者与学生',
        summary: (online ? '线上' : '线下') + '黑客松' + (city ? ' · ' + city + (country ? ', ' + country : '') : '') + (free ? ' · 免费' : ''),
        url,
        tags: [online ? '线上可参加' : '线下', '实时抓取'],
        source: 'live-browser',
        sourceLabel: '浏览器实时抓取',
        _raw: start,
      });
    }
    return out.sort((a, b) => Date.parse(a._raw) - Date.parse(b._raw)).slice(0, 60);
  }

  /* ---------- 我爱竞赛网（GBK） ---------- */
  function parseWuai(text) {
    const out = [];
    const now = new Date();
    for (const b of text.split('<div class="tab_c_item"').slice(1)) {
      const chunk = b.slice(0, 3000);
      const href = /href="([^"]+)"/.exec(chunk);
      const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(chunk);
      const intro = /class="t_c_intro"[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(chunk);
      if (!href || !h3) continue;
      const rawTitle = strip(h3[1]);
      const introText = intro ? strip(intro[1]) : '';
      let url = href[1];
      if (!/^https?:/i.test(url)) url = 'https://www.52jingsai.com/' + url.replace(/^\//, '');

      const m = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(rawTitle + introText) ||
                /(\d{1,2})月(\d{1,2})日截止/.exec(rawTitle + introText);
      let deadline = null;
      if (m) {
        if (m.length === 4) deadline = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        else {
          let y = now.getFullYear();
          const cand = new Date(y, Number(m[1]) - 1, Number(m[2]));
          if (cand.getTime() < now.getTime() - 90 * 86400000) y += 1;
          deadline = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
        }
      }
      const organizer = (/主办单位：([^|；;]{2,40})/.exec(introText) || [])[1] || '';
      out.push({
        id: 'wuai-' + url.replace(/\D/g, '').slice(-12),
        name: rawTitle.replace(/^【[^】]*】/, '').trim(),
        alias: (/^【([^】]*)】/.exec(rawTitle) || [])[1] || '我爱竞赛网',
        organizer: organizer.trim() || '见官网公告',
        organizerType: /教育部|教育厅|部委|共青团|科协|学会|协会/.test(organizer) ? 'gov' : 'org',
        region: 'cn',
        field: /英语|翻译|外语|演讲|词汇|普通话|语言/.test(rawTitle + introText)
          ? 'language'
          : /数学|建模|统计/.test(rawTitle)
          ? 'math'
          : /设计|广告|创意|艺术/.test(rawTitle)
          ? 'design'
          : /创业|创新大赛|创青春|电商|商业|金融/.test(rawTitle)
          ? 'entrepreneurship'
          : 'other',
        tier: /教育部|白名单/.test(introText + organizer) ? 4 : 3,
        hasCashPrize: /奖金|万元|现金奖/.test(introText + rawTitle) ? true : null,
        prizeAmount: 0,
        prizeText: '以官网公布为准',
        deadline,
        deadlineNote: '抓取自我爱竞赛网，以官网为准',
        cycle: '以官网为准',
        eligibility: '高校在校生为主（以官网为准）',
        summary: introText || rawTitle,
        url,
        tags: ['国内', '实时抓取'],
        source: 'live-browser',
        sourceLabel: '浏览器实时抓取',
      });
    }
    return out;
  }

  const SOURCES = [
    { key: 'mlh', label: 'MLH 黑客松', url: `https://mlh.io/seasons/${YEAR}/events`, parse: parseMLH },
    { key: 'wuai', label: '我爱竞赛网', url: 'https://www.52jingsai.com/', parse: parseWuai },
  ];

  let cache = { items: [], at: 0, report: [] };
  let running = false;

  async function run(force) {
    if (running) return cache;
    if (!force && cache.items.length && Date.now() - cache.at < 10 * 60 * 1000) return cache;
    running = true;
    const report = [];
    let items = [];
    try {
      const results = await Promise.all(
        SOURCES.map(async (s) => {
          const t0 = Date.now();
          const g = await grab(s.url);
          if (!g.ok) return { key: s.key, label: s.label, ok: false, count: 0, ms: Date.now() - t0, error: '无可用代理', items: [] };
          try {
            const list = s.parse(g.text) || [];
            return { key: s.key, label: s.label, ok: list.length > 0, count: list.length, ms: Date.now() - t0, proxy: g.proxy, items: list };
          } catch (e) {
            return { key: s.key, label: s.label, ok: false, count: 0, ms: Date.now() - t0, error: e.message, items: [] };
          }
        })
      );
      results.forEach((r) => {
        report.push(r);
        if (r.ok) items = items.concat(r.items);
      });
      if (items.length) cache = { items, at: Date.now(), report };
      else cache = { ...cache, report };
    } finally {
      running = false;
    }
    return cache;
  }

  window.LiveFetch = { run, getCache: () => cache };
})();
