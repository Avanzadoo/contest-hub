'use strict';

/**
 * DrivenData —— 国际公益 / 公共数据科学竞赛自动抓取
 * 列表页为服务端渲染，可直接正则提取赛事名、链接与奖金。
 */

const BASE = 'https://www.drivendata.org';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function decode(s) {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parse(html) {
  const out = [];
  const re = /href="(\/competitions\/\d+\/[^"]+)"/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const win = html.slice(Math.max(0, m.index - 2500), m.index + 3000);

    const titleMatch = /<h[23][^>]*>\s*<a[^>]*href="[^"]*"[^>]*>([\s\S]{0,160}?)<\/a>/.exec(win);
    const prizeMatch = /\$\s?[\d,]{3,}(?:\s*(?:USD|k|K))?/.exec(win);
    const statusMatch = /(Open|Running|Closed|Upcoming|Completed)/i.exec(win);
    const deadlineMatch = /(?:Deadline|closes)[^<]{0,40}?([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/i.exec(win);

    const name = titleMatch ? decode(titleMatch[1]) : decode(path.split('/').filter(Boolean).pop().replace(/-/g, ' '));
    out.push({
      url: BASE + path,
      name,
      prize: prizeMatch ? prizeMatch[0] : '',
      status: statusMatch ? statusMatch[1] : '',
      deadlineText: deadlineMatch ? deadlineMatch[1] : '',
    });
  }
  return out;
}

async function fetchDrivenData() {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/competitions/`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return { source: 'drivendata', label: 'DrivenData', ok: false, count: 0, error: `HTTP ${res.status}`, items: [] };
    }
    const items = parse(await res.text()).filter((i) => !/closed|completed/i.test(i.status));
    return {
      source: 'drivendata',
      label: 'DrivenData 公益数据赛',
      ok: items.length > 0,
      count: items.length,
      ms: Date.now() - started,
      error: items.length ? null : '未解析到赛事条目',
      items,
    };
  } catch (e) {
    return { source: 'drivendata', label: 'DrivenData 公益数据赛', ok: false, count: 0, error: e.message, items: [] };
  }
}

function toCompetition(it) {
  const prizeNum = it.prize ? Number(it.prize.replace(/[^0-9]/g, '')) : 0;
  let deadline = null;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.deadlineText);
  if (dm) deadline = it.deadlineText;
  else if (it.deadlineText) {
    const d = new Date(it.deadlineText);
    if (!Number.isNaN(d.getTime())) deadline = d.toISOString().slice(0, 10);
  }

  return {
    id: 'dd-' + it.url.replace(/\D/g, '').slice(-10),
    name: it.name,
    alias: 'DrivenData',
    organizer: 'DrivenData（公益/公共部门命题）',
    organizerType: 'community',
    region: 'intl',
    field: 'data',
    tier: 4,
    hasCashPrize: prizeNum > 0 ? true : null,
    prizeAmount: prizeNum ? Math.round(prizeNum * 7) : 0, // 美元粗估人民币
    prizeText: it.prize ? `奖池 ${it.prize}（以官网为准）` : '以官网公布为准',
    deadline,
    deadlineNote: it.deadlineText ? `官网标注 ${it.deadlineText}` : '时间以官网为准',
    cycle: '一次性赛事',
    eligibility: '全球数据科学从业者与学生',
    summary: 'DrivenData 公益与公共部门数据科学竞赛，命题多来自国际组织、公益机构与政府部门，适合做有社会价值的 AI 项目。',
    url: it.url,
    tags: ['自动抓取', '国际', '数据科学'],
    source: 'drivendata',
    sourceLabel: 'DrivenData 自动抓取',
  };
}

module.exports = { fetchDrivenData, toCompetition };
