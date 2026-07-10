# 设计:策略 Run / 建行编排收归后端

> 2026-07-10 起草。
> 动机:Lab 点 Run / 首次 Agent 时,前端串了 `name → create → update config → backtest → poll → getStrategy`,以及 Run 后异步 `refreshName`。命名与「Run 时 commit config」都是自动副作用,却由客户端编排——漏调一步会留下「结果在、存档代码不对齐」的脏状态;别的客户端也难复用。
> 本文是执行计划真相源;与 `api-route-naming.md` 正交(路径已对齐,本文改**用例边界与副作用归属**)。

## 一句话

**自动发生的副作用(起名、Run 时写 config、可选 Run 后刷新名)归服务端用例;前端只触发 create / agent / run / poll / open。** 保留资源更新口,但 Lab 主路径不再依赖它。

## 现状(问题)

### 前端编排(`lab-store.ts`)

| 用例 | 今日调用链 |
| --- | --- |
| 首次 Agent | `POST /strategy/name` → `POST /strategies` → `POST /strategy/agent` → SSE |
| Coding 首次 Run | `POST /strategy/name` → `POST /strategies` → `POST /strategies/:id` → `POST /strategy/backtest` → poll → `GET /strategies/:id` |
| 已有策略再 Run | `POST /strategies/:id`(config) → `POST /strategy/backtest` → poll → `GET /strategies/:id`;后台再 `name` + 可能再 `update` |
| 刷新续跑 | `GET /strategies/:id` → `GET /strategy/backtest/running` → poll |

产品语义本身合理:

- messages:Agent turn 服务端实时落库
- config:未 Run 的编辑故意不落库(`dirty` / `edited`)
- 名字:用户不可手改,LLM 自动生成;Run 后带 `currentName` 仅在逻辑漂移时改名
- Job status 落库、logs 内存、结果在 `Strategy.lastResult`

不合理的是:**把上述自动步骤拆成多个公开 API,由前端保证原子组合**。

### 风险

- 只 `submitBacktest`、跳过 `updateStrategy` → worker 仍写 `lastResult`,但 DB 上 config 可能仍是旧代码 → **可展示但不可复现**。
- `POST /strategy/name` 对 Lab 无交互价值(无手改 UI),却强制多一次 LLM 往返与失败分支。
- 编排真相只活在 `lab-store.ts`,脚本 / 未来客户端易调错。

## 目标语义

| 副作用 | 归属 | 触发点 |
| --- | --- | --- |
| 首次起名 | 服务端 | `POST /strategies` 建行时(可带 `prompt` 或已有 `config.code`) |
| Run 时 commit config | 服务端 | `POST /strategy/backtest` 在同一事务内写 config/name、按 `runKey` 清 `lastResult`、创建 Job |
| Run 后刷新名 | 服务端 | 与 worker 并发执行;逻辑同今日 `refreshName`(带 `currentName`,贴切则不变),Job 进入 done 前等待其完成/失败 |
| messages | 服务端 | 不变(Agent turn runner) |
| lastResult | 服务端 | 不变(worker 结束写) |
| 续跑 `/running` | 保留 | 仅 open/refresh,不进 Run 主路径 |

前端 Run(已有 `strategyId`):

```
POST /strategy/backtest?strategyId=…  { config }
→ poll GET /strategy/backtest/:jobId?since=
→ done 时 GET /strategies/:id 取 lastResult   // 可选后续优化:done 响应内嵌 result
```

前端首次建行(Agent 或手写首次 Run 仍需 id):

```
POST /strategies  { name?, start, end, initialCash, cost?, code, prompt? }   // 服务端起名 + 去重
→ 再 agent 或 backtest
```

## API 变更

### 1. 加强 `POST /strategy/backtest`

在现有「校验区间 → `createJob` → spawn worker」之前增加:

1. 校验 `strategyId` 归属当前用户(今日未显式查行,建议补上;不存在则 404)。
2. 检查该策略是否已有 running Job;有则拒绝重复 Run,避免旧 worker 后完成而覆盖新结果。
3. 用 body 中的 `BacktestConfig` 更新该行:`name` 去重规则、`runKey` 变化则 `lastResult = DbNull`——**复用** `strategies.ts` 里 update 的同一套逻辑(抽成共享函数,避免两处漂移)。`runKey` 必须包含 `cost` 的全部字段。
4. 在同一个 Prisma transaction 内创建 Job;事务提交后再 spawn worker。worker 入参使用服务端实际落库的 config/name 快照。
5. 并发刷新名:LLM(`code` + 当前名)→ 仅当 DB 的 `runKey` 仍等于本次 Run 时更新 name / config.name;不得因改名清 `lastResult`,也不得用旧 config 整体覆盖新 Run。Job 只在 worker 和命名均 settled 后进入 done,因此前端 done 后 GET 能可靠取到名称。

契约变化:

- 成功语义从「只开 Job」变为「**commit config + 开 Job**」。
- 请求/响应形状可不变(`{ jobId }`);文档与 client 注释改写。

### 2. 加强 `POST /strategies`(建行起名)

今日 create 信任 body 里的 `config.name`(前端先调 `/name` 填好)。改为:

- 若调用方未提供可用名、或显式要自动命名:服务端调用现有命名逻辑(从 `strategy.ts` 的 `/name` handler 抽出共享函数)。
  - 有 `namingPrompt`(或 body 旁路字段 `prompt`)→ 按自然语言起名(Agent 首次)。
  - 否则用 `config.code` 起名(Coding 首次 Run)。
- 去重仍在 create 路径(与今日 server de-dupe 一致)。
- LLM 失败 → 落「未命名策略」类兜底(i18n),不阻断建行。

字段形状建议(二选一,实现时拍板):

- **A**:`POST /strategies` 的扁平 body 增加可选 `prompt?: string`,并让 `name` 在 create 专用 schema 中可选;有 prompt 则按 prompt 命名,否则 name 缺省时按 code 命名。
- **B**:忽略客户端 `config.name`(Lab 场景),服务端总是按 code/prompt 生成;其它调用方若需固定名再另开 `name` 强制字段。

采用 **A**:兼容现有非空 name body;Lab 省略 name,按场景传 prompt 或依赖 code 命名。持久化后的 `BacktestConfig.name` 仍为必填。

### 3. `POST /strategy/name`

- Lab / `client.ts` **停止调用**。
- 路由可暂时保留(内部复用或调试),或改为 thin wrapper 调共享 `proposeStrategyName(...)`。
- 不作为工作台主路径文档的一部分;`api-route-naming.md` 目标表可注「内部/弃用中」。

### 4. `POST /strategies/:id`(update)— **保留,不删**

仍需要:

- 非 Lab 的局部更新、将来「只存不跑」(若产品放开)、以及过渡期。
- `{ messages }` 能力可留(即便 Lab 现走 turn runner)。

Lab 主路径:

- **不再**在 Run 前调用 update。
- **不再**在 `refreshName` 后调用 update(改由 backtest 异步刷新)。

若确认无任何客户端再依赖「仅改 messages 的 POST」,可另开清理任务;本期不删路由。

## 前端变更(`lab-store.ts` / `client.ts`)

1. `ensureStrategy`:去掉 `generateStrategyName`;`createStrategy` 带上 `prompt`(Agent)或依赖服务端按 code 起名;用返回的 `meta.name`。
2. `run`:去掉 Run 前的 `updateStrategy`;有 `savedId` 则直接 `submitBacktest`;保留 `ensureStrategy` 仅负责「无 id 时建行」。
3. 删除 `refreshName` 及对 `generateStrategyName` 的引用。
4. `generateStrategyName` 可从 client 删除或标 deprecated。
5. `openSaved` + `/running` + poll 保持;done 后 `getStrategy` 同时同步 `lastResult` 和服务端名称。可选后续:poll `done` 内嵌结果省一次 GET——单列优化,不挡本期。

产品行为保持:

- 未 Run 编辑仍不自动落库。
- 无手改名 UI。
- dirty / edited 语义不变(Run 成功后 `markSaved` 仍以本地 configKey 为准;以 backtest 成功返回或首轮 poll 为 commit 确认点——若 backtest 在开 Job 前已写库失败,应 4xx,前端不 `startPolling`)。

## 后端实现要点

- 从 `routes/strategy.ts` 抽出 `proposeStrategyName({ code?, prompt?, currentName?, locale })`。
- 从 `routes/strategies.ts` 抽出 `commitStrategyConfig(userId, id, config)`(去重 + `runKey` + 清 `lastResult`)。
- `backtest.ts` 的 POST:在 transaction 内检查 running Job、`commitStrategyConfig`、创建 Job;事务提交后初始化内存日志并 spawn worker。
- 异步改名注意:用本次 `runKey` 做条件更新,只基于 DB 最新 config 改 name / config.name;worker 持有启动时 config 快照。命名失败只打日志,不改变回测结果。
- 进程重启:异步改名未跑完可接受(下次 Run 再刷);不引入新 Job kind。

## 刻意不做(本期)

- 不把 backtest 改成 `POST /strategies/:id/backtest` 嵌套 REST(见 `api-route-naming.md`)。
- 不删 `Job` / 不改 logs 内存 + 结束刷库模型。
- 不强制「无 strategyId 时 backtest 自动建行」(Agent 仍要先有 id 挂 messages;Coding 首次 Run 保持 create → backtest 两步即可,已比今日少 name/update)。
- 不在本期做因子线对称改造(factor 的 `ensureFactor` / analysis commit 可另文;模式相同但表与缓存键不同)。
- 不引入「保存草稿」API(未 Run 不落库的产品选择不变)。

## 迁移阶段

### Phase 1 — 后端能力(兼容旧前端)

1. 抽出 `proposeStrategyName` / `commitStrategyConfig`。
2. `POST /backtest` 事务化 commit config + create Job;拒绝同策略并发 Run;并发 refresh name。
3. `POST /strategies` 支持可选 `prompt` 自动起名(无 prompt 且 name 已有则保持今日行为,便于双写窗口极短)。
4. 单测:`runKey` 覆盖 cost / 清 result;命名失败兜底;backtest 对他人 strategyId → 404;同策略并发 Run 被拒绝。

旧前端多一次 update 再 backtest:**幂等**(相同 config 再 commit 无害)。

### Phase 2 — 前端切主路径

1. Lab 去掉 name / Run 前 update / `refreshName`。
2. 更新 `client.ts` 注释与 e2e(若有硬编码 name 调用)。
3. 手测:空白 Coding Run;Agent 首句建行再 Run;已有策略改代码再 Run;刷新续跑;命名 LLM 失败时仍能建行/开跑。

### Phase 3 — 收尾(可选)

1. 文档:`api-route-naming.md` 将 `/strategy/name` 标为内部/弃用。
2. 确认无调用后,可下线公开 `/name` 或仅留内部模块。
3. (可选) poll `done` 返回 `lastResult` 摘要,去掉额外 GET。

每阶段同仓同发,不做长期双挂。

## 验收清单

- [ ] Coding 模式空白策略点 Run:只出现 create(若需要)+ backtest + poll(+ get);网络面板无 `/strategy/name`、无 Run 前的 `POST /strategies/:id`。
- [ ] Agent 首句:create(服务端起名)+ agent;无独立 `/name`。
- [ ] 再 Run:单次 backtest 即更新 DB config;改 code 后 lastResult 在开跑时被清、结束后被新结果覆盖。
- [ ] Run 后名字在逻辑未变时保持稳定;逻辑大改后会更新且不抹掉新 lastResult。
- [ ] 刷新仍可通过 `/running` 续上日志。
- [ ] 漏调旧 update、只调新 backtest:DB config 与本次 run 一致(修复原脏状态窗口)。
- [ ] 两个客户端同时 Run 同一策略:只有一个 Job 启动,旧结果不能覆盖新 config。

## 开放问题

1. **done 响应是否内嵌 lastResult**:本期不做;若做,注意 payload 体积(含 tradeLog)。
2. **因子线是否跟进**:建议另开 `factor-run-orchestration.md`,不阻塞策略线。
