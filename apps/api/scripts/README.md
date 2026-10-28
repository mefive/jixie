# API 命令与脚本索引

应用命令与业务实现按模块相邻放置，本文件提供统一的命令索引。优先使用 `pnpm --filter api <命令> [参数]`；同步统一使用 `pnpm sync <任务> [参数]`（根目录）或 `pnpm --filter api sync <任务> [参数]`。无参数及 `--list` 只显示帮助；`pnpm sync etf --help` 显示单项参数。

## 按任务找目录

| 目录 / 文件 | 用途 | 入口数 | 主要调用方 |
| --- | --- | --- | --- |
| [统一数据同步](../src/maintenance/) | 按目标日期推进所有既有数据域、补缺与重查 | 1 | `pnpm data sync [--to YYYYMMDD]` |
| [Maintenance CLI](../src/maintenance/cli/) | 整轮维护和基线修复 | 1 | systemd、根级维护命令、批量导入 |
| [Auth CLI](../src/auth/cli/) | 邀请码生成 | 1 | 管理员 |
| [backup-db.mjs](backup-db.mjs) | 独立 SQLite 备份 | 1 | systemd、launchd、手动备份 |
| [audit/](audit/) | 检查现有数据、查看覆盖 | 2 | 导入后的质量检查、研究核验 |
| [probes/](probes/) | Tushare 连接与接口能力探测 | 2 | bootstrap、批量导入、手动诊断 |

共有 33 个业务/工具入口，其中 28 个应用 CLI 位于模块内；24 个同步 CLI 由 [sync/index.ts](sync/index.ts) 统一分派。2 个审计任务使用 [audit/index.ts](audit/index.ts)，2 个外部探针使用 [probes/index.ts](probes/index.ts)，各目录的 `commands.ts` 是任务清单，共用 [command-entry.ts](command-entry.ts) 处理帮助与执行环境。操作系统任务配置统一放在仓库根级 `deploy/`。

## 运行约定

- `pnpm --filter api` 使用 `apps/api` 为工作目录。除 `backup` 外，业务执行均加载 API 的 `.env`；`sync`、`data:audit`、`probe` 在参数校验通过后才加载环境和业务模块，帮助、未知任务及非法参数不连接数据库；数据库连接和 Tushare 等配置沿用应用配置。
- 下表 `start` / `end` / `date` 使用 `YYYYMMDD`；方括号表示可选参数。各入口保留原有默认值，部分仍默认 2024 年等历史区间，补数时应显式传入日期。
- 数据写入只使用 `pnpm data sync [--to YYYYMMDD]`；只读审计与显式探针保留。
- `maintenance`、`import:data`、`sync <任务>` 和代码归一 CLI 均已退役，不设置兼容转发。

## 已退役的数据转换

生产已完成旧 `factor` Job 到 `factor-analysis` / `factor-correlation` 的转换，`db:migrate:factor-job-kinds`、转换脚本及 bootstrap 调用已移除。新安装和当前数据库不需要此步骤；Prisma 历史 schema migrations 保留。
当前只保留 `factor-analysis`；`factor-correlation` 已退役，旧任务不会启动 Worker。恢复转换前的旧备份或升级尚未转换的开发库时，需要先完成旧数据转换，再启动当前 API，见 [旧库恢复说明](../../../docs/backend-runtime-entries.md#factor-job-kind-旧库恢复)。

## 数据同步

唯一写流程是 `pnpm data sync [--to YYYYMMDD]`，由 `src/maintenance/cli/data.ts` 进入协调器；生产使用相同编译入口。无参数或 `--help` 显示帮助，未知参数、额外选择器和不存在的日期在环境/数据库加载前失败。退出码：完整/合法 partial 为 0，实际错误为 1，参数错误为 2，写锁争用为 75。

旧 24 项同步能力分别映射到 Market 的 calendar、stocks、instruments、indices、etfs 和 fundamentals 领域；宏观、利率、FX 和跨市场来源已退役；日常补齐与首次回补使用同一持久分区计划，不再公开任务选择器。完整映射和覆盖策略见 [Maintenance](../src/maintenance/README.md) 与 [设计](../../../docs/design/unified-data-sync.md)。

## 审计与查看

本组只读数据库，不调用行情同步。根目录使用 `pnpm data:audit <任务>`，或使用 `pnpm --filter api data:audit <任务>`。无参数、`--list` 和 `<任务> --help` 仅显示说明；`pnpm audit` 保留 pnpm 自带的依赖漏洞检查。

| 命令 | 文件 | 参数 | 用途与输出 |
| --- | --- | --- | --- |
| `data:audit data` | [audit-data.ts](audit/audit-data.ts) | `[start] [end] [--window=60] [--points=5] [--json] [--strict]` | 整体质量与覆盖检查，终端输出 |

## 接口探针

本组使用 `pnpm probe <任务>`（或 `pnpm --filter api probe <任务>`）。无参数、`--list` 和 `<任务> --help` 不访问外部接口；显式执行任务时才访问。旧 `smoke` 对应 `probe tushare`，`probe:asset-allocation` 对应 `probe asset-allocation`。

| 命令 | 文件 | 参数 | 用途与副作用 |
| --- | --- | --- | --- |
| `probe tushare` | [smoke.ts](probes/smoke.ts) | 无 | Tushare 连接与权限检查，不写数据库 |
| `probe asset-allocation` | [probe-asset-allocation.ts](probes/probe-asset-allocation.ts) | `[--date date] [--json] [--persist] [--persist-if-stale] [--max-age-days days]` | 接口能力探测；`--persist` 或 `--persist-if-stale` 写能力观察记录，bootstrap 使用后者 |

M0 财报来源与 M5 主营业务探针已完成研究使命，`probe:fundamentals`、`probe:main-business` 及其辅助实现和专属测试已移除。研究结论及原始证据继续保留在历史报告，旧代码可从 Git 历史查阅。财报版本样本迁至 [业务测试 fixture](../src/market/fundamentals/fixtures/financial-source-versions.json)，继续支持来源契约测试；正式同步、PIT 规则和 SDK 未改变。

## 维护与管理

### 财报来源探针清理验证（2026-09-15）

提交信息：`chore(market): remove completed fundamental source probes`。删除范围与代码已通过人工审查。API 类型、后端边界（0 违规）、格式、ESLint、引用及 diff 检查通过；审查后来源契约测试 7 项全部通过，API 编译到独立临时目录通过。迁移的财报版本 fixture 与原文件逐字节一致。未调用外部数据源、运行数据库写入流程或启动常驻服务。

| 命令 | 文件 | 参数 | 用途与副作用 |
| --- | --- | --- | --- |
| `data sync [--to YYYYMMDD]` | [data.ts](../src/maintenance/cli/data.ts) | 统一目标日期；无数据集/模式选择器 | 分区覆盖与有限批次，自动继续未完成工作 |

生产 timer 为 `deploy/jixie-maintenance.timer`，每两小时上海时间 :15 执行；旧 weekly timer 升级时停用。备份继续使用 `deploy/jixie-backup.*` 和零 npm 依赖 `scripts/backup-db.mjs`。

## 已移除的研究脚本

2026-09-18：已移除 `tests/deepseek-complex-example.mjs`、`audit/audit-selected-financials.ts` 和 `audit/audit-valuation-samples.ts`，以及 `data:audit financial-selected` / `data:audit valuation-samples` 命令。它们用于已完成的模型演示和财报、估值专项验收；历史报告与证据保留，脚本可从 Git 历史查阅。正式业务计算和数据库结构不变。

`factor:report` 及 `research/factor-report.ts` 已移除：该 CLI 使用旧版 `version: 1` 配置批量分析内置因子，仅打印终端摘要，不保存正式报告，且没有产品或生产调度调用。正式因子分析请从因子页面提交并查看持久化报告；页面不提供该脚本的一键全量批处理。底层分析器和内置因子初始化继续保留，旧脚本可从 Git 历史查阅。

固定三家公司、2026-09-07 标题的 `create-fcff-research-replays.ts` 已移除：它是已完成交付的一次性文档创建入口，没有 pnpm 或生产调用。用户文档源码保留；专用模板与内置估值已随系统简化退役。原脚本可从 Git 历史查阅。

根级工程与运维编排脚本见 [仓库脚本索引](../../../scripts/README.md)。

### 批量因子 CLI 删除验证（2026-09-15）

提交信息：`chore(factor): remove legacy batch report CLI`。删除范围与代码已通过人工审查；引用检查、API 类型检查、后端边界检查（0 违规）、package.json 格式检查和 diff 检查通过。审查后 API 编译到独立临时目录通过。未运行旧分析脚本、访问数据库或启动服务；正式分析器、初始化逻辑和报告流程没有改动。

## 历史整理记录（2026-09-09）

提交信息：`chore(api): 按用途整理维护与研究脚本`。只调整文件归属、相对导入、文件资源路径、命令和 systemd 路径及文档；不改变 CLI 参数、默认值、数据语义或数据库 schema。

静态检查：API typecheck、后端架构边界（0 violations）、受影响代码 ESLint、Prettier、bootstrap Shell 语法、备份脚本 Node 语法、macOS plist 语法及 diff 检查通过；41 个入口的 package 命令或直接路径和本索引链接均已核对。旧文件路径仅在历史架构基线文档中保留。人工代码审查已通过。

审查后验证：探针、财报 fixture 与统计文档共 5 个测试文件、20 项测试全部通过；API 编译到新的临时目录，40 个 TS CLI 产物、财报 fixture 及每日/每周维护服务对应编译路径核对通过。统计文档生成器在保持相同相对目录结构的临时副本中执行，生成内容与仓库一致。首次 tsx CLI 被沙箱的本地管道权限限制阻止，改用 `node --import tsx` 后通过，未修改产品代码。未运行 bundle 测试、生产维护、备份定时服务或 FCFF 文档创建，未启动常驻测试服务或连接生产数据库。

### 命令族目录整理（2026-09-18）

计划提交：`refactor(api): group script entry points by command family`。

sync、audit、probe 的分派入口与任务清单分别集中到 `sync/`、`audit/`、`probes/`；
统一使用各目录的 `index.ts` 作为入口，pnpm 命令、参数和默认值保持不变。
公共 `command-entry.ts` 及执行边界测试留在本目录，环境与业务路径仍相对此公共文件解析。
audit/probe 参数和注册覆盖测试分别归入各目录的 `commands.test.ts`；
部署与批量导入引用断言集中到 `../tests/cli-entrypoints.test.ts`。
业务同步实现、独立备份入口和历史验收记录保持原有归属。

静态检查：API `tsc --noEmit`、改动代码 ESLint、Prettier 与 diff 检查通过。
人工代码审查已通过。审查后 5 个测试文件、91 项测试全部通过，覆盖参数校验、注册完整性、CLI 契约以及源码/编译形式的隔离分派、环境加载和退出码透传。API 编译通过；三个 pnpm 帮助入口及三个实际编译帮助入口均通过。测试已清理临时目录和隔离数据库连接，没有启动常驻服务或执行真实数据同步。

### 专项验收脚本清理（2026-09-18）

计划提交：`chore(api): remove completed acceptance and audit scripts`。

删除已完成交付的 DeepSeek 演示、财报版本和估值样本审计脚本，移除两项审计命令注册、校验与帮助，更新 CLI 测试和旧入口提示。历史报告及证据保留并标明入口退役。

Gate 2 静态检查：API `tsc --noEmit`、改动 TypeScript 的 ESLint / Prettier、后端边界静态扫描（0 违规）、引用与 diff 检查通过。人工代码审查已通过。

审查后验证：审计参数、CLI 执行边界与应用入口契约共 3 个测试文件、34 项测试全部通过，API 构建通过。测试进程均已退出；未执行真实数据同步、付费模型调用或启动常驻服务。

### 数据库作用域与回收（2026-10-22，待代码审阅）

`pnpm sync` 保留全部 24 个命令及参数；业务实现移至 `src/market/sync` 的可调用函数，不再自执行 CLI。维护准备、最终计算与审计在候选数据库作用域中执行；仅财务批次保留子进程。详细边界、升级约束及验证计划见 [设计](../../../docs/design/maintenance-database-scope-and-cleanup.md)。尚未运行本次行为验证。

历史记录中保留当时命令与路径；当前唯一写入口以上述统一同步说明为准。2026-10-22 候选协议已由统一同步替代，不再作为当前运行方式。

ETF／指数下载名单支持 `pnpm data etf list/select-top/add/remove` 与 `pnpm data index list/add/remove`，详见 [下载名单](../src/market/downloads/README.md)。
