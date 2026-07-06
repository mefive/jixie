# 设计:每日交易信号 → 分阶段接实盘

> 2026-07-06 设计,对应 `ROADMAP.md` 主线五。方向已定:系统未来接**自动化下单接口**;现阶段做到「每日收盘后自动出信号 + 推送提醒,用户照单手动下单」。这是「机械交易——机器决策、人只执行」的落点。

## 边界与路线(2026-07-06 用户拍定)

**永不做:日内高频 / tick 级 / 日内回转。** 三重否决:T+1 制度性封死股票日内往返;印花税(千 0.5 仅卖)+佣金+滑点的成本结构杀死高换手;高频基础设施(colocation/专线)个人零胜算且正面撞量化私募主战场。jixie 策略全是日频决策(收盘出信号、次开执行),延迟需求是分钟级,**瓶颈是纪律不是速度**。

**自动化的论证 = 拿掉「回撤中拒绝执行的那只手」(纪律的最后一环),不是速度。** 分三阶段:

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 信号生成 + 推送提醒(本文档主体) | ⬜ |
| 2 | 半自动:执行清单勾选 + 实际成交回填;止损走券商条件单 | ⬜ 随阶段 1 尾 |
| 3 | 自动执行:miniQMT/PTrade adapter 实现 SignalExecutor | 💤 远期 |

**日内高频 ≠ 日内止损**:趋势策略的日内触价止损(ROADMAP 2.1)实盘不需要 API——**券商条件单**,人挂一次单、券商服务器盯盘执行,见阶段 2。

## 一句话

策略「上线」后,每个交易日收盘、当日数据同步完成后,自动重放策略至今日,把**明日开盘应执行的订单**(股票/方向/手数/参考价)落库、前端展示并推送提醒。

## 核心洞察:引擎已经会算信号,只是把它丢了

引擎模型(`engine/run.ts`):策略在 D 日 `onBar` 排单(`pendingTargets` 声明式调仓 / `pendingOrders` 按股数),**D+1 开盘成交**。回测跑到最新交易日时,循环结束、最后一天排的单没有「明天」去成交——**残留的 pendingTargets/pendingOrders 恰好就是「明日应执行清单」**,现在被丢弃。

信号模式 = 跑到今天 + 捕获这个残留 + 换算成人能执行的订单。引擎主循环几乎零改动(`runStrategy` 加一个可选返回 `pendingSignals`,或 `EngineConfig` 加 `captureSignals` 开关)。

**手数是真实的**:引擎已按真实股数整手下单(`portfolio.ts`,realShares 落 tradeLog),所以 pendingOrders 的股数可直接执行;pendingTargets(目标权重)需在信号层用**今日不复权收盘价**换算成整手数(与引擎 rebalance 同款取整逻辑)。

## 重放模型:每日全量重放,无状态、幂等

- 每天从策略配置的 `start` **全量重放到今天**,不做增量持仓续跑。Why:策略可能有指标热身/内部状态,增量要持久化引擎状态,复杂且易错;全量重放天然幂等(重跑同一天结果一致)、无隐藏状态。
- 性能可接受:watch 类策略秒级;横截面全市场 ~78s/5年,每天一次无所谓。以后真嫌慢再优化(缓存/窗口),别提前。
- **持仓对齐(现阶段明确不做,写清楚)**:重放假设从初始资金起步,信号 = **模型组合**的目标变化。真实账户与模型的偏差(用户少买了一手、场外加了钱)由用户自行对齐;未来接下单接口时才做账户状态同步(broker 实际持仓 → 与模型 diff → 生成修正单),届时另出设计。

## 数据依赖与时序

- Tushare 当日 daily / adj_factor / daily_basic 约 **17:00-18:00** 后可用(moneyflow/龙虎榜更晚,用到的策略等更晚的档)。
- 任务流程:① `TradeCal` 判今天是否交易日,否则跳过;② 同步当日数据(复用现有 sync,幂等);③ **校验数据真的到了**(Daily 表有今日行数)——没到进入重试;④ 逐个 live 策略跑信号。
- 重试:17:30 首跑,数据未出则 18:30 / 19:30 再试,三次仍无 → SignalRun 落 error 状态,前端可见「今日信号生成失败」。

## Schema

```prisma
model Strategy {
  // …现有字段…
  live Boolean @default(false)   /// 上线开关:每日信号任务只跑 live=true 的策略
}

/// 一次信号生成 = 某策略基于某交易日收盘的「明日应执行清单」。
/// 幂等键 (strategyId, tradeDate):重跑覆盖(upsert)。
model SignalRun {
  id         String   @id            // ULID
  userId     String
  strategyId String
  tradeDate  String                  // 信号基于的收盘日 YYYYMMDD
  execDate   String                  // 应执行日 = 次一交易日(TradeCal 查)
  status     String                  // 'running' | 'done' | 'error'
  error      String?
  signals    Json?                   // SignalItem[],见下
  equity     Float?                  // 重放到 tradeDate 的模型权益(供权重换手数、对照)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([strategyId, tradeDate])
  @@index([userId, tradeDate])
}
```

```ts
/** 一条可机读的订单意图 —— 从第一天就按「未来能直接喂给下单接口」设计 */
interface SignalItem {
  code: string;          // ts_code
  name: string;          // 股票名(展示)
  action: 'buy' | 'sell' | 'setStop'; // setStop = 挂券商条件单(阶段 2,引擎挂单机制 2.1 落地后)
  shares: number;        // 真实股数,整手(卖出清仓可能带零股;setStop 为持仓数)
  refPrice: number;      // 参考价 = tradeDate 不复权收盘价(实际按明日开盘市价成交)
  triggerPrice?: number; // setStop 专用:条件单触发价(不复权)
  refAmount: number;     // shares × refPrice,概算金额
  note?: string;         // 备注:如「目标权重 8%」「止损触发」「涨停可能无法买入」
  // 阶段 2 回填(用户手动录入):
  executed?: boolean;    // 已下单勾选
  fillPrice?: number;    // 实际成交价 → 积累模型 vs 真实账户的对齐数据(阶段 3 地基)
}
```

- **不建 Signal 子表**:一次 run 的 items 是原子整体,JSON 列够用(同 lastResult 先例);要按股票查询了再拆表。
- 涨跌停/停牌风险:引擎回测里会阻断,但信号是「明天的单」,明天涨停与否未知 → 信号照出,`note` 提示(如 tradeDate 已涨停的票标注)。

## 调度(定时任务)

三个入口,一套执行:

1. **进程内 cron(主)**:api 进程用 `node-cron`(或 setInterval 自算,依赖最小)注册工作日 17:30/18:30/19:30;触发后走**现有 Job/worker 管道**(Job.kind 加 `'signal'`,信号重放跑 worker 不阻塞主线程,流式日志复用)。
   - trade-off:api 进程重启会错过当次触发(dev 常见,prod 单进程常驻可接受);胜在零外部依赖、与现有 Job 体系同构。
2. **脚本入口(补跑/外部 cron)**:`pnpm signals:run [dateYYYYMMDD]`——无参=今天,带参=补生成历史某日信号(数据都在,全量重放天然支持回补)。部署后想更可靠可用系统 cron/launchd 调它,进程内 cron 只是默认。
3. **手动按钮(兜底)**:前端「今日信号」页「立即生成」,POST 触发同一管道。

三入口全部收敛到同一个 `generateSignals(tradeDate)` 函数,(strategyId, tradeDate) upsert 保证幂等。

## API 与前端

- 路由 `routes/signals.ts`(挂 `/api/app/signals`,requireAuth,owner-scoped):
  - `GET /today` → 各 live 策略最新 SignalRun;
  - `GET /runs?strategyId=&limit=` → 历史列表;
  - `POST /run` → 手动触发(走 Job,返 jobId 轮询,复用现有 PollingModel);
  - `PATCH /strategies/:id/live` → 上线/下线(或并入现有策略路由)。
- 前端:
  - 导航新条目「今日信号」(complex `apps/web/src/complex/signals/`):每个 live 策略一张卡 → SignalItem 表格(名称/方向红绿/手数/参考价/概算金额/备注),空单也展示「今日无操作」(机械系统的「不动」也是决策);历史 run 时间线可回看。
  - lab workbench:策略页加「上线」开关(antd Switch),live 策略在列表卡片上带标记。
- 展示原则:**参考价 = 不复权真实价**(用户对照券商 app),不是引擎内部的后复权口径。

## 信号提醒(阶段 1 正式范围,2026-07-06 从开放问题升级)

- 信号生成完成(含空信号)→ 推送通知。**空信号日也发「今日无操作」**:机械系统的不动也是决策,且每天到点的通知本身证明系统活着(哪天没收到 = 任务挂了,这是免费的监控)。
- **渠道抽象**:`Notifier { send(subject, body): Promise<void> }`,首个实现 = 邮件(登录已有邮箱验证链路,SMTP 基建现成);未来 Bark(iOS 推送,个人自用最轻)/Telegram 等按需加,实现同一接口。
- 内容:策略名 + 执行日 + 信号摘要(N 买 M 卖,概算金额)+ 链接到「今日信号」页;error 状态也通知(「今日信号生成失败」比静默可怕得多)。
- 发送挂在 `generateSignals` 收尾,失败不影响信号落库(best-effort + 日志)。

## 阶段 2:半自动执行(随阶段 1 尾声做)

- **执行清单**:「今日信号」页每笔可勾「已下单」+ 回填实际成交价(SignalItem.executed/fillPrice,PATCH 更新 SignalRun.signals)——从第一天就积累**模型 vs 真实账户**的成交偏差数据,这是阶段 3 账户对齐的地基,也是滑点模型的实证校准来源。
- **止损条件单**:引擎挂单机制(2.1)落地后,策略里声明的止损在信号侧翻译成 `action: 'setStop'` 项(标的/触发价/数量),用户在券商 app 挂条件单,券商服务器盯盘触发——日内止损的实盘落地,零 API。

## 阶段 3 / 未来:自动化下单接口(本期不做,只留缝)

```ts
interface SignalExecutor {
  execute(run: SignalRun): Promise<ExecutionReport>;
}
```

- 本期唯一实现 = 「人工模式」(什么都不做,用户照单下单);未来 broker adapter 实现同一接口,信号生成侧零改动。
- **通道现实约束(2026-07-06 记录)**:A 股个人程序化 ≈ **QMT/miniQMT**(券商版,常见 50 万资金门槛,**仅 Windows**)或 **PTrade**(券商托管服务器),无 IBKR 式开放 API;同花顺/东财野路子接口是灰色地带不做。届时形态大概率 = 一台 Windows 机器/VM 跑 miniQMT adapter,轮询 jixie API 取信号、回写成交。
- 到那步才需要:账户状态同步(实际持仓 vs 模型持仓 diff)、成交回报回写、风控限额——**届时另出设计,本期不预埋代码,只保证 SignalItem 可机读**。

## 验收标准

1. 一个 live 策略(如曾庆辉或 watch 类趋势策略)在某交易日 17:30 后自动生成 SignalRun,信号与「手动把回测 end 设为当日、人肉读最后一天调仓意图」一致。
2. 手数为整手真实股数、参考价与券商行情对得上。
3. 非交易日不跑;数据未出时按计划重试;重跑同一天 upsert 不产生重复。
4. `pnpm signals:run 20260701` 能回补历史信号。
5. e2e:上线开关 → 手动「立即生成」→ 信号表格渲染(mock 或短区间策略),按前端 e2e 硬规矩截图。

## 开放问题(实现时再定,不阻塞)

- 多策略资金各自独立(每策略一个模型账户)——现设计即如此;「多个策略共享一个真实账户」的资金分配是自动化下单阶段的问题。
- moneyflow/龙虎榜类数据出得晚,依赖它们的策略信号档期是否单独延后(如 20:30 档)。
