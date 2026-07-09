# 设计: `/api/app` 路由命名改造

> 2026-07-09 起草;同日修订一:回测从顶层 `/backtest` 收进 `/strategy/backtest`,与 `/factor/analysis` 对齐(方案 A)。
> 同日修订二(评审后):**砍掉双挂窗口,每 Phase 原子切换**——client/server 同仓同发布、URL 不落库不进缓存,双挂是给「客户端与服务端不同步发布」场景准备的,本项目不存在该场景;开放问题 1–4 落定(见文末)。
> 动机:`apps/api/src/server.ts` 挂载点单复数混用、三条产品线不对称,读代码与写 client 时都要「记特例」。
> 本文是执行真相源;只改路径与文件边界,**不改业务语义**(含 Job / lastResult / FactorReport 落库方式)。

## 一句话

统一规则:**复数 = 可持久化资源 CRUD;单数工作台前缀 = 该域的动作(agent / name / run / backtest / analysis);
跨实体基础设施只留真正跨域的**(`/agent` turn 总线、`/market` 行情辅助)。三条线同一套,分阶段迁,每阶段原子切换。

## 现状盘点(2026-07-09)

```
app.use('/api/app/*', requireAuth);
app.route('/api/app/backtest', backtestRoute);       // 顶层 · 策略回测 job(历史独立)
app.route('/api/app/strategy', strategyRoute);       // 单数 · 动作(agent/name)
app.route('/api/app/strategies', savedStrategyRoute);// 复数 · CRUD
app.route('/api/app/screens', savedScreenRoute);     // 复数 · CRUD
app.route('/api/app/factors', factorRoute);          // 复数 · CRUD+动作+分析 全揉
app.route('/api/app/agent', agentRoute);             // turn 基础设施
app.route('/api/app', screenRoute);                  // 挂在 app 根 → /screen、/names、/stock…
```

| 域 | 资源 CRUD | 工作台动作 | 问题 |
| --- | --- | --- | --- |
| Strategy | `/strategies` | `/strategy/agent`、`/strategy/name`;回测却在顶层 `/backtest` | 单复数拆法清晰,但回测与因子分析不对称 |
| Screen | `/screens` | `/screen`、`/screen/agent`、`/screen/conversations` | 动作挂在 `/api/app` 根上;另有 `/names`、`/stock/:code/series`、`/index/...` 混进 screen 文件 |
| Factor | `/factors/custom` 等 | `/factors/agent`、`/name`、`/analysis`… | 全在复数下,没有「动作 vs 资源」边界 |
| 共享 | — | `/backtest`(实为策略域)、`/agent` | `/agent` 合理;`/backtest` 应收回 strategy |

前端真相源:`apps/web/src/api/client.ts`。e2e:`apps/web/e2e/*.mjs` 硬编码了旧路径。

## 命名规则(拍板)

1. **资源(名词复数)**:列表 / 读写 / 删除。例:`GET|POST /strategies`、`GET|POST|DELETE /strategies/:id`。
2. **工作台动作(单数域前缀)**:agent 一轮、起名、跑一次查询/回测/分析。例:`POST /strategy/agent`、`POST /strategy/backtest`、`POST /factor/analysis/run`、`POST /screen/run`。
3. **跨实体基础设施**:只挂真正跨域的 —— `/agent`(turn SSE)、`/market`(行情只读辅助)。**重计算 Job 跟所属产品线走**,不因「共用 Job 表」就抬到顶层。
4. **市场只读辅助**(股票名、K 线、指数序列):从 screen 文件拆出,挂 `/market/*`,避免「选股路由文件」变成杂物间。
5. **文件名跟挂载点对齐**:`routes/strategies.ts`(CRUD)、`routes/strategy.ts`(动作,含 backtest);screen / factor 同理。现有 `saved-*.ts` / `backtest.ts` 可在迁完后改名、合并或保留 re-export 一版。

### 为何回测进 `/strategy`,而不是继续顶层(方案 A)

回测与因子分析都是「某实体上的重计算 Job」:

| | 回测 | 因子分析 |
| --- | --- | --- |
| 入参 | `strategyId` + config | `factor` + freq/区间/中性化 |
| Job | `kind=backtest` | `kind=factor` |
| 结果 | `Strategy.lastResult`(1:1 最新快照) | `FactorReport`(1:N 参数缓存) |

落库形态不同(快照 vs 多报告缓存)是产品语义,不构成「回测必须顶层路由」的理由。对称切法:

- **A(本文采用)**:都挂单数工作台 —— `/strategy/backtest` ↔ `/factor/analysis`
- B(不采用):都抬成计算底座 —— `/backtest` + `/factor-analysis`(会把因子 runs/correlation 从工作台拆散)

### 刻意不做

- 不改 Prisma model / 表名 / JSON 字段语义(`Strategy.lastResult`、`FactorReport`、`Job` 原样)。
- 不做「一切 nested under resource」的纯 REST 教条(如 `POST /strategies/:id/backtest`)——query/body 已带 id,嵌套收益小、破坏面大。
- 不把回测结果改成独立 `BacktestReport` 表(无「多窗口货架」需求前不抽象)。
- 本期不引入 API version 前缀(`/v2`);也**不做双挂过渡**(见迁移策略)。

## 目标路径表

### Strategy

| 方法 | 目标路径 | 今 | 说明 |
| --- | --- | --- | --- |
| CRUD | `/strategies`、`/strategies/:id` | 同左 | 不变 |
| Agent | `/strategy/agent` | 同左 | 不变 |
| Name | `/strategy/name` | 同左 | 不变 |
| Backtest job | `/strategy/backtest`、`/strategy/backtest/:jobId`、`/strategy/backtest/running` | `/backtest…` | **收进单数工作台**,与 factor analysis 对称;`?strategyId=` 仍在 query |

### Screen

| 方法 | 目标路径 | 今 | 说明 |
| --- | --- | --- | --- |
| CRUD 收藏 | `/screens`、`/screens/:id` | 同左 | 不变 |
| 跑 ScreenSpec | `POST /screen/run` | `POST /screen` | 显式动词,避免与资源单数混淆 |
| Agent | `POST /screen/agent` | 同左 | 挂载从 `/api/app` 改为 `/api/app/screen` |
| Conversations | `/screen/conversations[/:id]` | 同左 | 会话是工作台态,不进 `/screens` |
| 股票名批量 | `GET /market/names?codes=` | `GET /names` | 拆出 |
| 个股序列 | `GET /market/stocks/:code/series` | `GET /stock/:code/series` | 拆出 |
| 指数序列 | `GET /market/indices/:code/series` | `GET /index/:code/series` | 拆出 |

### Factor

| 方法 | 目标路径 | 今 | 说明 |
| --- | --- | --- | --- |
| Catalog | `GET /factors/catalog` | 同左 | 只读目录,留在复数下合理 |
| Custom CRUD | `/factors/custom`、`/factors/custom/:id`、`.../fork` | 同左 | 资源;可选远期收成 `/factors` 但 **本期不动** 以免与 catalog 撞车 |
| Agent / QA / Name | `/factor/agent`、`/factor/qa`、`/factor/name` | `/factors/agent` 等 | **迁到单数**,与 strategy 对齐 |
| Analysis job | `/factor/analysis`、`.../run`、`.../job/:id`、`.../running` | `/factors/analysis…` | 迁到单数;与 `/strategy/backtest` 对称 |
| Correlation job | `/factor/correlation…` | `/factors/correlation…` | 同上 |
| Runs 缓存清理 | `/factor/runs` | `/factors/runs` | 跟分析走,单数 |

### 共享(真正跨域)

| 路径 | 说明 |
| --- | --- |
| `/agent/turns/...`、`/agent/sql` | 统一 turn 总线(strategy/factor/screen 共用) |
| `/market/...` | 行情只读辅助(从 screen 拆出) |

### 目标 `server.ts` 挂载(示意)

```ts
app.use('/api/app/*', requireAuth);

// 跨实体底座
app.route('/api/app/agent', agentRoute);
app.route('/api/app/market', marketRoute);

// 资源 CRUD(复数)
app.route('/api/app/strategies', strategiesRoute);
app.route('/api/app/screens', screensRoute);
app.route('/api/app/factors', factorsRoute); // catalog + custom CRUD

// 工作台动作(单数)
app.route('/api/app/strategy', strategyRoute); // agent, name, backtest
app.route('/api/app/screen', screenRoute);     // run, agent, conversations
app.route('/api/app/factor', factorRoute);     // agent, qa, name, analysis, correlation, runs
```

读起来应能一眼分清:复数 = 我的东西;单数 = 我在干活;agent/market = 底座。  
实现上 `backtestRoute` 可继续独立文件,再 `strategyRoute.route('/backtest', backtestRoute)` 挂进去——文件边界与 URL 前缀解耦。

## 迁移策略

### 原则

- **行为不变**:handler 原样搬迁,只改挂载前缀与 client URL。
- **原子切换,无双挂**:每个 Phase 在同一提交内完成 server 挂载 + `client.ts` + e2e 的切换。依据:client/server 同仓同发布,URL 不落库、不进浏览器缓存,不存在「旧客户端打新服务端」窗口;砍掉双挂同时消灭「双挂忘记删除」风险与专门的删旧 PR。
- **一次改一条产品线**,避免大爆炸;每条线切完跑该线 e2e 验收。

### Phase 0 · 约定落地(本文) ✅

- 本文入 `docs/design/`;`ROADMAP` 4.4b 指针。
- 实施前在 `server.ts` 顶部注释写清「复数资源 / 单数动作 / 底座」三行规则。

### Phase 1 · Screen 挂载整形(收益最大、破坏面中等)

1. 新建 `routes/market.ts`,迁出 `names` / `stock/.../series` / `index/.../series`。
2. `screenRoute` 改为挂在 `/api/app/screen`;`POST /screen` → `POST /screen/run`;删除根挂载 `app.route('/api/app', screenRoute)`。
3. 同一提交内更新 `client.ts`、screen 相关 store、e2e。

验收:选股页跑通;卡片重跑;conversation CRUD;交易详情页的股票名/指数曲线仍正常。

### Phase 2 · Factor 动作迁到单数

1. 从 `factor.ts` 拆出(或同文件分区)动作路由,挂 `/api/app/factor`。
2. 复数 `/factors` 只留 `catalog` + `custom` CRUD。
3. 同一提交内 client + factor complex + e2e 改 URL,旧路径直接删除。

验收:预置/自定义因子分析、相关矩阵、agent 改代码、命名、runs 清理。

### Phase 2b · Backtest 收进 `/strategy`(与 Phase 2 同波或紧随)

1. 将 `backtestRoute` 挂到 `/api/app/strategy/backtest`(文件仍叫 `backtest.ts`,由 `strategy` 路由 `route` 进去——文件独立、URL 挂入,已拍板)。
2. **注册顺序陷阱**:Hono 按注册顺序匹配,`GET /backtest/running` 必须注册在 `GET /backtest/:jobId` 之前,否则 `"running"` 会被当 jobId 吞掉。搬迁时保持 `backtest.ts` 内部现有顺序,新增路由也遵守「字面量路径先于参数路径」。
3. 同一提交内 client(`submitBacktest` / poll / running)+ lab store + e2e 改 URL,删除顶层 `/api/app/backtest` 挂载。

验收:Lab 跑回测、刷新重挂 running job、结果仍写入 `Strategy.lastResult`。

### Phase 3 · 文件与命名收尾

- `saved-strategy.ts` → `strategies.ts`,`saved-screen.ts` → `screens.ts`(或 re-export 别名)。
- `strategy.ts` / `screen.ts` / `factor.ts` 文件头注释与路径表对齐;`backtest.ts` 注明「mounted under /strategy」。
- grep 全库残留:`/api/app/backtest`、裸 `'/names'`、`'/stock/'`、`/factors/agent|analysis|correlation|runs` 等(连单复数一起查——`/strategy` 与 `/strategies` 差一个字母,肉眼 diff 易滑过)。
- typecheck + 全量 e2e。

### Phase 4(可选,不阻塞)

- 评估 `/factors/custom` 是否收成 `/factors`(需解决与 `catalog`、未来集合资源的路径设计)。
- 评估 agent/backtest 是否改为 `POST /strategies/:id/...`(嵌套 REST);**默认不做**,除非出现多处「忘记传 id」的 bug。

## 改动面清单(给实施会话)

| 层 | 文件 |
| --- | --- |
| 挂载 | `apps/api/src/server.ts` |
| 路由 | `routes/backtest.ts`、`strategy.ts`、`screen.ts`、`saved-screen.ts`、`factor.ts`、新建 `market.ts` |
| 前端 API | `apps/web/src/api/client.ts` |
| 调用方 | `complex/lab/*`、`complex/screen/*`、`complex/factor/*`、交易详情里拉 series/names 处 |
| 测试 | `apps/web/e2e/*.mjs`;api 侧若有 route 级测试一并改 |
| 文档 | 本文;必要时 `unified-agent.md` 里出现的旧路径改一句 |

## 风险与回滚

- **漏改硬编码 URL**:e2e + 全库 grep `/api/app/` 做验收门禁;单复数差一个字母,grep 时两种拼法都查。
- **路由注册顺序**:字面量路径(`/running`)必须先于参数路径(`/:jobId`)注册,见 Phase 2b。
- 回滚:恢复 `server.ts` 旧挂载即可(handler 未改语义);原子切换意味着回滚也是单提交 revert。

## 已决问题(2026-07-09 评审落定)

1. 市场辅助挂 **`/market`**(比 `/ref` 直白)。
2. factor 的 `custom` 子路径本期**不扁平化**,与「单复数对齐」解耦(远期 Phase 4 再议)。
3. `Deprecation` 响应头**不加**——已无双挂窗口,问题自动消解。
4. `backtest.ts` **文件独立、URL 挂入** `strategy`(与 factor analysis 分文件同理),避免单文件过大。
