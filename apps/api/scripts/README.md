# API 命令与脚本索引

数据采集使用 `pnpm data ingest [--to YYYYMMDD]`，入口位于 [Ingestion](../src/ingestion/README.md)。无参数或 `--help` 显示帮助，非法参数在加载环境、数据库和来源之前拒绝。

| 命令 | 用途 |
| --- | --- |
| `pnpm data ingest --to YYYYMMDD` | 从自然起点补齐到目标日期；省略日期取启动时上海自然日 |
| `pnpm data runs [--limit N]` | 默认最近 5 轮，允许 1–100；仅 id、status、startedAt、finishedAt，按开始时间及 ID 倒序 |
| `pnpm data issues RUN_ID` | 该轮全部历史诊断及原始记录 |
| `pnpm data issues reconcile [RUN_ID]` | 为已结束运行的有效问题幂等补齐 pending；不重置已有处理结果，不请求数据源 |
| `pnpm data runs inspect RUN_ID` | 查看运行起止时间、逐次批次耗时及待审核候选版本 |
| `pnpm data runs accept RUN_ID [--expect-candidate HASH]` | 人工接收当前候选；可指定已核验版本，始终检查状态、未处理问题与主库基线 |
| `pnpm data runs reject RUN_ID --reason REASON` | 拒绝候选版本，记录理由 |
| `pnpm data runs recover RUN_ID --confirm-stopped` | 确认前一个进程已退出后，恢复遗留的 Run 状态 |
| `pnpm data issues export RUN_ID --out FILE [--issue ISSUE_ID]` | 只读导出诊断、业务记录、修复契约和问题模板 |
| `pnpm data issues repair --plan FILE [--apply --expect-plan PLAN_HASH]` | 默认预览。应用时校验并原子提交业务修复及问题处理结果 |
| `pnpm data etf list` | ETF 名单、生命周期和实际行情范围 |
| `pnpm data etf select-top --limit 100` | 用最近完整同日规模快照选取 Top N，并入累计 ETF 名单 |
| `pnpm data etf add CODE` / `remove CODE` | 修改名单，移出不删除历史 |
| `pnpm data index list` / `add CODE` / `remove CODE` | 管理指数名单 |
| `pnpm data reset [--database /absolute/path.db]` | 预览业务重建，仅保留四张认证表 |
| `pnpm data reset [--database /absolute/path.db] --apply` | 在写者锁内验证备份，再原子清空业务数据 |

旧 `data sync`、`data clean`、daily／weekly／repair 与历史搬移入口退役。成功批次只记录本次响应的接纳，不充当研究准入证明；目录、分红、历史名称和财务数据每轮重取，历史行情按日期补缺。整批下载结束后再事务入库。

退出码：完整完成为 0，有问题、失败或中断为 1，参数错误为 2，写者锁争用为 75。`runs`、`issues`、诊断包导出和名单查询不加载 Tushare 配置；诊断包有 error／warning 也表示导出成功，返回 0。重置备份保存在数据库旁的 `ingestion-backups`，备份失败不清空；实际重置前停止业务使用。

生产 timer 为 `deploy/jixie-ingestion.timer`，每两小时上海时间 :15 调用；这只是外部执行安排，不是数据集刷新策略。部署启用 timer，不执行全历史下载；首次切换的业务重建失败时保持停服，并保留重建标记供重试。

## 其他管理员工具

| 入口 | 用途 |
| --- | --- |
| [Auth CLI](../src/auth/cli/) | 邀请码生成 |
| [backup-db.mjs](backup-db.mjs) | 零 npm 依赖的 SQLite 一致备份 |
| [audit/](audit/) | 显式只读诊断，不由 Ingestion 调用 |
| [probes/](probes/) | 显式来源能力探测，不属于普通数据查询 |

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

### 数据库作用域与回收（历史）

旧 `pnpm sync`、Maintenance 候选协议及其专用设计已退役。当前采集、恢复与发布见 [Ingestion](../src/ingestion/README.md)；数据库绑定与锁的实现归 `infra/database` 和 `infra/coordination`。

历史记录中保留当时命令与路径；当前同步及人工清理入口以上述说明为准。2026-10-22 候选协议已由统一同步替代，不再作为当前运行方式。

ETF／指数下载名单支持 `pnpm data etf list/select-top/add/remove` 与 `pnpm data index list/add/remove`，详见 [下载名单](../src/market/downloads/README.md)。

股票交易所由 `StockBasic.exchange` 提供；缺少交易所的代码不能仅凭 `.BJ` 后缀进入北交所清理范围。旧 stock-master/G、UN 与分区清理入口已退役，不应据此执行历史数据删除。
