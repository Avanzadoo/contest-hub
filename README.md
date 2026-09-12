# 比赛实时工作台（Contest Hub）

聚合**高含金量、有奖金**的国内外赛事：按地域 / 主办方 / 领域 / 奖金 / 状态分类，卡片展示赛事概要，点开可直达**比赛原地址（官网）**。

## 核心：数据全自动更新，不需要手动录入

服务端启动后**每 15 分钟自动抓取**一次数据源，新抓到的比赛自动打 `NEW` 标记，页面提示「自动更新：新收录 N 场比赛」，顶部还显示下一次自动更新的倒计时。

| 自动源 | 类型 | 抓取量 | 说明 |
| --- | --- | --- | --- |
| MLH 全球黑客松赛事季 | 国际 | ~79 条 | 解析 schema.org/Event 微数据，取未结束赛事，线上赛优先 |
| 我爱竞赛网 52jingsai.com | 国内 | ~40 条 | GBK 页面解析，自动提取标题、主办单位、报名截止日期 |
| DrivenData 公益数据赛 | 国际 | ~14 条 | 解析赛事卡，含奖池金额 |

- 抓取失败自动重试并保留上次缓存；每个源的状态（成功/失败/耗时/条数）显示在页面顶部状态条。
- 自动抓到的赛事若与精选库重复，保留精选库的**官方地址**（`src/store.js` 的 `dedupeByCurated`）。
- 手动「+ 添加比赛」只是补充手段，日常不需要用。

新增数据源：在 `src/sources/` 加模块，导出 `fetch()`（返回 `{source,label,ok,count,items,error,ms}`）与 `toCompetition(raw)`，再到 `server.js` 的 `SOURCES` 注册。

## 网址与实时更新

| 用途 | 地址 |
| --- | --- |
| **正式对外地址（带 qian 短链）** | **https://tinyurl.com/qian-hub** |
| **正式站点（GitHub Pages）** | **https://avanzadoo.github.io/contest-hub/** |
| 仓库 | https://github.com/Avanzadoo/contest-hub |
| 本地实时版 | http://localhost:3001（双击 start.bat） |

更新机制：

1. **GitHub Actions（主力，全自动）**：`.github/workflows/refresh.yml` 每 **30 分钟**在 GitHub 服务器跑一次 `node scripts/crawler.js`（抓 MLH / 我爱竞赛网 / DrivenData），更新 `docs/snapshot.js` 并自动提交，Pages 随即发布。**不需要开电脑、不需要开 WorkBuddy。**
2. **本地服务**：启动即抓取，之后每 15 分钟一轮，页面每 60 秒同步（已配开机自启）。
3. 旧的 CloudStudio 镜像与对应定时任务已暂停，仅作备份。

常用命令：

```bash
node scripts/make-crawler.js                       # 重建单文件爬虫 scripts/crawler.js
set GH_TOKEN=xxx && node scripts/publish-github.js # 重新推送并发布
node scripts/build-site.js                         # 重建 dist/（CloudStudio 备份用）
```

## 两种使用方式

### 1）本地完整版（推荐，自动持续更新）

```bash
# 双击 start.bat，或命令行：
node server.js          # 端口被占用会自动顺延（3001、3002…）
```

浏览器打开终端提示的地址（默认 http://localhost:3001）。

**连开机都不用管**：双击 `install-autostart.bat`，之后每次登录 Windows 都会后台自动启动并持续更新（取消用 `uninstall-autostart.bat`）。

提供能力：

- 启动即抓取，之后每 15 分钟自动刷新，也可点「⟳ 刷新」手动触发
- 页面每 60 秒拉一次服务端数据，倒计时实时走
- 手动添加 / 收藏比赛，数据落在 `data/user.json`
- 服务端筛选、排序、统计接口

### 2）静态离线版（无需 Node）

直接双击 `public/index.html` 即可（数据来自 `public/snapshot.js` 快照）。
重新生成快照：

```bash
node scripts/snapshot.js
```

服务端每次刷新也会自动重写这份快照，保证离线版本不落后。

## 数据说明

| 文件 | 作用 |
| --- | --- |
| `data/seed.json` | 精选赛事库（60 条），含官网、奖金、含金量评级、周期说明 |
| `data/live.json` | 实时抓取缓存（MLH 黑客松） |
| `data/user.json` | 手动添加的比赛 |

- 所有官网链接均做过可达性核验；奖金与截止时间是官方公开信息整理，**标注「以官网为准」的为周期性赛事，具体以官网公告为准**。
- 含金量评级（1–5 星）综合教育部白名单 / 国际认可度 / 名企主办 / 奖金规模。

## 分类维度

- **地域**：国内 / 国际
- **主办方**：政府部委 · 高校教指委 · 企业 · 学会机构 · 国际组织 · 社区平台
- **领域**：创新创业 · AI算法 · 数据科学 · 数学建模 · 外语演讲 · 生科医学 · 金融商科 · 设计创意 · 工程技术 · 科技公益 · 法学辩论 · 黑客松
- **奖金**：有现金奖 / ≥1 万 / ≥10 万 / ≥100 万
- **状态**：报名中 / 14 天内截止 / 常年滚动 / 已截止
- **数据来源**：精选收录 / 实时抓取 / 我添加的

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/competitions` | 支持 `region/organizer/field/prize/status/source/q/sort` 参数 |
| POST | `/api/refresh` | 立即拉取实时数据源 |
| POST | `/api/competitions` | 添加比赛（JSON） |
| DELETE | `/api/competitions/:id` | 删除手动添加的比赛 |
| GET | `/api/health` | 健康检查与数量统计 |

## 新增实时数据源

在 `src/sources/` 下新增模块，导出 `fetch()`（返回 `{ source, label, ok, count, items, error }`）与 `toCompetition(raw)`，然后在 `server.js` 的 `SOURCES` 中注册即可。抓取失败会自动保留上次缓存，不影响使用。
