# API 命令与脚本索引

应用命令与业务实现按模块相邻放置，本文件提供统一的命令索引。优先使用 `pnpm --filter api <命令> [参数]`；股票日行情入口现为 `sync:stock-prices`，原 `sync` 命令已移除。

## 按任务找目录

| 目录 / 文件 | 用途 | 入口数 | 主要调用方 |
| --- | --- | --- | --- |
| [Market CLI](../src/market/cli/) | 市场数据同步、派生计算和证券代码修复 | 24 | 批量导入、bootstrap、手动补数 |
| [Application Maintenance CLI](../src/application-maintenance/cli/) | 整轮维护、基线修复及财报分批历史导入 | 2 | systemd、根级维护命令、批量导入 |
| [Signals CLI](../src/signals/cli/) | 交易日信号周期 | 1 | 管理员 |
| [Auth CLI](../src/auth/cli/) | 邀请码生成 | 1 | 管理员 |
| [migrations/](migrations/) | 版本升级的数据转换，不由 API 启动调用 | 1 | bootstrap、开发机升级 |
| [backup-db.mjs](backup-db.mjs) | 独立 SQLite 备份 | 1 | systemd、launchd、手动备份 |
| [audit/](audit/) | 检查现有数据、查看覆盖与样本 | 5 | 导入后的质量检查、研究核验 |
| [probes/](probes/) | Tushare 连接与接口能力探测 | 2 | bootstrap、批量导入、手动诊断 |

共 37 个入口，其中 28 个应用 CLI 位于模块内。操作系统任务配置统一放在仓库根级 `deploy/`。

## 运行约定

- `pnpm --filter api` 使用 `apps/api` 为工作目录。除 `backup` 外，已注册入口均加载 API 的 `.env`；数据库连接和 Tushare 等配置沿用应用配置。
- 下表 `start` / `end` / `date` 使用 `YYYYMMDD`，宏观月份使用 `YYYYMM`；方括号表示可选参数。各入口保留原有默认值，部分仍默认 2024 年等历史区间，补数时应显式传入日期。
- 日常维护优先从仓库根目录运行 `pnpm maintenance ...`，它通过 `scripts/maintenance/with-maintenance-lock.sh` 获得维护锁；批量导入使用根级 `pnpm import:data`。
- 同步会写市场数据；维护和研究命令可能写任务、信号或用户研究数据。只读审计不等于完全无文件输出，具体见下表。

## 部署数据迁移

[split-factor-job-kinds.ts](migrations/split-factor-job-kinds.ts) 把旧 `kind: factor` 转为
`factor-analysis` / `factor-correlation`。部署时 `scripts/bootstrap.sh` 先停止 API、构建并完成
Prisma schema migration，再执行 `pnpm --filter api exec node --env-file=.env dist/scripts/migrations/split-factor-job-kinds.js`。
失败返回非零状态并保持 API 停止；脚本会断开自己的连接，重跑可继续未完成批次。

开发机如需保留旧 Job，停止 API 后，从仓库根执行：

```sh
pnpm --filter api exec tsx --env-file=.env scripts/migrations/split-factor-job-kinds.ts
```

此命令写 Job kind，不重算报告或重写冻结 payload。它不在普通 `pnpm dev` / API 启动中自动运行。
源码和集成测试相邻；升级覆盖和回退要求见[运行入口](../../../docs/backend-runtime-entries.md#factor-job-kind-转换)。

## 数据同步

除 `sync:market-state` 只使用本地数据计算外，本组会访问外部数据源并写数据库。每日维护负责日常更新，这些入口仍用于初始化、定向补数和修复。

| 命令 | 文件 | 参数 | 内容 |
| --- | --- | --- | --- |
| `sync:stock-prices` | [sync-stock-prices.ts](../src/market/cli/sync-stock-prices.ts) | `[start] [end]` | 股票基础信息、交易日历、日行情与复权 |
| `sync:stock-history` | [sync-stock-history.ts](../src/market/cli/sync-stock-history.ts) | `[start] [end]` | 完整股票名录、历史名称及代码变更资料 |
| `sync:basic` | [sync-basic.ts](../src/market/cli/sync-basic.ts) | `[start] [end]` | 股票每日估值指标；不是基础名录 |
| `sync:fina` | [sync-fina.ts](../src/application-maintenance/cli/sync-fina.ts) | 无参数全量；单股修复见文件中的 `--repair-code` | 原始财报版本、财务指标、分红历史，分批子进程执行 |
| `sync:limit` | [sync-limit.ts](../src/market/cli/sync-limit.ts) | `[start] [end]` | 每日涨跌停价格 |
| `sync:moneyflow` | [sync-moneyflow.ts](../src/market/cli/sync-moneyflow.ts) | `[start] [end]` | 个股资金流 |
| `sync:toplist` | [sync-toplist.ts](../src/market/cli/sync-toplist.ts) | `[start] [end]` | 龙虎榜 |
| `sync:sw-industry` | [sync-sw-industry.ts](../src/market/cli/sync-sw-industry.ts) | 无 | 申万行业成员及历史归属 |
| `sync:etf` | [sync-etf.ts](../src/market/cli/sync-etf.ts) | `[start] [end] [selector] [refresh]` | ETF 元数据、行情、复权和份额；selector 为 `registry`、`major` 或逗号分隔代码 |
| `sync:index` | [sync-index.ts](../src/market/cli/sync-index.ts) | `[selector] [start] [end]` | 成分权重及行情；selector 为 `market-state` 或逗号分隔代码 |
| `sync:index-daily` | [sync-index-daily.ts](../src/market/cli/sync-index-daily.ts) | `[start] [end] [selector]` | 只补指数行情；selector 为 `major` 或逗号分隔代码 |
| `sync:index-basic` | [sync-index-basic.ts](../src/market/cli/sync-index-basic.ts) | `[start] [end] [selector]` | 指数每日估值；selector 为 `major` 或逗号分隔代码 |
| `sync:market-reference` | [sync-market-reference.ts](../src/market/cli/sync-market-reference.ts) | `[start] [end]` | 指数目录、看板指数和申万行业行情 |
| `sync:market-state` | [sync-market-state.ts](../src/market/cli/sync-market-state.ts) | `[start] [end]` | 本地预计算市场、指数与行业状态 |
| `sync:futures` | [sync-futures.ts](../src/market/cli/sync-futures.ts) | `[start] [end]` | 股指期货合约、行情、主力映射和结算参数 |
| `sync:commodity-futures` | [sync-commodity-futures.ts](../src/market/cli/sync-commodity-futures.ts) | `[start] [end]` | 商品期货实际合约及行情 |
| `sync:commodity-continuous` | [sync-commodity-continuous-returns.ts](../src/market/cli/sync-commodity-continuous-returns.ts) | `[start] [end]` | 主力映射及经审计的商品连续收益 |
| `sync:commodity-holdings` | [sync-commodity-holdings.ts](../src/market/cli/sync-commodity-holdings.ts) | `[start] [end]` | 商品期货会员持仓排名汇总 |
| `sync:commodity-warehouse-receipts` | [sync-commodity-warehouse-receipts.ts](../src/market/cli/sync-commodity-warehouse-receipts.ts) | `[start] [end]` | 商品交易所仓单 |
| `sync:rates` | [sync-rates.ts](../src/market/cli/sync-rates.ts) | `[start] [end]` | 中国国债收益率曲线 |
| `sync:credit-curves` | [sync-credit-curves.ts](../src/market/cli/sync-credit-curves.ts) | `[start] [end]` | 信用债收益率曲线 |
| `sync:external-market` | [sync-external-market.ts](../src/market/cli/sync-external-market.ts) | `[start] [end]` | 美国利率、汇率等外部市场数据 |
| `sync:cross-market-benchmarks` | [sync-cross-market-benchmarks.ts](../src/market/cli/sync-cross-market-benchmarks.ts) | `[start] [end]` | 跨市场基准序列 |
| `sync:macro` | [sync-macro.ts](../src/market/cli/sync-macro.ts) | `[startMonth] [endMonth]` | 中国宏观和美国 CPI |

## 审计与查看

本组只读数据库，不调用行情同步。

| 命令 | 文件 | 参数 | 用途与输出 |
| --- | --- | --- | --- |
| `audit:data` | [audit-data.ts](audit/audit-data.ts) | `[start] [end] [--window=60] [--points=5] [--json] [--strict]` | 整体质量与覆盖检查，终端输出 |
| `audit:etf` | [audit-etf-registry.ts](audit/audit-etf-registry.ts) | `[expected-history-start] [coverage-through] [--json] [--strict]` | ETF 研究清单和历史覆盖，终端输出 |
| `audit:financial-selected` | [audit-selected-financials.ts](audit/audit-selected-financials.ts) | `date [tsCode ...]` | SDK 实际选中的财报版本及会计关系，终端输出 |
| `audit:valuation-samples` | [audit-valuation-samples.ts](audit/audit-valuation-samples.ts) | `date output.json` | 估值样本、来源与历史切片；写指定 JSON 文件 |
| `peek` | [peek.ts](audit/peek.ts) | `[tsCode] [start] [end]` | 数据数量及指定股票行情，终端输出 |

## 接口探针

本组会访问外部接口。

| 命令 | 文件 | 参数 | 用途与副作用 |
| --- | --- | --- | --- |
| `smoke` | [smoke.ts](probes/smoke.ts) | 无 | Tushare 连接与权限检查，不写数据库 |
| `probe:asset-allocation` | [probe-asset-allocation.ts](probes/probe-asset-allocation.ts) | `[--date date] [--json] [--persist] [--persist-if-stale] [--max-age-days days]` | 接口能力探测；`--persist` 或 `--persist-if-stale` 写能力观察记录，bootstrap 使用后者 |

M0 财报来源与 M5 主营业务探针已完成研究使命，`probe:fundamentals`、`probe:main-business` 及其辅助实现和专属测试已移除。研究结论及原始证据继续保留在历史报告，旧代码可从 Git 历史查阅。财报版本样本迁至 [业务测试 fixture](../src/market/fundamentals/fixtures/financial-source-versions.json)，继续支持来源契约测试；正式同步、PIT 规则和 SDK 未改变。

## 维护与管理

### 财报来源探针清理验证（2026-09-15）

提交信息：`chore(market): remove completed fundamental source probes`。删除范围与代码已通过人工审查。API 类型、后端边界（0 违规）、格式、ESLint、引用及 diff 检查通过；审查后来源契约测试 7 项全部通过，API 编译到独立临时目录通过。迁移的财报版本 fixture 与原文件逐字节一致。未调用外部数据源、运行数据库写入流程或启动常驻服务。

| 命令 | 文件 | 参数 | 用途与副作用 |
| --- | --- | --- | --- |
| `maintenance` | [run-maintenance.ts](../src/application-maintenance/cli/run-maintenance.ts) | `daily [date] [--force]`、`weekly [--force]`、`repair start end`、`baseline [date]` | 写市场数据和维护状态；优先使用根级加锁入口 |
| `signals:run` | [run-signals.ts](../src/signals/cli/run-signals.ts) | `[date]` | 执行交易日信号周期，写相关运行记录 |
| `canonicalize:stock-codes` | [canonicalize-stock-codes.ts](../src/market/cli/canonicalize-stock-codes.ts) | 无 | 统一已有股票代码；导入流程调用，写数据库 |
| `gen:invite` | [gen-invite.ts](../src/auth/cli/gen-invite.ts) | `[count] [note]` | 创建邀请码，写数据库，不发送邮件 |
| `backup` | [migrations/](migrations/) | 版本升级的数据转换，不由 API 启动调用 | 1 | bootstrap、开发机升级 |
| [backup-db.mjs](backup-db.mjs) | 环境变量见下文 | SQLite 在线备份、校验和文件轮换 |

备份只依赖 Node 内置模块及 `sqlite3` CLI，无需 tsx 或编译。`JIXIE_DB_PATH` 默认指向 `apps/api/prisma/dev.db`，`JIXIE_BACKUP_DIR` 默认 `~/jixie-backups`，`JIXIE_BACKUP_KEEP` 默认 5。它创建备份文件并删除超出保留数量的旧备份，不修改源数据库业务记录。

Linux 正式配置为 [jixie-backup.service](../../../deploy/jixie-backup.service) / [jixie-backup.timer](../../../deploy/jixie-backup.timer)，由 bootstrap 安装。每日、每周维护服务调用编译入口 `apps/api/dist/src/application-maintenance/cli/run-maintenance.js`。macOS 本地备份配置为 [com.jixie.backup.plist](../../../deploy/com.jixie.backup.plist)，手动安装方式见文件注释。本目录不再维护 systemd 兼容副本。

部署本次路径调整时，需要通过 bootstrap 构建 API 并重新安装、加载 systemd 配置；仅拉取源码不会更新服务器上已安装的 unit。本次未修改可部署 workspace 或跨包构建依赖，现有 `deploy/component-impact.json` 已将 `deploy/` 和根级 `scripts/` 的变更归为全量部署，无需修改映射。

## 已移除的研究脚本

`factor:report` 及 `research/factor-report.ts` 已移除：该 CLI 使用旧版 `version: 1` 配置批量分析内置因子，仅打印终端摘要，不保存正式报告，且没有产品或生产调度调用。正式因子分析请从因子页面提交并查看持久化报告；页面不提供该脚本的一键全量批处理。底层分析器和内置因子初始化继续保留，旧脚本可从 Git 历史查阅。

固定三家公司、2026-09-07 标题的 `create-fcff-research-replays.ts` 已移除：它是已完成交付的一次性文档创建入口，没有 pnpm 或生产调用。研究模板、案例参数、用户文档和封存结果不受影响；原脚本可从 Git 历史查阅。

根级工程与运维编排脚本见 [仓库脚本索引](../../../scripts/README.md)。

### 批量因子 CLI 删除验证（2026-09-15）

提交信息：`chore(factor): remove legacy batch report CLI`。删除范围与代码已通过人工审查；引用检查、API 类型检查、后端边界检查（0 违规）、package.json 格式检查和 diff 检查通过。审查后 API 编译到独立临时目录通过。未运行旧分析脚本、访问数据库或启动服务；正式分析器、初始化逻辑和报告流程没有改动。

## 历史整理记录（2026-09-09）

提交信息：`chore(api): 按用途整理维护与研究脚本`。只调整文件归属、相对导入、文件资源路径、命令和 systemd 路径及文档；不改变 CLI 参数、默认值、数据语义或数据库 schema。

静态检查：API typecheck、后端架构边界（0 violations）、受影响代码 ESLint、Prettier、bootstrap Shell 语法、备份脚本 Node 语法、macOS plist 语法及 diff 检查通过；41 个入口的 package 命令或直接路径和本索引链接均已核对。旧文件路径仅在历史架构基线文档中保留。人工代码审查已通过。

审查后验证：探针、财报 fixture 与统计文档共 5 个测试文件、20 项测试全部通过；API 编译到新的临时目录，40 个 TS CLI 产物、财报 fixture 及每日/每周维护服务对应编译路径核对通过。统计文档生成器在保持相同相对目录结构的临时副本中执行，生成内容与仓库一致。首次 tsx CLI 被沙箱的本地管道权限限制阻止，改用 `node --import tsx` 后通过，未修改产品代码。未运行 bundle 测试、生产维护、备份定时服务或 FCFF 文档创建，未启动常驻测试服务或连接生产数据库。
