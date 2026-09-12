'use strict';

/**
 * 生成离线快照 public/snapshot.js
 * 使得不启动 Node 服务时（直接双击 index.html、或静态部署）也能浏览全部赛事数据。
 */

const fs = require('fs');
const path = require('path');
const store = require(path.join(__dirname, '..', 'src', 'store'));
const mlh = require(path.join(__dirname, '..', 'src', 'sources', 'mlh'));
const wuai = require(path.join(__dirname, '..', 'src', 'sources', 'wuai'));
const drivendata = require(path.join(__dirname, '..', 'src', 'sources', 'drivendata'));

const OUT = path.join(__dirname, '..', 'public', 'snapshot.js');

const MODULES = [
  { mod: mlh, fetch: () => mlh.fetchMLH() },
  { mod: wuai, fetch: () => wuai.fetchWuai() },
  { mod: drivendata, fetch: () => drivendata.fetchDrivenData() },
];

async function main() {
  MODULES.forEach(({ mod }) => store.registerMapper(mod === mlh ? 'mlh' : mod === wuai ? 'wuai' : 'drivendata', mod.toCompetition));

  const reports = [];
  const collected = [];
  for (const { mod, fetch } of MODULES) {
    const r = await fetch();
    reports.push({ source: r.source, label: r.label, ok: r.ok, count: r.count || 0, ms: r.ms || 0, error: r.error || null });
    if (r.ok && r.items.length) r.items.forEach((raw) => collected.push(mod.toCompetition(raw)));
  }

  if (collected.length) {
    store.state.live = { items: collected, savedAt: Date.now(), firstSeen: store.state.firstSeen };
  }
  const items = store.all();
  const payload = { updatedAt: Date.now(), stats: store.stats(items), sources: reports, items };
  fs.writeFileSync(OUT, `window.__SNAPSHOT__=${JSON.stringify(payload)};`, 'utf8');
  console.log(`  快照已生成：${OUT}`);
  reports.forEach((r) => console.log(`   · ${r.label}: ${r.ok ? r.count + ' 条' : '失败（' + (r.error || '未知') + '）'}`));
  console.log(`  精选 ${store.state.seed.length} 条 + 自动抓取 ${store.state.live.items.length} 条 + 手动 ${store.state.user.length} 条 = ${items.length} 条`);
}

main().catch((e) => {
  console.error('  生成快照失败：', e.message);
  process.exit(1);
});
