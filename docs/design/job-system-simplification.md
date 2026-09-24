# 后台任务简化：开发交接

> 当前组织以文末「2026-09-23 生命周期契约修订」为准。前文普通任务函数、finishJob、start/storage 分离的方案
> 保留为讨论记录，已被用户确认的生命周期对象方案替代；状态、事务、Worker 退出与历史报告规则继续适用。

日期：2026-09-22。

当前状态（2026-09-24）：产品代码与 Prisma SQL 均已获用户审阅批准，静态检查、隔离库升级回归、业务测试、源码/编译 Worker 与构建全部通过。按已授权的提交信息完成本次变更；实际验证见文末记录，前文保留初始设计背景。未 push、部署或操作用户开发库/生产库。

执行入口：[配套 prompt](job-system-simplification.prompt.md)。后续开发必须使用 [review-gated-development](../../../../.codex/skills/review-gated-development/SKILL.md)；当前环境的实际技能路径为 `/Users/liucong/.codex/skills/review-gated-development/SKILL.md`。

建议实现提交信息：`refactor(jobs): simplify background task execution`。接手模型在 Gate 1 宣告并请用户确认该信息、具体迁移和验证范围；此次设计确认不是后续代码审阅或 Git 提交批准。

## 1. 已确认的目标

让人类顺着普通函数读懂任务：业务提交 → 事件唤醒 → 领取任务 → 调用业务函数 → 原子保存结果 → 释放名额。

固定决策：

1. 保留事件唤醒，不使用定时轮询消费数据库。
2. 调度只使用 `dispatchLoopActive` 与 `dispatchRequested` 两个标记。
3. 一个业务任务就是 `async function runXxxTask(job, log)`。删除 `defineJob`、`PreparedJob`、`JobResult`、通用生命周期定义和输入/输出闭包适配层。
4. 注册表显式列出普通函数；不引入类继承、插件、扫描注册、依赖注入容器或泛型生命周期工厂。
5. Worker 辅助函数只接收 `onLog`；不接收整个 Job、Job context 或数据库事务。
6. 任务运行状态以 Job 为唯一来源；业务结果状态与历史无 Job 数据按第 6 节明确处理。
7. 计算在事务外；最终业务结果与 Job 终态在同一个短事务内保存。
8. 一次完成七类现有任务、所有状态读取和必要迁移。不以“先改回测”“以后再统一状态”结束交付。

这是可读性和职责调整，不修改策略算法、Factor 方法论、Research SDK、账户计算规则或公开产品能力。默认总并发 2、单用户并发 1，保留环境配置。运行模型仍是一个实际消费任务的进程，不增加 Redis、分布式租约或跨实例恢复。

## 2. 目标文件与依赖方向

```text
apps/api/src/jobs/
  start.ts          显式装配业务函数；任务调用、特殊失败收尾和启动恢复
  scheduler.ts      事件唤醒、并发名额、选择/领取/派发、名额释放
  storage.ts        Job 类型、读写、条件领取、完成/失败事务、查询
  logs.ts           内存缓冲、增量读取、终态持久化快照和清理
  worker.ts         线程/子进程消息转 Promise，显式 onLog
  README.md         以回测为例的执行与日志阅读地图

apps/api/src/strategy/backtests/task.ts
apps/api/src/strategy/scans/task.ts
apps/api/src/factor/evaluations/task.ts
apps/api/src/factor/correlations/task.ts
apps/api/src/signals/runs/task.ts
apps/api/src/research/embedded/task.ts
apps/api/src/research/curator/task.ts
```

以上七个 `task.ts` 替换对应的 `job.ts`。业务 `submit.ts`、计算实现、Worker 入口保留在本业务目录；无需为了文件名一致额外搬动算法文件。旧 `infra/jobs` 的运行实现迁完删除，不留转发壳或第二套可用执行器。

`jobs/start.ts` 是唯一允许导入具体业务任务的装配文件。业务可以导入通用 `scheduler/storage/logs/worker`；用户后续批准 Signals 每日批处理导入 `start.ts` 的 executeJob 直接执行，其他业务不得反向导入。通用文件不能直接或间接导入业务。

`bootstrap.ts` 显式调用装配入口，等待启动恢复完成，再启用消费、唤醒已有 queued 任务，最后监听 HTTP。`buildApp()` 和模块导入不得自动启动调度。

建议最小接口（接口归使用它的文件，不新增集中 `types.ts`）：

```ts
type LogWriter = (entry: LogLine) => void;
type JobHandler = (job: Job, log: LogWriter) => Promise<void>;

function JobScheduler.wake(): void;
function finishJob(
  jobId: string,
  saveResult: (transaction: Prisma.TransactionClient) => Promise<void>,
): Promise<boolean>;
```

`Job` 保持持久化快照类型，`payload` 在每个业务函数入口重新校验。普通函数仍有强类型局部变量；不得用 `any` 或泛型断言把未校验的数据库 JSON 当成业务输入。

## 3. 调度：只处理通知和名额

### 3.1 核心循环

以下是已确认的核心算法；实现时放在调度实例闭包中，避免测试实例共享标记：

```ts
let dispatchLoopActive = false;
let dispatchRequested = false;

function wake() {
  dispatchRequested = true;
  if (dispatchLoopActive) {
    return;
  }

  dispatchLoopActive = true;
  queueMicrotask(() => {
    void dispatchLoop();
  });
}

async function dispatchLoop() {
  try {
    while (dispatchRequested) {
      dispatchRequested = false;
      try {
        await dispatchQueuedJobs();
      } catch (error) {
        console.error('[jixie] job dispatch failed', error);
      }
    }
  } finally {
    dispatchLoopActive = false;
  }
}
```

| 情况 | 行为 |
| --- | --- |
| 空闲时 wake | 标记检查，安排唯一微任务 |
| 微任务尚未执行又 wake | 合并到即将开始的检查 |
| 查询/领取的 await 期间 wake | 保留 `dispatchRequested=true`，当前检查后再检查 |
| 没有新通知 | 退出循环，恢复空闲 |
| 总并发已满 | 本次检查返回；任务结束释放名额后 wake |
| 调度查询失败 | 记录错误；已有新通知则处理，否则等待下一次事件，不忙重试 |

最后一次 `while` 判断到 `dispatchLoopActive=false` 之间没有 await，不会被另一个 JS 回调插入。`dispatchLoopActive` 包含“已安排”和“正在派发”，不表示业务计算仍在运行。

### 3.2 装配与唤醒入口

调度器构造时注入完整的执行函数，随后安装模块级 `wakeJobQueue` 的目标引用。该引用是装配资源，不增加 `started/wakePending/draining/rerunRequested` 调度标记。未安装时 wake 不消费任务；数据库中的 queued 任务由启动后的首次 wake 接回。禁止静态导入自动消费，也禁止在每个业务里构造调度器。

每个调度器实例只有一个消费循环。重复安装必须拒绝或复用同一实例，不得静默产生第二个循环。测试实例应可以独立创建与释放；不因此建设完整的通用服务生命周期框架。

唤醒发生在：启动恢复完成后、业务提交事务成功后、任务计算资源退出并释放名额后，以及既有取消入口需要重新检查队列时。事务回滚不得触发消费。

### 3.3 派发和执行资源

- `dispatchQueuedJobs()` 仅查询、条件领取并启动任务，不 await 业务计算本身。
- 候选按 `queuedAt, id` 排序，跳过达到用户并发上限的候选。扫描批次不能让前面某个饱和用户永久挡住后面的可执行用户。
- 领取用一次条件更新完成 `queued → running`，只执行更新成功的任务。
- 在开始异步业务前占用总/用户名额；无论成功还是失败，资源结束后在 finally 释放并 wake。
- 已取消 Job 不代表 Worker 已退出。真正计算仍在运行时不能提前释放名额。
- `void promise.finally(...)` 返回的 Promise 也要处理拒绝，不能留下 unhandled rejection。
- 多进程不在支持范围；原子领取不能被宣传为全局并发或多实例恢复保证。

## 4. 普通业务函数与事务

### 4.1 回测阅读示例

```ts
export async function runBacktestTask(job: Job, log: LogWriter) {
  const input = parseBacktestInput(job.payload, job);
  const result = await runWorker<BacktestSummary>({
    start: () => new Worker(workerUrl, { workerData: input }),
    onLog: log,
    readMessage: decodeBacktestMessage,
    exitedMessage: formatBacktestExit,
  });

  await refreshStrategyNameForRun(input).catch(reportNamingError);

  await finishJob(job.id, async (transaction) => {
    await saveBacktestReport(transaction, input, result);
  });
}
```

示例中的 parse/decode/save 函数代表业务已有逻辑，不要求为了每一行都新建文件或转发函数。小段逻辑直接写在 `task.ts`。

保留自动命名的现有完成时点：计算成功后、报告提交前等待命名，失败仅记录。把命名改到完成之后、并发执行或另建后台任务会改变客户端的就绪语义，属于另行确认的行为调整。

### 4.2 成功事务

`finishJob` 的固定契约：

1. 在事务内检查/条件占有该 Job 的 `running` 终结资格。
2. 无资格时返回 false，不调用业务保存回调。
3. 使用同一个 transaction 调用 `saveResult`，保存终态日志并更新 Job 为 done。
4. 任一写入失败，业务结果和 Job 更新全部回滚。
5. 提交成功才安排日志淘汰；返回 true。回调只能写数据库，不启动 Worker、请求 LLM、发通知或开启独立结果事务。

条件更新可以先在事务内写 done 再执行结果回调，或采用等价的事务保护；不得在事务外先读状态再无条件写。业务可见结果只能在提交后发布。

任务函数正常返回时，Job 必须已成为终态，或已被取消等外部操作终结。装配调用层应防住“忘记调用 finishJob 却正常返回”：仍为 running 则按实现错误收尾，不制造假成功。

### 4.3 失败与真正的业务收尾

普通执行入口按 kind 调函数，抛错时统一把仍为 running 的 Job 改为 error，保存错误、结束时间和日志。失败持久化也失败时保留两个原因，向派发层传播；资源名额仍须释放。

允许普通事务工具 `failJob(jobId, error, saveFailure?)`，与 finishJob 一样条件更新并原子执行可选领域写入。它是一次事务操作，不是注册在每个任务上的生命周期方法。具体业务只有在有真实失败产物时显式调用。

必须保留的特例：

- **Factor 分析**：Worker 执行阶段异常时，在失败事务保存已有本地化 `failedMessage`；Job.error 保留技术原因。参数校验或结果保存失败不能套用 Worker 的失败文案。
- **Embedded Research**：失败/取消/恢复要结束 execution/cell 输入证据，并释放 `activeRunId`；只更新 Job 会永久占用分析锁。装配层根据持久化 `researchExecutionId` 调用明确的业务收尾函数，覆盖未知 kind、损坏 payload 和业务函数尚未进入的异常。不得依赖重新 parse 损坏 payload 找关联。
- **Signals**：成功事务后先初始化会计，成功后才通知；失败终态也沿用通知行为。提交后异常单独记录，不能把已成功提交的 Job 改成 error。

这几项用普通函数和明确的 try/catch/事务表达。禁止重新引入“所有业务必须实现 fail/recover/afterCommit”的通用对象。`jobs/start.ts` 可以明确装配这些少数跨域动作；`scheduler/storage/worker` 仍保持业务无关。

已提交后的附加工作仍由任务调用链等待，保留当前名额释放时点。需要后台化或持久化重试时另行设计，不能靠未处理的 Promise 脱离当前任务。

## 5. Worker 与日志

`runWorker<Result>` 只处理创建、消息、错误和退出：

- 参数为 `start`、`onLog`、`readMessage`、`exitedMessage`；没有 Job/context/Prisma。
- `start` 返回可回收的 `Worker | ChildProcess` 或等价窄资源类型，不能只声明为没有 terminate/kill 能力的 EventEmitter。辅助函数必须能结束自己创建的资源。
- 创建后立即安装监听。同步创建失败转 rejected Promise。
- `log` 调用 onLog；业务日志和系统日志继续保留 source/level/text。
- 首个终态消息生效；收到 done 后仍须正常退出才 resolve。非零退出、缺少终态或 error 消息均失败。
- 线程与 Signals 的 fork 子进程都支持。不能把消息事件直接当成数据库提交位置。
- IPC 是运行时校验边界，`as JobWorkerMessage<T>` 不是校验。复用已有校验，缺少时在业务 decoder 校验必要结构和结果，不引入通用 schema 生成框架。
- 异常/取消要清理监听和资源。进程已成功启动时，错误传播和名额释放不得遗留仍在运行的计算；spawn 失败则不能永远等一个不会发生的正常 exit。为这些分支写测试。

decoder 或 onLog 抛错时，终止已启动资源并等待实际退出再结束这次运行。用户取消仍限于已有入口及其业务 abort；本次不新增七类任务通用取消 API 或取消框架。

日志只在实际调用业务任务前初始化一次。queued 查询返回空日志；业务提交入口不分配日志缓冲。回调在调用层创建：

```ts
const log: LogWriter = (entry) => appendJobLog(job.id, entry);
await handler(job, log);
```

链路：Worker `postMessage` → runWorker `onLog` → appendJobLog → 内存。完成、失败和取消的终态事务保存当前日志，提交后五分钟淘汰；终态后的迟到日志不得继续修改已冻结日志。查询继续支持 `since/nextSince` 和所有权检查。

本次不增加 Redis、实时逐行持久化、日志截断或分页契约。进程崩溃前尚未落库的日志仍可能丢失，不能把重构描述为解决了日志耐久性。

## 6. 状态来源、历史数据与迁移

### 6.1 固定兼容策略

内部 Job 暂沿用现有持久化词汇 `queued/running/done/error/stale`；取消仍沿用 error 及既有原因/领域取消状态。本次不另外引入 `failed/interrupted/cancelled` 到通用 Job HTTP 契约。

有 Job 的记录从关联 Job 获取运行状态和技术错误；一对多时按明确的当前 attempt 选择。普通报告 API 原来把排队表示为 running 的，继续投影 `queued → running`；Job API 仍返回 queued；Curator 等原本支持 queued 的接口保持原状。不改 URL、响应字段、用户归属或 holdout 保密规则。

历史无 Job 是合法数据：旧 FactorReport、`legacy:<strategyId>` 的 BacktestReport 都可能无关联。采用**显式历史字段回读**，不回填虚构 Job、不伪造运行输入或时间：

| 模型 | 目标字段/读取规则 |
| --- | --- |
| BacktestReport、StrategyScanReport、SignalRun、ResearchCuratorRun | 原 status/error 映射为 nullable `legacyStatus @map("status")`、`legacyError @map("error")`。新 Job 驱动记录写 null；有 Job 时完全忽略这两列；无 Job 时保留原始含义 |
| FactorReport | status 同样映射为 nullable legacyStatus。原 error 映射为 `failureMessage @map("error")`，保留历史错误及经校验输入对应的 Worker 失败文案；新记录初始为 null |
| ResearchExecution、ResearchCellExecution | 保留现有领域结果 status/error/errorCode；不能当成 Job 镜像批量改名或删除 |

Prisma 的 `@map` 保留原数据库列名，nullable 改动仍必须生成正式 migration。legacyStatus 必须移除旧 `@default("done")` / `@default("queued")` 等默认值；新 Job 驱动记录显式写 null，防止数据库默认值继续制造第二份状态。历史有 Job 的旧镜像值可以留存，但不能继续双写或参与运行状态判断。仅只读历史兼容分支使用 legacy 字段；不新增一套可写的“旧任务系统”。

Factor 报告错误投影明确为：有关联 Job 且 Job.status 为 error 时取 `failureMessage ?? job.error`；输入校验/完成事务异常不填 Worker 专用 failureMessage；其他有 Job 状态不展示旧 failureMessage。Job API 保持技术 error，无 Job 的历史报告沿用原 failureMessage 语义。不要保存了本地化文案却仍只返回技术错误。

这份方案不要求开发模型自行决定历史迁移策略。若实际数据存在无 Job 且无可解释历史状态、无 Job 却仍 queued/running、未知状态、关联 owner 不一致或互相矛盾的成功结果，记录数量/例子并回 Gate 1，不猜测修复，不删数据，不创建虚构用户。历史兼容主要保留有可解释终态的记录，不能把无执行来源的 active 记录永久当成正在运行。

### 6.2 七类任务的结果契约

| kind | 业务入口 | 必须保留 |
| --- | --- | --- |
| backtest | strategy/backtests/task.ts | 冻结 config、hash、报告 payload/computedAt，成功更新 Strategy.lastResult |
| strategy-scan | strategy/scans/task.ts | config/spec/codeHash/dataCutoff、扫描结果与 cell 子进程 |
| factor-analysis | factor/evaluations/task.ts | phase、holdout/reveal/testKey、父报告、研究意图及发布准入 |
| factor-correlation | factor/correlations/task.ts | 成功事务内 upsert 缓存；失败/取消/恢复保留上次成功缓存 |
| signal | signals/runs/task.ts | 一个 SignalRun 对多个 Job；重试复用 run；冻结部署、成交/账户数据和通知字段 |
| research-curator | research/curator/task.ts | findings、统计与 Job 同事务；提交时再次按 owner/fingerprint 去重；失败不发布部分候选 |
| research-embedded-analysis | research/embedded/task.ts | 输入/环境证据、产物、首次成功冻结、revision 校验、取消/恢复释放 activeRunId |

Signals 当前 attempt 固定为 `createdAt desc, id desc` 的最新关联 Job，保留全部历史 Job。旧 attempt 的失败不得覆盖新 attempt 状态；完成保存时也检查自己仍是当前 attempt。会计、通知、去重和重试都使用同一选择规则，不各自挑不同 Job。

Embedded 的 `Job.done` 可以对应 `ResearchExecution.error`：一次流程已正常保存“计算失败”的证据。这是合法业务结果。普通 Research 文档运行没有通用 Job，其运行、依赖 stale/blocked、提案与证据状态均保持所属业务语义。

启动恢复在单个事务中将遗留 running Job 标成 stale，显式调用 Embedded 的中断收尾；queued 保留。报告从 Job 投影中断状态，不再逐表改镜像。不能在 API 正运行时由另一个 CLI 执行全局恢复。

### 6.3 必须迁移的读取面

不能只改 HTTP 页面上的状态：

- Strategy 报告列表/详情、Signals 部署准入、历史报告与公开读取。
- Factor 报告读取、holdout 可用性/去重/reveal、研究计数、发布准入；未 reveal 时仍隐藏 payload 和 Job.logs。
- Signals 运行读取、重试/去重、notifier、accounting 初始化/读取/结算/成交操作。
- Research datasets 中 backtest-report、factor-report、scan-and-weather；Curator 成功 cursor 和提交互斥。
- shared 响应类型、所有直接查询这些 status/error 列的后端消费者、测试 fixture 和前端消费者。

状态查询在数据库分页/计数之前使用正确的 relation 条件，不能分页后内存过滤导致数量、排序和权限变化。领域内可集中一个小的状态投影函数，不建立跨业务 ORM/查询 DSL。

## 7. 全部实现范围与明确边界

同一 coherent change 完成设施、七个 task、提交和查询入口、schema/migration、必要业务错误投影、所有调用方、测试与文档。内部工作顺序不是分批交付许可。

必须同步：

- `apps/api/package.json#imports` 添加 `#jobs/*` 的 development → src、default → dist/src 映射；跨顶层导入带 `.js`。
- `scripts/checks/check-backend-boundaries.mjs` 及自测覆盖新 jobs 路径。同时修改 source 判定与 allowed-target 判定，允许通用 jobs 文件互导及原有 infra/纯工具依赖；不允许直接或传递经 start.ts 反向依赖业务。当前规则仅识别 infra/jobs，不能只替换一处正则。只对 start.ts 的装配依赖作精确例外，不整体放行。
- `apps/api/tests/import-aliases.test.ts`，包括生产路径；所有 Worker `new URL` 继续相对地址。
- `CLAUDE.md`、后端 architecture/boundaries/runtime-entries 文档、Jobs README 和七类业务 README。更新当前规范，不伪造历史验证结果。
- bootstrap、维护/Signals CLI 的消费和等待入口；API 保留单调度器与维护锁；按后续用户确认，CLI 通过条件 claim 独立串行执行。
- API 内普通搬迁已被 `apps/api/` 部署规则覆盖。若新增 deployable、改变跨包 build 依赖或 Python 镜像输入，才按根指令同步 impact 清单和部署计划测试。

源码与编译 Worker 路径都必须验证：backtests/worker、scans/strategy-scan-worker、scans/strategy-scan-cell-worker、factor/execution/worker、factor/correlations/worker、signals/runs/signal-worker。Research 两类任务不为了统一而增加 Worker。

不属于本次：自动重试失败任务、分布式调度、完整服务退出平台、outbox、SDK/交易算法调整、Agent turn 接入通用 Job、命名或通知时点调整、生产部署和 push。发现确有必要改变这些边界时先回 Gate 1。

## 8. 审阅门禁与命令

### 8.1 Gate 1：接手后先交具体计划

先只读检查工作区与当前实现，保护已有改动；读取根 CLAUDE、CONTRIBUTING、本文与技能。若涉及前端，再读 apps/web/CLAUDE。

向用户给出：当前阶段、上述准确提交信息、最终文件/接口和消费者、七类范围、legacy 字段及迁移、静态/行为命令、已知例外与回退条件，然后停止等待实现范围批准。本轮“只写文档”的授权不得借用为代码实现批准。

### 8.2 实现后、代码审阅前：仅静态检查

先检查实际 scripts 再运行命令；以下是编写本文时已核查的命令分类：

```sh
git diff --check
pnpm exec eslint <changed-ts-mjs-files>
pnpm exec prettier --check <changed-ts-json-files>
pnpm typecheck
```

尖括号是需替换的文件列表，不是可直接执行的 shell 参数。根 typecheck 当前只做边界 AST 扫描、SDK 生成一致性和类型检查，不构建或连接业务数据库。

需要单独检查时可使用底层静态命令：

```sh
node scripts/checks/check-backend-boundaries.mjs
node scripts/checks/check-commit-message.mjs <message-file>
```

`pnpm check:backend-boundaries` 与 `pnpm check:commit-message` 均先跑 `node --test`，不能在产品代码待审时运行。禁止此时执行 tests、build、dev server、smoke、E2E、业务脚本、数据库迁移或 db push。

必要的 Prisma schema 校验/客户端生成须核查命令只读取 schema、生成静态客户端，不连接/变更数据库；不把 migrate dev 归入此类。不得因缺新客户端而退回 any 绕过类型检查。

### 8.3 Prisma SQL 生成的门禁

Prisma 6 的 `migrate dev --create-only` 会操作开发/影子库，不是静态检查。按技能默认规则执行：

1. 实现 schema、映射、业务与测试代码，通过静态检查，交第一次 Gate 2。明确 migration 尚未生成，因此还不能提交。
2. 用户批准后，仅在独立临时数据库/影子库按旧 migrations 建立基线，使用 Prisma 6 生成新 migration；不连接用户开发库/生产库。SQL 必须由 Prisma 生成，不手写、不改写生成文件。
3. 新 SQL 是需要审阅的产品变更。展示 SQL、静态差异与迁移影响，返回 Gate 2；此时暂停其余行为验证。
4. SQL 获批后，在隔离库执行升级和回归验证。所有变更仍属于同一个提交。

如果用户在 Gate 1 明确授权“仅在隔离库提前生成 migration”这一窄例外，可将 SQL 纳入第一次 Gate 2；没有明确授权就走以上默认流程。不要为了省一次 SQL 审阅假称 migration 是静态检查。

### 8.4 Gate 2：人工审阅

交接必须自包含：已实现行为、准确提交信息、关键阅读入口、状态/迁移/资源风险、静态结果、准备但未运行的验证，并明确“未提交，等待人工代码审阅”。审阅请求说明：批准意味着允许执行列明验证，并在全部通过后以该提交信息提交；这同时落实仓库 Git 先确认要求。

有产品代码反馈则修复、静态检查、重新审阅；不能提前跑测试。纯测试/fixture/harness 修正遵循技能的自主修复例外，但产品代码仍待审时也不能跑测试。schema 或生成 SQL 变化属于产品变更。

### 8.5 审阅后验证

先按最终文件位置校正测试路径，检查环境变量，使用隔离 SQLite 和受控 LLM/通知替身。基础命令候选：

```sh
pnpm check:backend-boundaries
pnpm --filter @jixie/shared build
pnpm --filter api test src/jobs tests/job-lifecycle.integration.test.ts tests/import-aliases.test.ts src/bootstrap.test.ts
pnpm --filter api test src/strategy/backtests src/strategy/scans src/factor/evaluations src/factor/correlations src/signals src/research/embedded src/research/curator
pnpm --filter api test tests/factor-worker.integration.test.ts
pnpm --filter api build
JIXIE_TEST_COMPILED=1 pnpm --filter api test tests/factor-worker.integration.test.ts
```

还必须执行新 migration 回归及受状态读取影响的 datasets、holdout、publication、sharing 等测试，不把上面列表当成完整覆盖证明。选择适当的相关测试或 API 全套，避免无理由重复运行。Web/shared 若有变更，加入对应构建/测试。

生产路径验证须使用干净编译输出，不能让旧 dist 中 infra/jobs 文件掩盖漏改；通过新的输出目录或安全清理自身构建产物实现，不使用未获许可的 rm -rf。真实源码/编译启动需覆盖恢复→唤醒→消费顺序，服务结束后确认端口、连接和 Worker 已释放。

若进行 E2E，必须检查并在最终回复直接展示本次截图。禁止真实发邮件、触发实盘或对外通知；验证使用替身。数据库升级验证用旧 migrations + 历史 fixtures + 新 migrations，db push 不能代替升级测试。

## 9. 验收矩阵

| 方面 | 必须证明 |
| --- | --- |
| 唤醒 | 首次通知、微任务前重复通知、query/claim await 期间通知、循环结束后通知均不丢失；没有重入或轮询 |
| 名额 | 全局/用户上限、饱和用户跳过、FIFO 可执行顺序、成功/失败释放、取消但资源未退出不提前释放 |
| 原子性 | claim 最多成功一次；结果写入失败或 Job 更新失败都回滚；取消后迟到结果不落库；正常返回却未终结能被识别 |
| 错误 | 非法 kind（含原型属性名）、损坏 payload、业务/事务异常、失败持久化异常；Embedded 仍按真实关联释放锁 |
| Worker | log 转发、重复终态、done 后等待正常退出、非零退出、无结果退出、spawn 失败、解析失败与资源收尾 |
| 日志 | 活跃增量读取、owner 隔离、终态冻结/落库、TTL 后回读、取消日志、无提交侧重复初始化 |
| 七类业务 | 表中所有业务效果保持；Curator 全部 findings 原子提交；相关性失败不覆盖成功缓存 |
| Signals | 多 attempt 最新规则一致；旧结果不能覆盖新 attempt；账户先于通知；失败通知和附加动作错误边界 |
| Research | Job.done + execution.error 合法；冻结/证据/输入中断/activeRunId 释放；普通文档执行不受影响 |
| 状态消费者 | 所有准入、去重、分页、统计、datasets 和用户隔离依据新来源；holdout 数据与日志不泄露 |
| 历史迁移 | 合法无 Job 报告仍可见、状态/error 不丢；旧成功/失败/中断、多 Signal Job、普通 Research fixtures 正确；无伪造输入/用户/时间 |
| 启动/部署 | 中断恢复原子、queued 续调度、模块导入不消费、CLI 不恢复活跃 API 任务、源码/生产别名与 Worker 路径都有效 |

## 10. 实施与审查记录

以下为本次实现状态；历次设计调整与审阅过程保留在后续记录，最终结果以 2026-09-24 验证记录为准：

| 项目 | 当前状态 |
| --- | --- |
| 设计方向 | 用户最终确认：七个普通生命周期对象、统一 JobService、Scheduler/Logs 单例、事件唤醒与两个标记 |
| 开发文档与 prompt | 保留初始交接 prompt；当前实现和用户后续修订在本文与 Jobs README 记录 |
| 文档检查 | 当前架构、入口、契约与验收记录已同步 |
| Gate 1 的实现范围/提交信息 | 已确认完整范围及 `refactor(jobs): simplify background task execution`；允许扫描历史报告 jobId 为 null |
| 产品代码/迁移 | 完成；Prisma 生成的迁移原样保留，隔离升级回归通过 |
| 静态检查 | 全仓 typecheck、变更文件 ESLint/Prettier、边界与 diff 检查通过 |
| Gate 2 / SQL 审阅 | 用户分别明确确认，已授权后续验证与提交 |
| 行为验证/清理 | 全部必要验证通过；临时数据库与 Worker 清理完成，未启动 HTTP 服务 |
| Commit / push / deployment | 本记录随 `refactor(jobs): simplify background task execution` 提交；push 由用户手动，未部署 |

最终通过后记录实际静态与行为命令、结果、隔离数据位置/清理情况、审阅批准和 commit hash。按技能只暂存本任务文件；验证通过且已有审阅/提交授权后直接提交，不新增重复确认。失败或未完成的验证不能标通过。


### 实现中的待确认事项

- Signals 最新 attempt 的筛选必须在分页/计数前由数据库执行。Prisma 6 的现有一对多 relation filter 无法直接表达同表按 createdAt/id 比较的 NOT EXISTS。
  用户已明确批准仅在 Signals 状态筛选使用参数化 SQL 的窄例外；由 completedSignalRunIds 在数据库用 NOT EXISTS 选定最新 attempt，分页/统计消费者仍使用 Prisma。其余写入与查询继续遵守 ORM 优先。
- 用户已批准 CLI 条件 claim 后直接执行 Job；已移除文件唤醒。CLI 独立于 API 调度名额，不执行全局恢复。
- 所有行为测试、构建、迁移生成、数据库升级及运行验证均未执行；没有 commit、push 或部署。

### 2026-09-22 可读性反馈

用户要求将 jobs 目录中管理状态的嵌套闭包改为 class。此次调整将 scheduler 的状态与派发方法收进
`JobScheduler`，将 Worker 的资源、终态与监听器收进内部 `WorkerRun`。业务函数注册和
`runWorker` 入参保持不变；这项授权允许基础设施使用具体类，不恢复通用业务生命周期框架。
同步调整装配点、测试与 fixture；沿用提交信息 `refactor(jobs): simplify background task execution`。
产品仍待审阅，行为测试、构建、迁移生成与提交继续暂停。

此次 class 调整的静态检查已通过：涉及文件的 Prettier 检查、jobs 与 E2E fixture 的 ESLint、
全仓 `pnpm typecheck`（含后端边界扫描和 SDK 生成物一致性），以及 `git diff --check`。
未运行行为测试、构建或迁移；这些静态结果不代表整体重构已验收。

### 2026-09-22 CLI 简化反馈

用户确认 CLI 不经过 API scheduler，直接执行 Job。Signals 每日批处理和 Maintenance 调用的相同入口
在入队后 claim，成功则 await executeJob，失败则等待已有执行者。删除 wakeup.ts 及其测试，取消
目录散列、文件通知和 watcher 资源；API 仍使用进程内调度。仅为该批处理开放 start.ts 的装配依赖，
不开放通用 jobs 对业务的依赖。CLI 串行执行，名额独立于 API。测试已补充，尚未运行。

### 2026-09-22 旧实现残余清理

按用户反馈，wake 改为普通 public 方法。删除仅供旧测试使用的 selectFairQueuedJobs，
公平性验证改为驱动真实 JobScheduler。Factor 提交入口移除 launchWorker 测试旁路、
无消费者的 exitedMessage 参数及提前初始化日志；测试改为断言冻结 payload 和队列唤醒。
日志淘汰辅助函数不再导出。同步修正领域 README 中旧任务对象、生命周期回调及日志时机描述。
保留明确要求的历史 legacy 状态/error 回读，不将数据兼容误删为框架残余。

本次清理已通过修改文件的格式/Lint 检查、全仓 pnpm typecheck 和 git diff --check；
静态检索未发现旧工厂、launchWorker、文件唤醒或旧 jobs 导入残留。行为测试未运行，未提交。

按用户反馈，进程内实例引用与注册/唤醒入口已收进 JobScheduler 静态成员；删除模块级
installedScheduler、installJobScheduler 和 wakeJobQueue，调用点直接使用类的静态方法。

用户进一步明确 scheduler 是全局单例：最终公开 API 仅为 static initialize(execute, config?)
与 static wake()。构造函数私有，移除 install、外部实例创建与卸载函数；重复初始化报错，
初始化本身不派发，bootstrap 在恢复后初始化并显式唤醒。测试通过模块隔离重置单例。

按用户反馈，日志模块改为 JobLogs 单例 class，缓冲和定时器由私有实例持有，操作使用静态方法。
删除原散装函数导出并同步执行、终态事务、取消与测试调用点；保留日志初始化、冻结、TTL 和历史回读语义。

### 2026-09-23 Worker 协议一致性

按用户要求核查全部 runXxxTask。五个 Worker 任务移除消息回调内创建 schema 的逻辑，发送与接收
共用业务 worker-protocol.ts；日志/错误信封复用 jobs/worker-protocol.ts。回测结果完整覆盖费用、
因子血缘、配置归因与风险诊断；扫描覆盖指标与 NAV；Signals 覆盖条件单和冻结持仓字段，删除
解码后的强制结果断言。扫描 cell 增加同协议校验，非法消息终止子进程并等待 close。
Weather 是 Factor execution 的另一个消费者，同步使用其协议和等待资源退出的 runWorker。
Embedded/Curator 无独立 Worker 传输，保持普通函数调用。新增协议回归和完整类型结构一致性检查，
本轮仍仅静态检查，不运行行为测试、构建或迁移，不提交。

本轮协议修改的 Prettier、ESLint、全仓 pnpm typecheck（含依赖边界与生成物一致性）及
git diff --check 已通过。新增协议测试仅完成静态检查；全部行为验证仍待代码审阅，未提交。

按用户反馈，回测命名在输入校验后与 Worker 并发启动，仅使用冻结 input。命名失败只记日志；
Worker 成功或失败都等待命名收尾，不遗留未跟踪 Promise。新增并发与失败收尾测试，尚未运行。

按用户确认，回测持久化输入契约提取到 strategy/backtests/job-payload.ts。submit 使用
satisfies BacktestJobPayload 约束保存对象，task 使用同一 schema 解析数据库 JSON，删除 task 内重复定义。

## 2026-09-23 生命周期契约修订

用户确认把 start.ts 与 storage.ts 的生命周期职责合并为 JobService；七类业务从 task.ts 改为 job-lifecycle.ts，
导出普通对象并用 `satisfies JobLifecycle<Result>` 检查契约，不建立业务 class、继承、工厂、上下文适配或 DI 容器。

- `jobs/lifecycle.ts` 定义 onExecute（必选）以及 onSuccess/onFailure/onInterrupted/onCommitted（可选）。
- `jobs/service.ts` 集中注册、查询、领取、执行、终态事务与恢复。注册存于私有 Map，不暴露另一层注册器。
- `jobs/register.ts` 仅显式装配七类业务，无导入时注册/调度副作用；bootstrap 和 CLI 主动调用。
- onExecute 返回类型化结果后，JobService 条件终结 Job 并在同一事务调用 onSuccess。
- onFailure/onInterrupted 与 error/stale 同事务；onCommitted 在 done/error 提交后运行，失败不改写 Job。
- relation 注册元数据仅用于真实关联清理/通知：researchExecutionId 和 signalRunId；损坏 kind/payload 不妨碍 Embedded 收尾。
- backtest 命名与 Worker 并发且都等待；Worker 实际退出才返回；SignalRun 仍只接受最新 attempt，提交后再次核查。
- FactorWorkerError 区分 Worker 失败与输入/完成事务错误，仅前者写本地化 failureMessage。
- 删除 start.ts、storage.ts、runXxxTask、finishJob/failJob 外部 API，不保留兼容转发。

API/CLI、边界检查、现有测试和当前架构文档同步更新。生命周期集成测试改为验证 onExecute 返回后自动完成，
同时保留回滚、错误持久化失败、取消竞争、损坏 metadata、最新 attempt 与通知异常覆盖。
当前仍处于人工代码审阅前；行为验证与 migration 生成尚未执行。计划提交消息保持
`refactor(jobs): simplify background task execution`。

本次静态检查：全仓 `pnpm typecheck` 通过（包含后端边界扫描、SDK 生成物一致性与各 workspace 类型检查）；
全部变更 TS/MJS 的 ESLint 通过；变更代码格式化完成，`git diff --check` 通过。
补充自动完成结果真实落库、重复注册防覆盖，以及 Embedded 在未知/错误 kind 和损坏 payload 下的失败/恢复清理用例；
这些行为测试尚未运行，不能据此宣称运行行为已验证。

用户随后确认文件名写全，采用 `<业务模块>-<任务名>-lifecycle.ts`，例如 strategy-backtest-lifecycle.ts。
七类文件及源码/测试导入、README 和当前架构文档同步重命名；行为和导出对象名保持不变。

导出对象名随后同步为文件名对应的完整驼峰名称：strategyBacktestLifecycle、signalsRunLifecycle、researchEmbeddedAnalysisLifecycle；其余四个名称已符合规则。注册、测试和文档引用同步更新。

## 2026-09-23 Job payload 与 Worker 输入统一

用户确认一起处理七类生命周期的输入契约缺口：六类新增业务 job-payload.ts，回测扩展已有契约。
提交端引用 schema 派生类型，生命周期统一 parse；Factor 普通分析与 holdout 都受同一类型约束。
回测/扫描 Worker schema 从 Job payload 派生，相关性共用完整 schema；Factor execution 独立定义
公共输入，正式 Job 扩展失败文案与 spec 规范化，Weather 直接复用公共输入。

四类 Worker 去掉手写 workerData 类型断言，在现有错误处理/资源释放范围内解析 schema。
扫描抽取公共基础 spec/参数值结构，保留原 HTTP 限制与持久化读取规则。没有变更 Prisma schema 或 Job kind。

增加 job-payload.test.ts 覆盖七类 JSON 往返、Worker 子集、扫描 HTTP/持久化规则区别、Factor 正式/天气
输入与规范化、非法输入；现有 Worker 集成测试补充回测非法输入的 error 消息与退出覆盖。
计划提交仍为 `refactor(jobs): simplify background task execution`，尚未行为验证或提交。

本轮静态检查通过：全仓 pnpm typecheck（含后端边界与生成物一致性）、122 个变更代码文件的 ESLint/格式化、git diff --check。新旧行为测试均未在本轮执行。

## 2026-09-23 代码审阅通过与迁移 SQL 交接

用户表示“没有其他问题了，继续”，批准当前产品代码的审阅。按执行 prompt 的迁移独立审阅要求，
先用临时 SQLite 重放所有旧 migrations，再使用 Prisma 6 `migrate dev --create-only --skip-generate --skip-seed`
生成 `apps/api/prisma/migrations/20260923040832_simplify_background_jobs/migration.sql`。
生成文件原样复制入仓库，未手写或修改 SQL；SHA-256：
`e70041a14a189b1174b1b88de59794d4e95d5b9c184430440770acc016d22d03`。

静态对照临时旧库的列定义，五张表的唯一列属性变化均为 status 可空；FactorReport 的 done 默认值及
ResearchCuratorRun 的 queued 默认值同时移除。每张表的 INSERT SELECT 覆盖全部原列且列名逐项对应。
物理 status/error 列名保持；SQLite 通过重建五张表完成修改，SQL 中无创建/回填 Job 操作。
`git diff --check` 通过。临时生成库已清理，没有连接用户开发库或生产库，也没有启动服务。

新 migration 尚未应用；升级回归、其余测试、源码/编译 Worker 验证和构建等待 SQL 审阅后执行。
代码未提交，计划提交仍为 `refactor(jobs): simplify background task execution`。


### 2026-09-24 审阅后验证与完成记录

用户已批准产品代码与独立生成的 Prisma SQL。验证过程中仅修正测试/fixture：Prisma PRAGMA 的 bigint
断言、回测 Worker 替身返回值、Factor 历史终态与活动 Job 关联、Signals 重试字段断言、Research Catalog
的 Job/历史状态查询断言；没有修改已审阅产品行为，也没有更改生成的 migration SQL。

最终结果（失败项修正后仅重跑必要文件，以下计最终通过结果）：

| 验证 | 结果 |
| --- | --- |
| `pnpm check:backend-boundaries` | 30 个检查器测试通过；835 文件、0 违规 |
| Jobs、lifecycle、payload、Worker 协议、原生别名与 bootstrap 回归 | 100 个测试通过，含真实旧库升级迁移回归 |
| Strategy/Factor/Signals/Research/Sharing 业务回归 | 275 个测试通过，含单独启用的 Signals accounting 流程 |
| Research Catalog、backtest risk、Factor weather 补充消费者回归 | 18 个测试通过 |
| `tests/factor-worker.integration.test.ts` 源码入口 | 13 个测试通过 |
| 同文件 `JIXIE_TEST_COMPILED=1` 编译入口 | 13 个测试通过 |
| `pnpm typecheck` | shared、API、docs、sandboxd、web 全部通过；SDK 生成一致性通过 |
| 变更文件 ESLint、Prettier 与 `git diff --check` | 通过 |
| shared、API、Web 构建 | 通过；Web 仅有 bundle 大小提示 |

真实 Python 测试显式使用仓库 `.venv/research-py-v1/bin/python3`；系统 Python 缺少所需包的初始失败
不计作通过。Embedded 的 9 个真实 Python 测试均通过，覆盖数据证据、图表、取消、保留输入及继续研究。

API 首次构建前将旧 dist 移到任务临时目录，从空输出构建；源码与编译入口均实际覆盖
恢复→唤醒→消费、四种策略/因子语言组合、扫描 cell、Signals IPC、非法输入和实际退出。
编译输出无旧 infra/jobs 文件。共享类型变更经 Web 构建验证，没有运行浏览器 E2E。

升级测试使用旧 migrations 建库、写入历史记录后应用新 migration，核对历史结果、空值/default、关联及
不伪造 Job；会计验证另用完整 migrate deploy 的隔离 SQLite。所有临时 fixture 由测试清理；旧构建备份
也已清理。没有启动 API/Web/dev server，没有发送真实通知或执行维护、同步、交易流程；未触碰开发库或生产库。

本次提交信息保持 `refactor(jobs): simplify background task execution`。提交 hash 随完成回复交付；不 push 或部署。
