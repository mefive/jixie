# 业务执行职责整理

状态：人工代码审查已确认，行为验证与构建通过，按已确认的提交信息交付。

提交信息：`refactor(api): clarify execution roles and naming`

## 最终设计

无状态业务编排使用具名函数，不建立业务基类或统一 Runner/Session 签名。Factor、Research、Agent 保持原目录及接口；Worker 负责消息边界和进程收尾，语言 runtime 负责代码加载与执行。用户确认扫描无需独立 cell 进程，最终结构如下：

| 位置 | 职责 |
| --- | --- |
| strategy/backtests/run.ts | runConfiguredBacktest：准备因子源码、调用模拟并做风险后处理 |
| strategy/scans/run.ts | runStrategyScan：准备一次因子源码，直接循环参数/区间，在扫描 Worker 内串行调用 runSandboxedBacktest 并汇总 |
| strategy/scans/scan.ts | 规格、组合、覆盖值、净值与指标的纯计算；没有执行回调 |
| strategy/scans/strategy-scan-worker.ts | 解析输入、调用 runStrategyScan、发送消息、断开 Prisma |
| strategy/scans/strategy-scan-lifecycle.ts | 普通 Worker + 通用 runWorker，不覆盖 terminate |
| strategy/execution/simulation.ts | 创建策略 runtime 与 FactorHost，初始化并校验因子元数据/冻结血缘，运行 Engine，finally 关闭资源 |
| strategy/factor-inputs/prepare.ts | 权限、发布状态、源码、TS 编译、批准资产范围与组合快照；不启动 runtime |
| strategy/factor-inputs/metadata.ts | 运行定义装配、组合输入/窗口汇总、研究专用字段拒绝；为 Engine 行情加载及报告血缘提供元数据 |
| strategy/factor-inputs/lineage.ts | 从 Signals 原样迁移的冻结血缘解析及比较，比较规则不变 |
| signals/runs/run.ts | 加载部署与运行，将冻结快照交给模拟校验，整理信号及摘要；按部署 locale 翻译错误 |
| signals/runs/signal-worker.ts | IPC 输入与结果、Prisma/IPC 收尾 |

删除初稿全部新增 Runner/Session 类，以及扫描 cell executor、cell worker/boot、cell IPC schema 和 stop 消息。每次模拟都创建自己的 runtime，不跨组合共享策略或因子实例。Signals 部署没有模拟阶段，独立创建一次 FactorHost 做准入并 finally 释放；信号运行在 Engine 开始前严格比较包括 inputs 在内的完整血缘。

## 行为边界与风险

公开 HTTP/SDK、数据库、快照格式、算法、权限、Job 终态与报告事务不变。扫描失败仍整体失败；执行从逐 cell 子进程改成整次扫描共用一个 Worker。正常模拟通过 finally 回收 runtime，任务结束断开 Prisma，异常终止复用普通回测的 Worker 管理。强制终止不承诺执行 finally；连续运行、退出和中断的资源行为必须通过实际入口回归，不能用静态检查代替。

元数据错误在执行初始化时报出。Engine 的国债收益率加载要求、组合输入汇总、研究专用字段拒绝与 Signals 血缘校验保留。没有新增 workspace/package 或跨包构建依赖，API 路径由既有部署规则覆盖，Python 镜像输入不变。

## 审查与验证

按 review-gated-development，产品修改后先执行类型、生成契约、边界、lint/format、diff 和文档链接静态检查，人工审查后才运行测试、构建并提交。

准备的行为回归包括：扫描参数/区间顺序、串行等待、capacity 资金覆盖、sizing 净值、失败停止；prepare 不启动 runtime；TS/Python 模拟初始化一次并复用计算；组合输入、研究字段、Signals 快照及资源释放；真实扫描 Worker 连续执行三个组合并退出（TS/Python 因子），通用生命周期在日志失败时终止扫描线程并等待退出。原 cell 协议测试删除，保留整任务输出校验。

审查通过后运行相关 Engine/Strategy/Signals、Job 生命周期及协议测试，shared/API 构建，并以 JIXIE_TEST_COMPILED=1 验证编译 Worker 入口；部署计划测试和边界检查器自测一并执行。历史已通过结果不能替代本修订验证，临时测试进程与数据库必须清理。

最新静态结果：全仓 pnpm typecheck 通过（838 文件边界扫描、0 violations、生成契约一致），受影响 TS/MJS 的 ESLint/Prettier、git diff --check、文档链接检查通过。apps/scripts 无 cell 子进程或专用控制协议残留引用。日志：/tmp/jixie-scan-single-worker-typecheck.log、/tmp/jixie-scan-single-worker-static.log。该静态检查记录对应审查前状态；人工确认后的结果见下方。

## 人工确认后的验证结果

- 回归：27 个测试文件通过，324 项通过；覆盖 Strategy 准备/模拟/扫描/路由、TS/Python runtime、Engine 因子、Signals、Job 生命周期及协议。
- 原有 accounting/flow.integration.test.ts 默认要求 ACCOUNTING_INTEGRATION=1，1 项保持跳过。本次没有修改会计业务；Signals HTTP 与持久化集成测试已运行并通过。
- 源码 Worker 14 项、编译 Worker 14 项通过；包含扫描同线程连续三个组合（TS/Python 因子）、正常退出、通用生命周期异常终止、正式回测与 Signals 真实入口。测试使用独立 SQLite 并清理，不修改用户数据库。
- 部署计划与后端边界检查器自测 41 项通过；shared/API 构建通过。合计 393 项测试通过，1 项默认跳过。
- git diff --check、文档链接检查通过；进程检查确认本次 Worker、Python 因子和 Vitest 无残留。
- 日志：/tmp/jixie-execution-regression.log、/tmp/jixie-execution-source-workers.log、/tmp/jixie-execution-compiled-workers.log、/tmp/jixie-execution-checker-tests.log、/tmp/jixie-execution-build.log。
- 按人工确认提交 refactor(api): clarify execution roles and naming，不推送。
