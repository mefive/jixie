# jixie 长期功能规划(ROADMAP)

> 2026-07-06 制定。本文档是长期功能的**唯一规划真相源**:设计在此(或 `docs/design/` 详设),执行由后续会话认领;每完成一项把状态从 ⬜ 改 ✅ 并附一句实况。产品原则见 `CLAUDE.md` 与产品哲学:**平台只提供中性工具,不预设用户投资风格;code-first,代码即唯一真相**。

## 状态图例

- ⬜ 待做 · 🚧 进行中 · ✅ 完成 · 💤 明确延后(有前置或等需求拉动)

---

## 主线一 · 回测可信度(让数字不骗人)

平台全部价值建立在「回测结果可信」上,这条线优先级最高。

### 1.1 滑点 / 冲击成本 🚧

- **现状**:引擎已实现(`engine/run.ts` `execPrice`:基础半价差 + 按订单额/当日成交额的冲击项,上限 10% 防流动性荒谬成交)。收尾中。
- **剩余**:参数是否暴露为可配置(策略/全局)、前端结果页是否展示滑点损耗合计,按需求补。

### 1.2 参数扫描 + 样本内/样本外 ⬜

**是什么(通俗)**:同一个策略,把某个参数(比如均线周期 20)换成一组值(10/20/30/60)各跑一遍回测,把结果摆成表格/热力图对比。

**为什么(防过拟合的核心工具)**:好策略应该在**相邻参数上都赚钱**(参数稳健);只有某个精确参数才赚 = 曲线拟合了历史噪声,实盘必挂。样本内/外同理:用 2015-2020 调参数,拿 2021-2024 验证——后一段没参与调参,才是真实成绩。这是学习清单「阶段 5 · 陷阱」的直接教具。

**怎么做(简)**:

- 引擎零改动:策略代码里把参数提出来(SDK 加 `params` 声明或约定 `export const params`),外层循环逐组合跑 `runStrategy`。
- 走现有 Job/worker 管道,N 个组合排队串行跑(单机 SQLite,别并发打满)。
- 前端:lab 加「参数扫描」入口 → 一维=表格 + 折线,二维=热力图(收益/Sharpe 可切);区间切分(样本内/外)做成两段区间各跑一遍并排展示即可,不引入 walk-forward 复杂度。
- 结果落库(复用 Job 或新 `ScanReport`,同因子报告「存报告不存值」原则)。

### 1.3 A2 现金分红 Model B(真实价口径收尾)💤

**先说现状(2026-07-06 核实,比记忆里的更好)**:引擎已经按**真实股数整手**下单、tradeLog 记录**真实价/真实股数**(`portfolio.ts`),交易明细可直接对照真实下单——「真实价口径」大头已经有了。

**剩下的缺口**:内部记账仍是后复权(分红通过 adj 因子「自动再投资」,没有显式现金分红事件)。后复权再投资和整手约束不自洽 → 收益**微幅高估**。Model B = 引擎改为不复权价交易 + 除息日现金分红入账(现金流事件),消除这个偏差。

**决策**:小量级、大工程,**明确延后**;短期在结果页标注口径说明兜底。做「每日信号」不被它阻塞(信号手数已是真实股数)。

---

## 主线二 · 策略表达力(把「趋势」做厚)

定位是「A 股·多头·日频·横截面/个股」,趋势/价值/反转三类要**正确且好写**。这条线是对标 backtrader 补趋势系统的刚需,不是追它的通用性。

### 2.1 订单类型:止损 / 跟踪止损 / 限价,日内触价成交 ⬜

- **现状**:只有「次日开盘市价」(order/exit/setHoldings)。止损要在 onBar 自己判,且触发后**次日开盘**才成交——止损建模糙,趋势策略的回撤被低估。
- **设计要点**:
  - SDK 新增声明式挂单:`ctx.stopLoss(code, price)` / `ctx.trailingStop(code, pct)` / `ctx.limitBuy(code, price, shares)`,挂单在引擎侧持久到触发或撤销。
  - **成交模型**:当日 `low ≤ 触发价 ≤ high` 即视为日内触发,按**触发价**成交(而非次日开盘);跳空穿越(开盘直接低于止损价)按开盘价成交。涨跌停/停牌照旧阻断。
  - 挂单与 T+1 交互:当日买入的仓,止损单次日才生效。
- **验收**:唐奇安 + ATR 跟踪止损的海龟式策略能纯声明式写出,回测回撤明显比「次日开盘止损」版本更真实。

### 2.2 多周期 resample(日→周/月)⬜

- **现状**:只有日频。周线趋势滤网 + 日线进场要手拼周 bar。
- **设计要点**:SDK 加 `ctx.weekly(code)` / `ctx.monthly(code)`(从已加载日 bar 现场聚合,ISO 周/自然月,**只含已收盘的完整周期**——当周未结束不给,防未来函数);返回与 `ctx.bars` 同形的 OHLC 窗口,现有指标(sma/ema/atr/highest…)直接可用。
- 实现是纯函数聚合 + per-run 缓存,引擎主循环零改动。

### 2.3 指标库扩充 ⬜(需求驱动,不求全)

现有 sma/ema/atr/highest/lowest/avgAmount/avgVol。候选:ADX、SuperTrend、Parabolic SAR、MACD、RSI、布林带。**规则:写策略撞到了再加**,加一个同步三处镜像(sdk.ts / sdk-dts.ts / codegen-prompt.ts,见 4.4 统一计划)。

### 2.4 止盈止损 & 按手下单 helper ⬜(SDK 糖,顺手)

`ctx.orderLots(code, lots)`(按手)、`ctx.takeProfit(code, pct)` 等,依赖 2.1 的挂单机制,随 2.1 一起做。

---

## 主线三 · 因子线闭环(研究 → 策略打通)

详设见 **`docs/design/factor-to-strategy.md`**。三步概述:

### 3.1 因子编写 B:历史窗口 ✅(2026-07-07)

自定义因子 `compute` 现在只有当天横截面(FactorBar),表达力缺一半。给 compute 加第二参 `ctx`,提供 `ctx.history(n)`(后复权收盘窗口)→ 自定义动量/波动率可写。因子声明所需窗口长度(声明式,便于批量预载)。**实况**:`defineFactor` 加 `window` 声明 + `ctx.history(n)` / `ctx.history(n,'date')`(日期对齐窗口,可查停牌间隙);未声明 window 调用即抛错(不做隐式检测);dts/prompt 同步更新。

### 3.1b 统一预置与自定义(预置代码化)✅(2026-07-07,与 3.1 一次收口)

预置因子也从库读代码、走同一 `compileFactor+compute` 路径运行,只是标记 `builtin` 只读——贯彻 code-first,删掉 `factors.ts` 两注册表 + `computeFactorSeries` 3 条硬编码分支归一。**前置**:price 预置等 3.1 的 `ctx.history`、moneyflow 预置等 3.2 的 moneyflow-into-context,故当作因子闭环收口一次做完,不单拎基本面(否则 1.5 套机制)。**收益**:预置可读 → 一键 fork 成变体,兑现研究路径②。**钉死点**:稳定 slug(缓存不 orphan)/ builtin 只读强制 / 仓库编写幂等 seed。详设见 `docs/design/factor-to-strategy.md` Step 1b。

**实况(2026-07-07)**:moneyflow-into-context 以「FactorBar 加 netMain/netTotal(流量语义,当日精确缺则 null)」形态提前落地 → 9 个预置全部代码化(`factor/builtin-factors.ts`,git 为真相,boot 幂等 seed 进 Factor 表);**零 schema 迁移**——builtin 行用系统 `userId='builtin'` 哨兵(设计点 2 的备选方案)+ 固定 slug id;`factors.ts` 删除(引擎脚本用的纯函数搬进 `engine/strategies.ts` 自包含);`computeFactorSeries` 只剩一条 compile+compute 路径(声明 window 走逐股慢路径)。验收:单测 15 例价格公式逐位一致(含停牌/零价边界);真库 ep 全部 4 个旧缓存报告(全历史月/周)IDENTICAL;UI 预置只读编辑器 + 「复制为自定义」fork。注:预置代码以模板字符串存 `builtin-factors.ts`(设计点 3 的「仓库 .ts 可 type-check」以编译单测替代——每个预置过 compileFactor + 等价性断言,强于裸 type-check)。

### 3.2 因子→策略接入 ⬜(闭环最关键一环)

(2026-07-07 注:其中 moneyflow-into-context 的**因子侧**已随 3.1b 落地;本条剩策略侧 `ctx.factor` 接入 + flow 语义修正。)「因子页验证 edge → 策略里一键使用」。核心:因子注册表带**时间语义声明** `kind: flow | level`(flow=精确当天缺则 null,如 moneyflow/龙虎榜;level=as-of 前填,如估值/财务),`ctx.factor(key)` 无 date 参数(防未来函数)、按声明解析;用户自定义因子在引擎内现场编译现场算(零存储,贵的才惰性 LRU);factor key 自动生成 dts 字面量联合类型进 Monaco 补全。**顺手修**:moneyflow 的 `ctx.factor` 现在被一刀切 as-of 前填,与其文档和 `ctx.lhbNet` 不自洽,改精确当天。

### 3.3 多因子合成 💤(远期,学习清单阶段 4 收尾)

因子页加「组合因子」:选多个因子 + 权重(等权/IC 加权),标准化(rank/zscore)后加权合成,走现有 analyzeFactor 管道出同款报告。**只进因子页不进引擎**(策略里用户代码自己拼)。**前置 = 3.4 的相关性矩阵**(高相关因子组合无分散价值,先看清再合成)。

> **研究方法论定位(2026-07-06 用户讨论)**:个人做因子研究 = **验证者/实现者,不是发现者**。发现新定价异象不现实也不必要(产业界主业同样是验证/本地化/组合/控成本);因子发表后平均衰减过半(McLean & Pontiff),且很多在 A 股 T+1/涨跌停/散户结构下不成立——「在我的市场、我的成本下还活着吗」只有自己的引擎能答。三条现实路径:① 经典因子本地验证;② A 股变体(资金流/龙虎榜/涨停行为/换手拥挤 × 定义变体,微盘吃反转不吃动量即样板);③ 假设驱动(先有经济逻辑再检验,多重检验风险低一个量级)。详见 `docs/design/factor-to-strategy.md` 方法论章节。

### 3.4 因子分析深化:中性化 + 相关性 + 费后 ✅(**2026-07-08 全部完成**:三件套按序落地。依据与详设见 factor-to-strategy.md「3.4 分析深化」节)

- **市值/行业中性化 ✅(2026-07-08)**:因子值对 log 市值(+申万一级行业哑变量)截面回归取残差再检验。行业用申万 SW2021(31 个一级,新表 `SwIndustryMember` 按 `index_member_all` 全历史同步,PIT 归属)。数学走 FWL(组内去均值+一元回归,免矩阵求逆,`stats.groupDemean`/`residualize`+单测)。UI 分析参数条「中性化:无/市值/市值+行业」进缓存键(`FactorReport.neutral` 列)。自检:size 因子自身中性化后 IC≈0(实测 -0.0235→+0.0068);mf_net_main 0.0214→0.0129。e2e 7d 通过。
- **费后视角 ✅(2026-07-08)**:多空两腿换手 × 单股往返成本(佣金+印花+滑点≈千3)逐调仓日扣减,报告增 `longShortNet`/`lsNav`(费前/费后净值序列),前端多空净值双线图 + 费后指标行。实测 mf_net_main(换手 81%)年化 8.76%→2.97%、Sharpe 1.05→0.39;ep(换手 15%)2.76%→1.08%——高换手因子费后大幅缩水。e2e 7d 通过。
- **因子相关性矩阵 ✅(2026-07-08)**:选 2~8 因子,各调仓日两两截面 Spearman 取均值 → 因子×因子(含固定「市值」列)对称矩阵热力图。新表 `FactorCorrelation` 缓存 + worker job(复用 computeFactorSeries),/factors 因子库 tab 触发模态框多选 + echarts 热力图。自检 ep~bp/dv 正相关、bp~市值 弱负相关。e2e 7e 通过。

### 3.5 预置因子库扩充(经典因子菜单)⬜(前置已就绪:FactorBar 已接财务字段,见下)

把「个人无法发明因子」翻成「这里有一张已验证过文献的菜单,逐个在 A 股本地检验」:质量(ROE 及其稳定性/毛利率/应计)、低波动、流动性溢价(Amihud)、换手率(拥挤/关注度)、12-1 动量等,每个带定义、预期方向、出处一句话。部分需扩数据(应计需资产负债/现金流表,标注依赖)。

- **FactorBar 接财务字段(as-of)✅(2026-07-08,3.5 前置)**:`FactorBar` 新增 `roe / grossprofitMargin / debtToAssets`(PIT,最近 annDate ≤ 当日的报告),`analysis.ts` 一次预载 fina + 逐股二分(镜像引擎 roeAsOf);SDK dts 双语 + codegen prompt 能力边界同步。质量因子(ROE/毛利率)现可直接 defineFactor。

**纳入机制(2026-07-06 拍定):不批量导入 factor zoo**(数百因子高度冗余=十几个主题、半数复现失败、部分缺数据)。按主题精选代表 → **三道门准入**(数据可得 / A 股逻辑成立 / 中性化+费后+保留段验证过)→ 才升预置;否决的留台账防重测;长尾靠 defineFactor 手写(平台不穷举,只把检验成本做低)。**规模预期:最终 20~40 个,不上百。**详见设计文档纳入机制节。

### 3.6 研究纪律:台账 + 保留期 + 多重检验提示 ⬜(便宜,防自欺)

- **研究台账**:FactorReport 本就记录每次分析 → 台账视图(试过的因子×参数全列表 + 结果摘要 + 累计检验次数)。
- **默认保留期(holdout)**:默认分析区间截到 N-18 个月,选中因子后一键「在保留段验证」;保留段结果只看一次的纪律写进文案。
- **多重检验提示**:台账顶部按累计检验次数提示「测了 N 个,纯随机也该有 ~N/20 个显著」。同样适用于参数扫描(1.2)。

### 3.7 ML 因子合成 💤(远期,唯一推荐姿势)

树模型(LightGBM 类)吃因子暴露、吐横截面打分,**输出当作一个因子**塞回同一条检验管道(IC/分层/费后/保留期,不享受评估特权);walk-forward 逐年重训防前视;feature importance 保可解释性。**触发条件:3.3 线性合成先做且证明有价值**(线性是 ML 的对照基线;线性做不出的 ML 救不了)。**不做**:深度学习端到端预测价格(个人零优势);黑箱与执行纪律冲突(回撤中无法回答「系统坏了吗」),可解释性对个人是生存问题非品味问题。实现注意:Node 生态无好用的 GBDT 训练库,届时评估 Python sidecar vs ONNX,先不定。

---

## 主线四 · 数据与工程(支撑性)

### 4.1 早年数据 backfill ⬜(跑长回测前必做,半机械)

stk_limit / moneyflow / toplist 只覆盖 2020-2024;跑更早回测前:`pnpm sync:limit|sync:moneyflow|sync:toplist 20150101 20191231`。注意 Tushare 限频,逐年拉可续传。

### 4.2 数据扩展 💤(需求拉动,别囤)

候选:北向资金、融资融券、概念板块;`FactorBar` 补 roe(fina_indicator 已在库)。**规则:有策略/因子想用了再加**。**2026-07-07 盘点完成**:缺口清单 + 波次计划见 `docs/design/data-expansion.md`。**波次一当日完成**:fina_indicator 扩 7 列(毛利率/净利率/负债率/ROA/营收与净利同比/经营现金流比,迁移 20260707200000 按 migrate-lock 先例手动应用),sync 支持 `refresh` 断点续传回填(~77 分钟已启动),SQL 白名单文档同步;顺手 `sync:index` 补齐中证1000/500 全历史日线+成分(指数对比问答解锁)。

### 4.3 研究面板 B/C ⬜(DX 打磨,已有规划)

B = IDE 内结构化日志面板;C = SDK hover tooltip(编辑器悬浮显示文档)。见既有规划记忆(research panel plan)。

### 4.4 SDK 单一来源 ⬜(工程债,做 2.x/3.x 前顺手最划算)

SDK 现在三处镜像(`sdk.ts` 运行时 / `sdk-dts.ts` Monaco / `codegen-prompt.ts` LLM),每加一个方法要同步三处。参照 sdk-reference 单一来源模式统一:一处定义,dts 与 prompt 自动生成。**建议在主线二动 SDK 之前先做**,否则每个新指标×3 份维护。

### 4.4b `/api/app` 路由命名对齐 ⬜(工程债,纯路径整形)

`server.ts` 挂载单复数混用(strategy 拆了、screen 半套、factor 全揉;回测顶层独立而因子分析挂在 factor 下)。规则:**复数 = 资源 CRUD;单数 = 工作台动作(含 `/strategy/backtest` ↔ `/factor/analysis`);底座只留 `/agent` + `/market`**。详设见 **`docs/design/api-route-naming.md`**(Phase 0 ✅;实施 Phase 1 screen → Phase 2 factor → Phase 2b backtest 收进 strategy → Phase 3 文件收尾;每 Phase 原子切换,无双挂窗口)。

### 4.5 多用户工程 💤(明确远期,没有第二个用户前都是负债)

- 沙箱升级:**2026-07-07 用户拍板「现在就上 isolated-vm」并当日完成 Phase A**——因子 compute + analyzeData 迁入 isolated-vm 硬沙箱(`lib/isolate-run.ts`:墙内无 Node API、内存上限 + CPU 超时、跨墙批量化、stats 墙内求值);逃逸/超时有测试,ivm 在 factor-worker 线程内实测干净退出,真库等价性复验通过。**Phase B(策略侧)✅ 2026-07-07 设计当日收敛并完成**:「**引擎整个进墙 + DataPort 出墙 + 双车道**」(用户提出,取代预取草图)。B1:DataPort 抽取(data.ts 零 prisma 残留;fixture 单测 9 例首次给了 T+1/涨跌停/整手/费用/停牌/滑点不依赖真库的确定性防线);B2:引擎 esbuild bundle 进 isolate(prisma-port 打包时 alias 成 stub),`applySyncPromise` 数据桥(跨墙次数=DB 查询次数,惰性加载语义原样保留),日志/用户 console 穿墙,backtest-worker 产品路径切墙内。**验收**:防漂移双跑测试常驻(同 fixture 直跑 vs 进墙,净值/成交逐位断言 + 逃逸探针 process=undefined);真库金标准 EP 2020-2024 墙内与直跑**逐位一致**(31.75%/Sharpe 0.39/12680 笔),墙内 153s vs 直跑 151s——**性能税 ~1%**(跨墙次数=DB 查询次数,序列化相对查询可忽略)。车道规则定死:代码从 DB 来→进墙,从 git 来→可直跑;compileStrategy(new Function)仅存于验证路径与直跑车道。Python 编写策略/因子已拍定**不做**(Python 只做 3.7 ML 的研究 sidecar)。
- worker 池 + job 队列(现在每次 spawn 一个 worker,单用户够用)。
- 策略/因子 公开/私有。

### 4.6 数据库备份 ✅(2026-07-06 做完,定时安装待用户执行)

`dev.db` 单文件装着全部:行情(丢失=数周限频重同步)+ 策略/研究史/回测记录(**不可重建**)。**实况**:`pnpm --filter api backup`(`scripts/backup-db.mjs`,纯 .mjs 只用 node 内置——ops 脚本要"有 node 就能跑",不依赖 tsx/构建)—— shell 出 `sqlite3 .backup` 在线备份(WAL 安全、可在 api 运行时跑),写到仓库外 `~/jixie-backups`(env `JIXIE_BACKUP_DIR`/`JIXIE_DB_PATH`/`JIXIE_BACKUP_KEEP` 可配),校验副本可读后轮转保留最近 N 份(默认 5)。实测 6.1GB → 15s、66 张表、轮转删旧已验。**定时(跨平台)**:macOS 本地 `com.jixie.backup.plist`(launchd);**Linux VPS `jixie-backup.service`+`.timer`(systemd,Persistent 补跑)或 cron 一行**(见 .timer 头注),都直接 `node backup-db.mjs`。**待用户做**:目标机装调度器 + 把备份目录推**离本机**(VPS 单盘本地备份=没备份:rsync/对象存储/litestream;Mac 上纳入 iCloud/Time Machine)。

### 4.7 数据质量审计 ⬜(可信度的地基之下还有地基)

回测规则再对,数据层坏了引擎防不住(幸存者偏差会从数据层混进来)。做 `pnpm audit:data` 脚本,输出报告:

- 按 TradeCal 对照各表(Daily/AdjFactor/DailyBasic/Moneyflow…)逐日行数——缺日/断档检测;
- adj_factor 异常跳变(单日 >20% 且无除权公告的可疑点)、daily_basic 关键列空值率;
- **退市股覆盖自检**:universe 历史截面里退市股占比(≈0 = 幸存者偏差警报);
- 财务表 annDate ≥ endDate 校验(PIT 完整性)。

每次大同步后顺手跑;单数据源(Tushare)风险的对冲 = 继续坚守「抓来的数据必须落库、同步幂等可续传」。

### 4.8 多语言 i18n(中英双语)🚧(2026-07-07 用户立项)

产品支持中文 / 英文。三条硬需求:UI 文案走 i18n(zh/en 切换)、**LLM prompt 保持中文但回复跟随用户提问语言**、代码注释一律英文(标准财经术语)。详设与 7 段执行计划见 `docs/design/i18n.md`。**Phase 0 基建当日完成**:`@jixie/shared` 加 `Locale`;前端 react-i18next + `localeStore` + antd ConfigProvider + 顶栏切换 + api client 带 Accept-Language;后端 `src/i18n`(消息目录 + `localeFromRequest`)+ 验证器接入。

---

## 使用原则(给自己的,2026-07-06 定)

1. **主径优先于路线图顺序**:让一个真策略尽快走完「回测 → 上线信号 → 手动执行 3 个月」的完整循环,功能按主径堵点拉动开发,不按编号顺推。ROADMAP 是菜单,主径是导航;一个跑通的丑闭环 > 十个精致的半成品。
2. **回测好得离谱 = 先找 bug**:年化高得不像话时,按序排查前视(用了未来数据)/ 幸存者(数据层混入,见 4.7)/ 成本漏算,再谈兴奋。
3. **小仓上线**:首个策略用 1~2 unit 跑 3~6 个月,目的是测量「回测 vs 实盘」落差(5.2 回填数据),不是赚钱;落差小加仓有据,落差大原因即研究。
4. **期望与基线**:多头日频个人系统,年化稳定超沪深300 几个点 + 回撤可控 = 优秀;真实对照基线永远是「ETF 定投 + 零精力」,系统长期跑不过它也是平台给出的诚实答案。评估任何策略看跨行情结构的月度表现(2015 股灾/2018 熊/2019-20 牛/2022-24 磨底,数据都在)。
5. **头几年不上杠杆**:融资成本 6~7% × 趋势系统正常深回撤 = 毁灭性组合。
6. **系统级决策日志**:上线/下线/改参数/手动干预信号,人肉记一行(markdown 即可)。逐笔纪律归机器,元决策纪律归这份日志——最大亏损往往藏在「就这一次」里。
7. **AI 协作纪律**:执行完成必须对照设计文档验收标准收尾并更新本文件状态;执行模型不得自行扩 scope(扩出去的部分都没人设计过)。review 优先看验收标准,不逐行看代码。

---

## 主线五 · 每日交易信号 → 分阶段接实盘 ⬜

**方向已定(2026-07-06)**:未来接**自动化下单接口**,现阶段先做信号 + 提醒。**明确边界(同日拍定):日内高频/tick 级/日内回转永不做**——T+1 制度性封死股票日内往返、印花税+滑点杀死高换手、高频基础设施个人零胜算;jixie 策略全是日频决策,瓶颈是纪律不是速度。**自动化的论证是「拿掉回撤中拒绝执行的那只手」(纪律的最后一环),不是速度。**

详设见 **`docs/design/daily-signals.md`**。分三阶段:

### 5.1 信号生成 + 提醒 ⬜(阶段 1)

- 策略「上线」开关;交易日收盘后定时任务:同步当日行情 → 全量重放至今日 → **捕获引擎循环结束时残留的 pendingTargets/pendingOrders**(即「明日应执行清单」,现在被丢弃)→ 落库 SignalRun → 「今日信号」页展示。
- **信号提醒(纳入正式范围)**:信号生成后推送通知,邮件先行,`Notifier` 渠道抽象留好(未来 Bark/Telegram 等)。空信号日也发「今日无操作」(机械系统的不动也是决策,且证明系统活着)。
- 调度:进程内 node-cron + 现有 Job/worker 管道 + 手动兜底 + `pnpm signals:run` 脚本(补跑/外部 cron)。

### 5.2 半自动执行 ⬜(阶段 2)

- 前端执行清单:逐笔勾选「已下单」+ 回填实际成交价 → 开始积累**模型 vs 真实账户**的对齐数据(阶段 3 的地基)。
- **止损走券商条件单**(日内止损的实盘落地,零 API):SignalItem 支持「挂条件单」指令类型(标的/触发价/方向),人挂单、券商服务器盯盘执行——与 2.1 引擎侧止损单语义对齐。

### 5.3 自动执行 💤(阶段 3,远期)

- `SignalExecutor` 接口的 broker adapter。**现实约束**:A 股个人程序化通道 ≈ QMT/miniQMT(券商版,常见 50 万门槛,**仅 Windows**)或 PTrade(券商托管),无 IBKR 式开放 API → 届时形态大概率是一台 Windows 机器/VM 跑 adapter,信号侧零改动。
- 账户对齐(实际持仓 diff)、成交回报回写、风控限额届时另出设计;本期只保证 SignalItem 可机读。

---

## 主线六 · 个人投资者特色:仓位与纪律(2026-07-06 增)

**定位讨论(用户长期规划)**:量化机械交易在散户占主导的 A 股用于规避自我心理造成的决策失误;根本还需结合有效因子 + 仓位管理。设计共识:

- **机械化只消除负 alpha(行为税),edge 必须来自因子与仓位本身**;且散户行为溢价同时被量化私募收割,因子会拥挤/衰减(→ 主线一样本外/稳健性是配套防线)。
- **情绪的主战场在元层面**:不是「每笔交易拿不住」,而是「回撤中弃系统、亏了改参数」。高赔率趋势系统低胜率、连亏是正常呼吸,人扛不住。→ 工具要帮用户**事前知道执行系统正常有多疼、事中区分正常回撤 vs 系统失效**。
- **明确不做机构功能**:多资产/对冲、日内微观结构、算法执行(TWAP/VWAP)、Barra 风险归因、组合归因、多账户/合规。
- **反向利用个人优势**:资金小 → 容量受限的 edge(微盘/小票)归个人;无赎回压力/考核 → 可持有穿越回撤;个人免资本利得税、红利税按持有期。

详设见 **`docs/design/sizing-and-discipline.md`**。功能列表:

### 6.1 仓位管理实验室 ⬜

同一套进出场信号对比不同仓位方案(等权 / 固定 unit / ATR 风险仓位 / 波动率目标)。SDK 加中性 sizing 原语(`ctx.atrUnits` 等,不预设哪种好);对比视图**骑在 1.2 参数扫描的基础设施上**(仓位方案本质是一种参数)。

### 6.2 回撤画像 + 预承诺卡 💤(2026-07-06 判定伪需求,先不做)

**搁置理由**:① 结果面板已有实际最大回撤 + 月度收益热力图,「跨行情段看表现」基本已覆盖;② bootstrap 重排会毁掉真实收益顺序(回撤对顺序敏感),打乱后已非历史,虚构统计价值可疑——用户判定伪需求。唯一真缺的是回撤的**水下时长/恢复期**(热力图看不出深度与恢复),但价值有限,等真要上线某个策略时再顺手加,不单列一项。详设 `sizing-and-discipline.md` 6.2 保留备查。

### 6.3 系统健康监控 💤(随 6.2 搁置)

原设计:每日信号重放出的模型权益,对照历史 bootstrap 期望带出三档状态。**但对照基准整个建在 6.2 的 bootstrap 分布上,随 6.2 一并搁置**。核心问题(回撤中「系统坏了还是正常」)仍成立,但短实盘期做统计判断本就意义薄(设计文档自承「灯几乎恒绿」);真要做需改「对照真实历史各段回撤」的口径,届时重想。

### 6.4 策略容量测算 ⬜

复用滑点模型,资金规模网格跑同一策略 → 收益衰减曲线 → 「edge 活在 X 万以内」。

### 6.5 股息税按持有期 💤(依赖 1.3 A2 分红事件化)

成本模型加个人红利税档(>1 年免 / 1 月~1 年 10% / <1 月 20%),高分红策略回测更真实。

---

## 主线七 · 统一 Agent(对话式研究入口)✅(2026-07-06 增,当日完成)

**一句话**:lab / factor / screen 共用一个 agent 核心(profile 化:写策略 / 写因子 / 筛标的 / 金融问答),agent 获得**只读数据工具**(从「盲写代码」到「先查库再写」),能在对话里回**可重跑的查询卡片**(存 spec 不存结果);screen 页降级改造为「卡片墙」(骑现有 SavedScreen,陈列与复用归页面、生产归 agent)。**IR 分野**:策略是程序 → code-first 不变;查询是声明式 → ScreenSpec 就是正确形态,不是历史包袱。

详设见 **`docs/design/unified-agent.md`**。四阶段:

### 7.1 统一 agent 核心 ✅(纯重构)

合并 `agentTurn` / `factorAgentTurn` / factor `/qa` 三处镜像为 `agent/core.ts` + profile;行为不变,现有测试迁移后原样通过。**实况**:`apps/api/src/agent/{core.ts, profiles/}` 四个 profile(strategy/factor/screen/qa),旧 `agent.ts`/`factor-agent.ts` 删除,vitest 全绿。

### 7.2 只读工具调用 ✅(真正的跃迁)

`AgentLlm`(DeepSeek function calling,退路=JSON 协议模拟)+ 首批 3 个白名单只读工具(`searchInstruments` / `dataCoverage` / `runScreen`),每 turn 工具轮数 ≤5;工具按需求加不囤。**实况**:`chatTools` + 工具循环(工具阶段前、修复阶段后互不嵌套,单 turn ≤8 次 LLM 调用,观察不持久化);工具参数 zod→`z.toJSONSchema` 单一来源;真实冒烟三条全对(「宁王」自行规范化后确定性查到 300750.SZ),**JSON 退路未启用**。dataCoverage 对 1100 万行 daily 的 COUNT 约 8s,暂可接受(实测慢再优化)。

### 7.3 消息 parts + 查询卡片 ✅

ChatMessage 升级 parts(text | card,旧消息兼容读,Prisma 零迁移);卡片由 `runScreen` 工具调用副产(零幻觉面),前端渲染表格、点行进个股页、可保存为 SavedScreen。**实况**:`normalizeChatMessage` 兼容旧 `{content}` 行;`QueryCard` 组件列随 spec 自适应(前端确定性推导,非 LLM 挑列),spec 失效降级为「已过期」态;toolTrace「查库 N 次」临时展示(持久化时被 zod 剥掉)。

### 7.4 screen 页 → 卡片墙 ✅

NL 入口收编进 agent(确定性 LIKE 解析保留为 `searchInstruments` 内核),`nl-to-screen` 删除;screen 页 = **一面墙、两种卡片**:查询卡片(SavedScreen,点开重跑/编辑)+ 会话卡片(新表 ScreenConversation,点开回看续聊)——筛选对话本身值得回看(筛选思路是研究过程的一部分),展示统一、存储分离。**实况**:ScreenConversation 迁移按 migrate-lock 先例手动 DDL + 补记录(库未 reset);`/screen/query`、`SavedBar`、`screenForCodes`/`resolveByNames` 一并清理;e2e 全流程走通(真 LLM 对话出卡片、会话重开卡片重跑、删会话不伤查询卡片)。

### 7.5 对话 SSE 流式 + 刷新续接 ✅(2026-07-06 增,当日完成,用户拉动)

仿 marginalia streamBus/streamRun:两步式(POST 返 `turnId`,turn 后台跑)+ `turnBus` 内存 pub/sub(订阅首帧永远是 snapshot → 刷新重订阅天然续接,done 后 60s TTL)+ 共享端点(`/agent/turns/:id/stream`、`running?entity=`、`cancel`)。**实况**:`chatTools` 升级为真流式(token delta + tool_calls 分片累积);**turn 期间持久化改归服务端**(runner 先落 user 消息再跑 LLM,done 前落 assistant——「前端持久化」定死项经用户拍板取代);jixie 比 marginalia 更简:无 DB status/heartbeat/sweeper,进程重启=注册表清空、以已存内容为准;修复轮不发 delta 改发 repair 事件;pending 气泡遇围栏只显示围栏前文本+「正在写代码」+停止按钮;qa 无宿主不持久化但同样流式。e2e 含「发消息→中途刷新→重开会话→续接→卡片落地」用例,全绿。

### 7.6 只读 SQL + 动态图表卡片 ✅(2026-07-07 增,当日完成,用户拍板「SQL 全打开限特定表 + 连接层硬只读」)

- **sqlQuery 工具**:对 12 张行情/财务数据表开放只读 SQL(SQLite 方言,聚合/分组/时序/JOIN 全可用)——runScreen 白名单 spec 表达不了的统计分析走这里。守卫五层:单语句 / SELECT|WITH 开头 / 写关键字黑名单 / FROM-JOIN 表白名单(应用表 User/Session/Strategy/Factor… 双层拦截)/ LIMIT 强制;**硬只读边界 = 持久 worker 线程里的 `node:sqlite` readOnly 连接**(同步 API 不阻塞主线程、超时 terminate+重生)。⚠️ 运行时要求升到 **Node ≥22.13**(engines + bootstrap.sh 已同步改,VPS 重跑 bootstrap 升级;Node 20 已 EOL 本就该升)。
- **renderChart 工具 + chart 卡片**:MessagePart 新增 chart 类型,与查询卡片同一铁律「存查询不存结果」(spec = kind/sql/x/series,前端经 `POST /agent/sql` 重跑渲染 echarts);模型只做列映射不产数据,零幻觉面。前端 `ChatChart` 三态同高(骨架/错误/图 260px)不跳动;三页对话的 parts 渲染统一抽成 `MessageParts` 组件(再加 part 类型只改一处)。
- 同日顺手:骨架屏稳定性(查询卡片表格形骨架 / 卡片墙同 grid 骨架卡 / pending 气泡流式 markdown + 近底部跟随滚动)。

### 7.7 沙盒计算工具 analyzeData ✅(2026-07-07 用户立项当日完成,详设 `docs/design/agent-code-tool.md`)

SQL 的统计边界(无 stddev/相关/回归、多步流水线易错)的逃生舱:一个工具 = 命名 SQL 取数(≤4 条,同白名单守卫)+ 一段 JS 变换代码(esbuild+new Function 沙盒,worker 线程超时 terminate + 内存上限),数据服务端内部流转**不经过模型**,只回结果(≤8KB)。注入自家 `lib/stats.ts` 为 `stats.*`(v1 零新依赖;simple-statistics 等需求拉动再加)。图表仍归 renderChart;「算出来的数据画图」是 v2。**实况**:stats.ts 补 median/quantile/covariance/linearRegression(β/α);**说明书从 JSDoc 生成**(`gen:stats-doc` 物化 stats-doc.ts,vitest 防漂移+防漏 JSDoc);沙盒 46 测全绿;真 LLM 冒烟——「茅台 vs 五粮液相关性+波动率」模型自主一次 analyzeData 调用算出 corr 0.689 与两只年化波动率;「库里没有中证1000」场景模型自查 DISTINCT 后诚实告知而非编造。前端零改动(输出即文字)。

**远期(本期不做)**:`runFactorAnalysis` / `runQuickBacktest` 工具让 agent 写完自己跑、看结果自己改——依赖长任务进对话流的形态,届时另出设计。

---

## 建议实施顺序

| 阶段 | 内容 | 理由 |
|---|---|---|
| 近期 | **4.6 备份(最先,半小时的事)** → 1.1 滑点收尾 → 1.2 参数扫描 → 4.4 SDK 单一来源;4.7 数据审计穿插 | 备份是唯一不可逆风险;可信度回报最快;SDK 统一是后面所有 SDK 扩展的前置 |
| 中期 A | 2.1 订单类型 + 2.4 helper → 2.2 多周期 | 表达力刚需,趋势策略写得出、回撤更真实 |
| 中期 B | 3.1 因子历史窗口 → 3.4 分析深化(中性化/相关性/费后)→ 3.2 因子→策略接入;3.5/3.6 随手做 | 产品叙事最完整的闭环;中性化决定「验证」的成色,排在接入之前 |
| 中期 C | 主线五 每日信号 | 引擎能力已齐(6.3 健康监控随 6.2 搁置) |
| 中期 D | 6.1 仓位实验室 + 6.4 容量测算 | 骑在 1.2 扫描/滑点基础设施上,顺势做 |
| ~~中期 E~~ | ~~主线七 统一 Agent~~ ✅ 2026-07-06 四阶段一次做完 | 7.1 零风险纯重构,越早做越止住 agent 拷贝增殖;7.2 起显著提升 agent 写代码质量 |
| 远期 | 3.3 多因子合成 → 3.7 ML 合成 · 1.3 分红 Model B + 6.5 股息税 · 4.2 数据扩展 · 4.5 多用户工程 | 有前置或等需求拉动;线性合成是 ML 的对照基线,顺序不可倒 |

中期 A/B/C/D/E 互相独立,可按兴趣并行/换序;每日信号如果想早点用起来,可以提前到中期最前(它不依赖 A/B)。
