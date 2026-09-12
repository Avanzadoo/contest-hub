'use strict';

/**
 * 我爱竞赛网（52jingsai.com）—— 国内大学生赛事列表自动抓取
 * 页面为 GBK 编码，需手动解码；列表块结构为 .tab_c_item > a > .t_c_right (h3 / .t_c_intro)
 */

const BASE = 'https://www.52jingsai.com/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function decodeGBK(buf) {
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从标题/简介里推断领域 */
function guessField(text) {
  const t = text || '';
  const rules = [
    [/英语|翻译|外语|演讲|写作|阅读|词汇|普通话|语言文字/, 'language'],
    [/数学|建模|统计|算法|程序|ACM|蓝桥|代码|编程|软件|计算机|信息学/, 'algorithm'],
    [/智能|人工智能|AI|大模型|机器学习|数据|算法大赛/, 'ai'],
    [/生物|生命科学|医学|药学|健康|食品/, 'bio'],
    [/创业|创新大赛|创青春|互联网\+|三创|商业|营销|市场|电商|跨境|金融|会计/, 'entrepreneurship'],
    [/设计|广告|创意|艺术|视觉|动漫|摄影|短视频/, 'design'],
    [/机械|电子|电路|结构|化工|材料|能源|土木|车辆|自动化|机器人|智能制造/, 'engineering'],
    [/模拟法庭|辩论|法学|法律|征文|案例/, 'law'],
    [/挑战杯|节能减排|调研|社会调查|志愿服务|公益/, 'comprehensive'],
  ];
  for (const [re, f] of rules) if (re.test(t)) return f;
  return 'other';
}

/** 从标题括号或简介里抠出截止日期 */
function parseDeadline(title, intro) {
  const now = new Date();
  const year = now.getFullYear();
  const src = `${title} ${intro}`;

  let m = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(src);
  if (!m) m = /(\d{1,2})月(\d{1,2})日截止/.exec(src);
  if (!m) m = /截止[：: ]*(\d{1,2})月(\d{1,2})日/.exec(src);
  if (!m) return null;

  let y, mo, d;
  if (m.length === 4) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  } else {
    y = year;
    mo = Number(m[1]);
    d = Number(m[2]);
    // 若算出来的日期已过去 3 个月以上，视为明年
    const candidate = new Date(y, mo - 1, d);
    if (candidate.getTime() < now.getTime() - 90 * 86400000) y += 1;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseList(html) {
  const out = [];
  const blocks = html.split('<div class="tab_c_item"');
  for (const b of blocks.slice(1)) {
    const chunk = b.slice(0, 3000);
    const href = /href="([^"]+)"/.exec(chunk);
    const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(chunk);
    const intro = /class="t_c_intro"[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(chunk);
    const date = /<span>(\d{4}-\d{2}-\d{2})<\/span>/.exec(chunk);
    if (!href || !h3) continue;

    const rawTitle = stripTags(h3[1]);
    const introText = intro ? stripTags(intro[1]) : '';
    let url = href[1];
    if (!/^https?:/i.test(url)) url = BASE + url.replace(/^\//, '');

    const organizer = (/主办单位：([^|；;]{2,40})/.exec(introText) || [])[1] || '';
    const deadline = parseDeadline(rawTitle, introText);
    const hasPrize = /奖金|奖金池|万元|现金奖|\d+\s*元/.test(introText + rawTitle);

    out.push({
      rawTitle,
      url,
      intro: introText,
      organizer: organizer.trim(),
      deadline,
      hasPrize,
      publishedAt: date ? date[1] : null,
    });
  }
  return out;
}

async function fetchWuai() {
  const started = Date.now();
  try {
    const res = await fetch(BASE, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { source: 'wuai', label: '我爱竞赛网', ok: false, count: 0, error: `HTTP ${res.status}`, items: [] };
    const html = decodeGBK(Buffer.from(await res.arrayBuffer()));
    const items = parseList(html);
    return {
      source: 'wuai',
      label: '我爱竞赛网（国内赛事）',
      ok: items.length > 0,
      count: items.length,
      ms: Date.now() - started,
      error: items.length ? null : '未解析到赛事条目',
      items,
    };
  } catch (e) {
    return { source: 'wuai', label: '我爱竞赛网（国内赛事）', ok: false, count: 0, error: e.message, items: [] };
  }
}

function toCompetition(it) {
  const bracket = (/^【([^】]*)】/.exec(it.rawTitle) || [])[1] || '';
  const name = it.rawTitle.replace(/^【[^】]*】/, '').trim() || it.rawTitle;
  const field = guessField(it.rawTitle + it.intro);
  const tags = ['自动抓取'];
  if (bracket) tags.push(bracket.replace(/截止$/, '截止'));
  if (it.hasPrize) tags.push('有奖金');

  return {
    id: 'wuai-' + it.url.replace(/\D/g, '').slice(-12),
    name,
    alias: bracket || '我爱竞赛网',
    organizer: it.organizer || '见官网公告',
    organizerType: /教育部|教育厅|部委|共青团|中国科协|学会|协会|中心/.test(it.organizer)
      ? 'gov'
      : /大学|学院|教指委/.test(it.organizer)
      ? 'university'
      : 'org',
    region: 'cn',
    field,
    tier: /教育部|白名单|中国高等教育学会/.test(it.intro + it.organizer) ? 4 : 3,
    hasCashPrize: it.hasPrize ? true : null,
    prizeAmount: 0,
    prizeText: it.hasPrize ? '简介含奖金信息，详见官网公告' : '以官网公布为准',
    deadline: it.deadline,
    deadlineNote: it.deadline ? '抓取自我爱竞赛网公告，以官网为准' : '时间以官网为准',
    cycle: '以官网为准',
    eligibility: '高校在校生为主（以官网为准）',
    summary: it.intro || it.rawTitle,
    url: it.url,
    tags,
    source: 'wuai',
    sourceLabel: '我爱竞赛网自动抓取',
    publishedAt: it.publishedAt,
  };
}

module.exports = { fetchWuai, toCompetition };
