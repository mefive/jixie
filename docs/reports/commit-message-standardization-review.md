# English commit history review

Status: approved, applied to both local branches, and verified on 2026-09-11.

The JSON companion contains all original and proposed subjects and bodies. New IDs were calculated from reviewed raw commit bytes and verified against the written Git objects. Original wording is retained here as audit evidence, not as a template for new messages.

| Original ID | Proposed ID | Original subject | Proposed subject |
| --- | --- | --- | --- |
| 499e32b5 | 6a329df9 | feat: 初始化机械系(jixie)A股量化研究平台 | feat(repo): initialize the jixie A-share research platform |
| 05020e82 | 1e627ba3 | chore: 接入 eslint(flat config + typescript-eslint) | chore(repo): configure ESLint with TypeScript support |
| 719a7996 | 20269d72 | feat(api): 用户系统——邀请制邮箱验证码登录 | feat(auth): add invitation-only email code authentication |
| 31dcdf34 | e8551e27 | feat(web): 前端骨架——complex 架构 + 邮箱验证码登录 | feat(web): add the application shell and email login |
| 79504f87 | d5f4744e | feat(web): 接入品牌 logo / banner | feat(web): add brand logo and banner assets |
| 75324fb1 | 3faed8f1 | fix(api): Tushare 限频可配 + 行情同步可续传 | fix(market): configure Tushare rate limits and resume daily sync |
| c8b1e962 | 9ade12a8 | chore(api): tsconfig 显式声明 types:["node"] | fix(api): explicitly include Node.js types |
| 62174d15 | 241247c1 | feat(api): 因子库 + FactorValue 预计算表 | feat(factor): add factor definitions and precomputed values |
| 795472e3 | 22fa89f3 | feat(api): 向量化十分位分层回测引擎 | feat(factor): add vectorized decile analysis |
| a4046a51 | 444b82f2 | refactor: 代码注释统一改为英文 | refactor(repo): translate code comments into English |
| 25e3baf4 | 06c0a96e | fix: 中文名修正为「机械交易系」 | fix(repo): correct the Chinese project name |
| 5e35a4d7 | 4011d387 | refactor: 区分「因子分析」与「回测」+ dayjs 日期工具 | refactor(factor): separate factor analysis from backtesting |
| bdb93011 | 6de29fec | feat(engine): 事件驱动策略回测引擎 | feat(engine): add an event-driven strategy backtest engine |
| fafec6f1 | 3e753d01 | feat(data): 基本面估值数据层 daily_basic + 价值/规模因子 | feat(market): add daily valuations and fundamental factors |
| 41673d12 | 5579e9fc | refactor(engine): 通用化回测引擎(截面+命令式),内置海龟策略 | refactor(engine): support general strategies and Turtle trading |
| 02f90bfb | 4137357b | feat(data): 财务(ROE/分红)+ 指数成分数据层 | feat(market): add financial indicators and index constituents |
| a07e10b9 | 31fb5015 | feat(strategy): 目标两阶段策略(广度择时 + 优质高分红选股) | feat(strategy): combine breadth timing with dividend stock selection |
| 81f07292 | 11c8031c | feat(ir): 结构化策略 IR + 解释器(产品地基)+ vitest | feat(strategy): add a structured strategy IR and interpreter |
| 01e88eca | 0b3899da | feat(web): 回测工作台(配置式策略 + 净值结果)+ 回测 API,前端接 antd 6 | feat(web): add a configurable backtest workspace |
| f01ef00a | 110a6615 | feat(nl): 自然语言转策略 IR(DeepSeek)+ 工作台 AI 解析填表 | feat(strategy): parse natural language into strategy IR |
| ef369cb5 | 8f4fa574 | feat(screen): 选股看图(NL/示例查询 → 标的表 → K线/PE/量)+ 前端 e2e 验收 | feat(screen): add natural-language screening and stock charts |
| 99d7d9c0 | e9a17b48 | feat(screen): query spec 回显为可编辑条件 chips(改即确定性重查) | feat(screen): expose editable query condition chips |
| 37721171 | b4874dd1 | feat(screen): 个股详情独立页面(新标签)+ K线复权/对数切换 + PE 右轴叠加 | feat(screen): add stock detail pages and chart adjustments |
| 5a75124f | b6e4904c | feat(saved): 策略/选股持久化 —— 两张表 + owner-scoped CRUD + 保存栏 | feat(api): persist user-owned strategies and screens |
| 9407154d | 39c20d8c | feat(backtest): 回测移入 worker 线程 + 进度日志流式轮询 | feat(engine): run backtests in workers with incremental logs |
| 4fd15c47 | 397af1ab | feat(lab): 策略 IR 流程图编辑器(react-flow) | feat(lab): add a strategy IR flowchart editor |
| ae1c7e3c | 061ffe79 | feat(ir): 策略 IR 重构为阶段管线(pipeline-as-data,引擎侧) | feat(strategy): represent strategy IR as stage pipelines |
| 4af02d30 | 68415df0 | refactor(ir): pipeline 成为唯一 IR + 前端通用择时条件编辑器 | refactor(strategy): standardize pipeline IR and timing conditions |
| 7111c4a0 | 21a08d0f | feat(ir): 择时 = 逐只规则状态机(if/else 分支),精确复现海龟 | feat(strategy): implement timing rules as per-stock state machines |
| 4aab9fb0 | 3530345c | feat(lab): 择时规则编辑器 —— 可视化 if/else 分支 + 状态变量 | feat(lab): add visual timing branches and state variables |
| eb4f7290 | d2603e0c | feat(lab): 择时规则决策流程图 —— 带连线的 if/else 分支视图 | feat(lab): visualize timing rule decision flows |
| 2e3bb549 | ec535637 | fix(lab): 择时分支图改为竖直梯形主干(否贯穿·是横出·直线连接) | fix(lab): align timing branches along a vertical decision flow |
| 2b6de674 | 89d7449b | feat(screen): 看图选股交互重做 —— hero 输入 + 标的直查(LIKE→LLM)+ 只读气泡/毛玻璃编辑 | feat(screen): redesign screening input and direct stock lookup |
| 22bd3a84 | bb02a821 | feat(code): 代码优先策略 —— TS 源码编译成引擎 Strategy(分片1:写→跑) | feat(strategy): compile TypeScript strategies for the engine |
| 2210f64a | 1632a263 | feat(code): SDK 标准库 —— select/rankBy/dropBottom/equalWeight/period(分片2a) | feat(sdk): add strategy selection and weighting helpers |
| b91a16bf | cc8486be | feat(lab): 回测工作台改为代码编辑器(分片2b-1:A① 换掉 IR 表单) | feat(lab): replace strategy forms with a code editor |
| 11a1da8f | f4919b19 | feat(lab): Monaco 代码编辑器 + SDK 类型补全(分片2b-2) | feat(lab): add Monaco editing and SDK completion |
| a0da7773 | 7105d3dc | fix(lab): 修回测后图表崩溃(echarts 重复实例)+ 默认策略改秒级 | fix(lab): prevent chart instance conflicts after backtests |
| aaf5f930 | 7eeacd3e | feat(code): NL→code —— 一句话生成策略代码,编译做校验(分片3) | feat(strategy): generate and validate strategies from natural language |
| bfc8ee07 | 1fc74669 | chore(strategy): 删除 legacy IR 层(分片5:代码优先收尾) | chore(strategy): remove the legacy strategy IR layer |
| 28e43708 | e2fad77b | feat(code): SDK 扩展指数成分/ROE/内置指标 + codegen 拒绝瞎编(分片6) | feat(sdk): expose index constituents and financial indicators |
| bd643517 | de75fb74 | feat(code): SDK 暴露成交额/量 + 中证2000 + 引擎记录每笔交易(checklist 1/2/3) | feat(sdk): expose trading activity and record engine fills |
| 2b3f0e1b | 89351aea | feat(lab): 交易详情 Modal —— 净值打点 + 逐笔列表联动(checklist 5) | feat(lab): link trade details to net asset value markers |
| d43286ec | ca163f4c | feat(lab): 回测结果落库 —— 一个 JSON 存策略行,重开自动带出(checklist 4) | feat(lab): persist backtest results with strategies |
| 727079a6 | e2e7598b | feat(lab): 交易详情改版 —— 全屏 K线+成交量 + 交易点落横轴(富途式黄点) | feat(lab): expand trade charts with volume and trade markers |
| b92c1d94 | f4d8b611 | feat(lab): 策略管理 —— 新建 + 我的策略卡片墙(SVG净值缩略) + 空名 LLM 自动命名 | feat(lab): add strategy cards and automatic naming |
| 5548942d | 372c2724 | fix(engine): 指数还没数据的区间,回测日志提示「空池」而非静默0笔 | fix(engine): report empty universes before index data is available |
| de4c8705 | 815f363f | feat(lab): URL 带策略 id + 刷新恢复(策略/结果/运行中回测) | feat(lab): restore strategies and running backtests from URLs |
| e49acf75 | c5bf1528 | chore: 删掉误提交的临时回测脚本 _csi1000.mjs | chore(api): remove an accidentally committed backtest script |
| 334b16b1 | d2f7e186 | refactor(lab): 用 PollingModel 替手写轮询 + store 文件按约定整理 | refactor(lab): use PollingModel and organize store files |
| 039992b5 | d1d7c3be | perf(engine): 截面查询只取所需列 —— dailyBasic 整行 → select(单日 171→87ms) | perf(engine): select only required cross-sectional fields |
| 9fbf3bc3 | f8d4a5dc | feat(lab): /lab 路由 + 策略 id 走 query string + 新建 prompt-first + 未保存提示 | feat(lab): add strategy URLs and unsaved-change prompts |
| 0a0c4866 | 4401c043 | refactor(engine): select → universe + 指数成分过滤下推数据层(对齐业界 universe selection) | refactor(engine): rename universe selection and push down index filters |
| 611ca216 | 16d3abf9 | feat(engine): 成交按真实整手(100股)下单 + 交易详情显示不复权真实价 | feat(engine): enforce board lots and display unadjusted trade prices |
| fa62b0e1 | a011ffc8 | feat(engine): 涨停不可买、跌停不可卖(撞板阻断 + stk_limit 数据) | feat(engine): enforce daily price limit trading restrictions |
| 57d0e57b | 09025ee6 | feat(data): 资金流因子 moneyflow(opt-in)—— 主力净额/总净额,复用 FactorValue | feat(market): add optional money flow factors |
| 4ef016ea | 526f7f4e | feat(sdk): ctx.industry(code) 行业标签 —— 行业中性/轮动/限定某行业 | feat(sdk): expose stock industry labels |
| d627111b | 9708594d | feat(sdk): 龙虎榜净买 ctx.lhbNet(code)(当日精确,稀疏事件不前向填充) | feat(sdk): expose exact-date Dragon-Tiger List net purchases |
| 4afe04ad | 2f119df7 | feat(lab): SDK 文档 —— 结构化单一来源 → 生成 Monaco 类型 + 中英可切换文档页(/docs) | feat(sdk): generate editor types and bilingual reference documentation |
| 8291d0ca | 5422a558 | feat(lab): SDK 文档重做成 Apple 风格 + 编辑器符号可点跳文档 | feat(sdk): redesign reference pages and link editor symbols |
| 61a04407 | c7b66f20 | feat(factor): 因子分析页面 /factors + 因子数据模型重做(存报告不存值) | feat(factor): add analysis pages and persist reports |
| 1bd4ce35 | 86e61e7c | feat(factor): 因子分析改单因子 + 参数化(freq 月/周 + 起止区间) | feat(factor): configure single-factor analysis frequency and dates |
| dd70f1f5 | a8737727 | refactor(factor): 因子分析变量改全称 + 价格因子股票池从快照派生(免全表扫 daily) | refactor(factor): clarify names and derive universes from snapshots |
| d1d3f73d | c24c61ba | fix(factor): 因子 chip 选中态 hover 时保持白字(避免悬停变暗) | fix(factor): preserve selected chip text contrast on hover |
| bad5484a | da3c1453 | feat(web): 发请求按钮换 LoaderButton(有 icon 才透传 loading)+ 删除确认 / 保存提示 / 行情骨架屏 | feat(web): add loading buttons and resource feedback states |
| 66da7fe1 | fa339650 | refactor(web): LoaderButton 瘦身 —— 只注入 loading + 防抖,样式交给调用方 | refactor(web): limit LoaderButton to loading and debounce behavior |
| 2c028ad8 | e86f3fb3 | fix(web): observer 泛型透传组件类型(修 reactUtils.observer 返回 any 致 JSX 丢失 props 类型) | fix(web): preserve component generics through observer |
| b18a7aec | 968641be | feat(factor): IC 衰减曲线 + 流式日志(PollingModel+刷新恢复)+ URL 参数 | feat(factor): add IC decay curves and resumable analysis logs |
| dc31d3ac | 4b9f66eb | refactor(factor): 因子分析迁到统一 Job 表 + worker + 按用户 report + DB 恢复 | refactor(factor): persist analysis jobs and user-owned reports |
| 40ea202b | 747aec8a | refactor(backtest): 回测迁到统一 Job 表 + 结果落 Strategy + DB 恢复(去 localStorage) | refactor(engine): persist backtest jobs and strategy results |
| f5a9224b | b33e6392 | feat(lab): 交易详情三处修复(标的队列/图表不遮挡/页面打开) | fix(lab): correct trade navigation and chart visibility |
| a82d8763 | e23b623c | feat(lab): 交易详情图加 MA5/20/60 + 策略/沪深300 收益率曲线(右轴) | feat(lab): add moving averages and benchmark return overlays |
| 0ceae69c | b0eed16b | feat(lab): 交易详情加「全部」chip —— 组合视角 | feat(lab): add portfolio-wide trade selection |
| 218f0f34 | fdd88acc | fix(lab): 「全部」只放开筛选(列表+交易黄点全标的),K 线照常显示 | fix(lab): retain stock charts when displaying all trades |
| c12a6e55 | 4d031ef3 | feat(backtest): 基准对比 + 更多绩效指标 + 月度收益表 | feat(engine): add benchmarks and monthly performance statistics |
| 98fe572c | e4e1e517 | feat(engine): regime 大盘择时 —— ctx.index() 读指数点位/均线 | feat(sdk): expose index levels and moving averages for timing |
| c7fbd632 | 333e66e9 | feat(factor): 分位收益加权(等权/市值)+ 分位×前瞻期热力图 | feat(factor): add weighted quantiles and forward-return heatmaps |
| ec9d35b2 | 4f737e18 | refactor(engine): 理顺 data/run 费解变量名(px→price、db→basic、leFloor→lastIndexAtOrBefore 等) | refactor(engine): clarify data and simulation variable names |
| e67cf08e | 09eb2584 | refactor(sdk): 变量一律语义全称 + 金融术语加注释(代码是给人看的,没必要省) | refactor(sdk): expand variable names and document financial terms |
| a7824bc0 | a67cd86b | feat(web): 新增 /learn 入门教程(线性学习路径,实操为主) | feat(docs): add an introductory strategy learning path |
| 24756e94 | 6e679d60 | chore(format): 全仓库 curly + prettier 统一格式,补 eslint 规则 | chore(repo): standardize formatting and require control-flow braces |
| 4a3a8e4e | 8872d7cf | chore(hooks): 加 pre-commit hook 自动格式化(simple-git-hooks + lint-staged) | chore(repo): format staged files through a pre-commit hook |
| a30e2c8e | 87d2f2ab | docs: CLAUDE.md 补格式化/空行分段/命名全称约定 | docs(repo): document formatting and naming conventions |
| 28943f34 | bc542d76 | feat(factor): 因子编写 code-first(step 2,横截面表达式) | feat(factor): support code-first cross-sectional factor definitions |
| efbb4acb | 348c592a | feat(engine): 结构化任务日志——接管用户 console + 落库回看 | feat(engine): persist structured task logs and user console output |
| 4fa7d0df | b2156acd | feat(strategy): Agent 多轮对话后端 + 对话按策略持久化 | feat(strategy): add persistent multi-turn agent conversations |
| 19c2e234 | 3254b898 | feat(web): 回测台 agent 式 IDE 重构 + 因子页 IDE 化 | feat(web): add agent-based strategy and factor workspaces |
| 81c6b258 | d0df1869 | feat(strategy): 策略按 id 更新 + 名称 LLM 权衡保留 | feat(strategy): update strategies by ID and preserve suitable names |
| 9b3a5507 | 629b4b75 | feat(web): 回测台 dirty/提交状态模型 + 离开守卫 + 首屏防闪 | feat(lab): track unsaved changes and prevent initial rendering flicker |
| 21c71a0e | ecbcd49d | chore: 清理 agent 重构遗留的 dead code | chore(agent): remove obsolete code after the agent refactor |
| ab8548e9 | c2ff39c9 | fix(web): 离开守卫改用 edited 语义 + 新建 Modal 间距 | fix(web): base navigation guards on edits and adjust modal spacing |
| f60d1bc6 | f1a07535 | feat(factor): 自定义因子 Agent 多轮对话后端 + 按 id 持久化 | feat(factor): add persistent multi-turn factor agent conversations |
| 20728200 | 3654619b | feat(web): 因子研究改 agent 式三栏 IDE(对齐回测台) | feat(factor): add a three-column agent research workspace |
| b64026fb | be68ee09 | feat(web): 因子页交互打磨 + 移植 LoadingArea 防闪 | feat(factor): refine interactions and prevent loading flicker |
| d556804c | 0013cd02 | fix(web): 全站防闪 —— complex 首帧 setup、Splitter 百分比默认宽、lab 去 boot 门 | fix(web): prevent initial layout and loading flicker |
| a4b38ddb | 056d3b44 | chore(web): 删除闪烁调查临时文档(问题已修完) | chore(web): remove resolved flicker investigation notes |
| b4eaa270 | 8694f9b3 | test(web): 重写 e2e lab/factor 段对齐 agent-IDE | test(web): align workspace acceptance tests with agent workflows |
| 8b655cf1 | 58737b8e | feat(engine): 回测加滑点/冲击成本建模 | feat(engine): model slippage and market impact costs |
| 682a3c03 | ca5375e7 | chore(api): 数据库备份脚本 + 跨平台定时模板 | chore(api): add database backups and scheduling templates |
| 240ba2a6 | ba6bfd76 | docs: 长期规划 ROADMAP + 三份详设 | docs(repo): add the roadmap and supporting designs |
| 72bf249f | 50607ce7 | chore(deploy): VPS 部署脚本 + systemd/nginx 模板 + env 示例 | chore(deploy): add VPS deployment scripts and service templates |
| d97b1d87 | ed60ad29 | docs: VPS 部署手记 | docs(deploy): document VPS deployment procedures |
| a00ecebd | 6b7e4462 | docs(factor): 详设加「统一预置与自定义因子」一节 + ROADMAP 指针 | docs(factor): plan unified preset and custom factor definitions |
| 56cccd95 | 59266220 | feat: 统一 Agent 研究入口(主线七+7.6)+ 因子历史窗口与预置代码化(3.1/3.1b) | feat(agent): unify research entry points and factor definitions |
| 49e89fb1 | 1405ded3 | chore: Node ≥22.13 要求 + 规划文档(python-sandbox / data-expansion)+ ROADMAP 状态 | chore(repo): require Node.js 22.13 and update research plans |
| 5b1e411f | 70a0dab9 | feat(agent): analyzeData 沙盒计算工具(7.7)—— SQL 取数 + JS 统计变换 | feat(agent): add sandboxed SQL-backed data analysis |
| a780081f | 7b95b36f | feat(data): fina_indicator 扩 7 列(波次一)+ Markdown 表格渲染 + 指数日线补齐 | feat(market): expand financial indicators and backfill index bars |
| ea6a4f64 | 88bc2d57 | feat(sandbox): isolated-vm 硬沙箱 Phase A —— 因子 compute + analyzeData 迁入 | feat(sandbox): isolate factor computation and data analysis |
| 532daf80 | abaa8b87 | feat(i18n): Phase 0 双语基建 —— shared Locale + 前端 react-i18next + 后端消息目录 | feat(i18n): establish shared locales and translation catalogs |
| 450460af | 02d478ab | feat(i18n): Phase 1 —— 所有 LLM prompt 改英文 + 回复跟随用户语言 | feat(i18n): use English prompts and match the user reply language |
| 8819dac7 | 43ba3f72 | feat(i18n): Phase 2a —— 后端路由报错 + 回复外壳按 locale 渲染 | feat(i18n): localize API errors and response messages |
| 97793f06 | 02b52972 | feat(i18n): Phase 2b —— 回测引擎进度日志 + 登录邮件按 locale 渲染 | feat(i18n): localize backtest logs and login emails |
| 070f81f0 | c8a3cee8 | feat(i18n): Phase 3 —— 前端外壳逐页 i18n(login/lab/screen/factor/stock/dashboard + 公共组件) | feat(i18n): localize workspace pages and shared components |
| 801bc11d | 7f427224 | feat(i18n): Phase 4 —— SDK 文档/教程双语统一到 localeStore | feat(i18n): connect tutorials and SDK docs to the shared locale |
| 25d0a744 | 3b15f0d6 | chore(i18n): Phase 6 —— 代码注释全量译英 + 清理残留 dev 中文串 | chore(i18n): translate comments and developer messages into English |
| 2ff6cbbe | 8e642839 | feat(engine): DataPort 抽取(沙箱 Phase B1)—— 引擎与 Prisma 解耦 + fixture 规则单测 | refactor(engine): decouple simulation data access through DataPort |
| 94cc5db7 | 01057d1a | feat(sandbox): 引擎进墙(Phase B2)—— 产品路径回测全程 isolated-vm 硬沙箱 | feat(sandbox): isolate production backtest execution |
| b643c5bd | 25e74a5f | feat(i18n): 收尾 —— 因子分析日志/沙盒提示按 locale + Monaco 悬浮文档双语 | feat(i18n): localize factor logs and editor hover documentation |
| 3810045c | dc8fb44f | docs(factor): 下一批认领排序(3.4 三件套先行)+ FactorBar 财务字段 as-of 设计点 | docs(factor): prioritize neutralization and as-of financial fields |
| f0ebe665 | 1232e21b | feat(factor): 3.4 市值/行业中性化 —— 申万一级 PIT + FWL 残差化 | feat(factor): add point-in-time size and industry neutralization |
| e13e912d | 3aca180c | feat(factor): 3.4 费后视角 —— 多空净值费前/费后双线 + 换手成本 | feat(factor): report long-short returns after trading costs |
| d62e979b | f98e44e7 | feat(factor): 3.4 相关性矩阵 —— 因子×因子截面 Spearman 热力图(3.4 收官) | feat(factor): add cross-sectional factor correlation matrices |
| d6225d7f | 42c4c7d8 | feat(factor): FactorBar 接财务字段(as-of PIT)—— roe/毛利率/负债率(3.5 前置) | feat(factor): expose as-of financial fields in FactorBar |
| 57f957b4 | f7994c80 | feat(factor): 3.5 预置菜单扩充 —— mom_12_1/vol120/roe/毛利率 四因子过门三 | feat(factor): add momentum and financial factor presets |
| fe7e9c29 | 18a217eb | refactor(api): 4.4b 路由命名对齐 —— 复数资源/单数动作/底座三分 | refactor(api): align market resources and research action routes |
| a1e2a53a | 2ef64fc2 | chore: 加 pnpm loc —— 统计 apps/packages 手写源码行数脚本 | chore(repo): add a handwritten source line counter |
| 040fb9ab | cb8b735b | refactor(sdk): 4.4 SDK 单一来源 —— 注册表下沉 shared + 双向防漂移类型闸 + prompt 表面清单生成 | refactor(sdk): centralize reference definitions and contract checks |
| 0ccf9e4b | cb4a4e5b | feat(engine): 3.2 起步 —— FactorDef 注册表 + flow/level 时间语义(修 mf 前填 bug)+ tsCode 校验加固 | fix(engine): enforce factor time semantics and validate stock codes |
| 040777a1 | 9ff8972c | feat(engine): 3.2 自定义因子接入引擎 —— custom:<id> 现场算,双车道同一份求值代码 | feat(engine): evaluate custom factors through the shared runtime |
| d6a319d9 | 5e8ea220 | feat(sdk): 3.2 收官 —— FactorKey 进 Monaco dts + prompt 因子清单,e2e 闭环验收 | feat(sdk): complete factor key types and agent factor discovery |
| 60b3d652 | dd46eddb | chore: CLAUDE.md 新增 switch/查表约定;turn-run 导入与命名整理(UiMessage 别名去除、e→error) | chore(repo): document branching conventions and clarify agent names |
| 7b390700 | 20a1838b | feat(web): agent chat 改 ChatGPT 式布局 —— assistant 顶宽 markdown、user 右气泡 | feat(web): standardize agent chat layouts |
| ac3c4768 | 730b1dc9 | refactor(web/lab): 运行栏从 Agent 对话迁到结果栏顶部 | refactor(lab): move backtest controls above results |
| 1e46f365 | f93693b4 | docs: 立项 7.8 计算图卡片(analyzeData→echarts)与图形态扩展 | docs(agent): plan computed chart cards and additional chart types |
| 37df753a | 9740291e | feat(web/markdown): KaTeX 公式渲染 + em 相对字号 + 分隔线 | feat(web): render mathematical notation in Markdown |
| 8a74a875 | ca73dfdb | feat(web/screen): 聊天页 16px/768宽 + 输入框空态修正 + ChatGPT 式滚动 | feat(screen): refine chat typography and scrolling behavior |
| 1152fbc8 | ed7196b9 | feat: 支持策略因子引用跳转 | feat(lab): link strategy factor references to factor definitions |
| 8d443b9b | 5a665a53 | feat(factor): 自定义因子稳定 strategyKey —— 草稿/定稿两段式接入 | feat(factor): finalize stable keys for strategy references |
| 399d2bed | 39b351f6 | fix(web/lab): 策略历史卡片选中态加 active 边框高亮 | fix(lab): highlight the selected strategy history card |
| 591d429d | 370a9684 | docs(CLAUDE): 补充 Prisma migration 手工修改禁令 | docs(repo): prohibit manual edits to generated Prisma migrations |
| a971e6dd | cba03258 | 接入股指期货基础数据 | feat(market): add stock index futures reference data |
| 90b58b6e | 7b0898b7 | 删除已废弃的 nlToCode 单次生成路径 | chore(strategy): remove obsolete single-shot code generation |
| f66ae194 | 5d4e2421 | 支持股票期货混合组合回测 | feat(engine): support mixed equity and futures portfolios |
| 7ff58d0f | 89bf6fd0 | 统一 Codex 项目指令入口 | docs(repo): unify Codex project instruction entry points |
| 8cff0795 | 6e679008 | 重构策略运行编排归属后端 | refactor(strategy): move execution orchestration to the backend |
| 81243a60 | 0df93528 | 重构选股页为对话式布局 | refactor(screen): adopt a conversational screening layout |
| aef36e07 | e8bbc61c | 修复对话流式渲染闪烁 | fix(agent): prevent streaming conversation flicker |
| c528223a | fe3ef622 | 持久化 Agent 会话与执行轨迹 | feat(agent): persist conversations and execution traces |
| a4e7a572 | 32afbe80 | 启用 DeepSeek Agent 思考模式 | feat(agent): enable DeepSeek reasoning mode |
| ba1b519d | ae2df25d | 优化选股侧栏加载与刷新体验 | perf(screen): improve sidebar loading and refresh behavior |
| 1a97861f | aa59fc19 | 优化因子分析参数交互 | feat(factor): refine analysis parameter interactions |
| dede510e | 2fe2b59e | 优化 Agent 执行记录与聊天排版 | feat(agent): refine execution records and chat layout |
| 704e195e | 6ba58195 | 新增异常换手率内置因子 | feat(factor): add an abnormal turnover preset |
| 29e743d5 | a485ed5e | 修复 Agent 工具协议泄露并优化股票图表 | fix(agent): prevent tool protocol leaks and improve stock charts |
| 5a8e3be9 | b571ec3c | 清理遗留 dead code 与探索代码 | chore(repo): remove obsolete and exploratory code |
| 2380625e | c5a2220b | feat: add factor report history | feat(factor): add factor report history |
| c948d1f8 | 9c846042 | feat: add factor research discipline | feat(factor): add factor research discipline |
| 375e0372 | 37c7e574 | feat: make factor methodology reproducible | feat(factor): make factor methodology reproducible |
| b944bf8d | e2792a36 | feat: add validated Amihud factor | feat(factor): add validated Amihud factor |
| c71aba17 | 83be6ca2 | docs: update factor research roadmap | docs(factor): update factor research roadmap |
| b945066a | 8a6fb5ae | chore: pin pnpm for git hooks | chore(repo): pin pnpm for git hooks |
| 5dcf3045 | 4e71ff87 | feat: support turnover history in strategy factors | feat(factor): support turnover history in strategy factors |
| 60aafdcc | dedd65fd | test: cover turnover history strategy e2e | test(factor): cover turnover history strategy e2e |
| aa9ca3c4 | cb92234f | feat: 补齐 3.6a 研究纪律收尾(不合格原因/计数说明/holdout 确认强化)并翻文档状态 | feat(factor): clarify research rejection reasons and holdout confirmation |
| f683bbc5 | c4d5dcc5 | docs: 验收确认 3.6b-A 口径显式化已随 6ec93cd 落地,ROADMAP 翻状态 | docs(factor): record acceptance of explicit research methodology |
| 960dbe32 | 5cd73a21 | feat: 计算图卡片(7.8 A+B)——renderComputedChart 工具 + compute 重跑端点 + 图形态扩展 | feat(agent): add computed chart cards and rerun endpoints |
| 86368d9d | 8808f613 | fix: SDK hover 恢复 TS QuickInfo(4.3-C)——文档链接改走 hover provider 合并渲染 | fix(sdk): restore TypeScript QuickInfo alongside documentation links |
| f28acdca | 6aab84e1 | feat: 预置因子 +2(换手率20日均/ROE稳定性)过三道门,ctx.history 接通 roe 财务历史 | feat(factor): add turnover and ROE stability presets |
| 2e82ce52 | 1e9b6815 | docs: 补充产品哲学与战略研究路线图 | docs(repo): document product philosophy and research strategy |
| 6585d45f | 7fdd0ff2 | feat: 接入主要 ETF 日频交易通道 | feat(market): add daily ETF trading data |
| 661dc370 | 6fe62e25 | feat: 补齐 ETF 策略与研究入口 | feat(research): expose ETF strategy and research workflows |
| b2266fe2 | d79f0fde | feat: 接入指数历史估值与分位 | feat(market): add historical index valuations and percentiles |
| fea48395 | 5441ee3a | feat(web): refine lab results and controls | feat(web): refine lab results and controls |
| ac403180 | 3f0490f4 | feat: 增加指数估值看板与日线补齐入口 | feat(market): add index valuation dashboards and daily backfills |
| 72bf2725 | c65c186a | feat: 增加市场状态与指数观察范围 | feat(market): add market state and index observation scopes |
| 630f97db | 32e5b896 | feat: expand market state index scopes | feat(market): expand market state index scopes |
| 2236d051 | 154c71f2 | feat: 增加全量数据质量审计 | feat(market): add comprehensive data quality audits |
| 9db4a74f | 4ea7dfaa | 拆分市场与估值页面并精简首屏 | refactor(web): separate market and valuation pages |
| df777d85 | defc6c07 | feat: 修复历史股票池与可投资状态 | fix(market): correct historical universes and investability |
| 3293383c | 06e235b8 | feat: add strategy parameter scans | feat(strategy): add strategy parameter scans |
| 30b78254 | d1165670 | feat: add daily trading signals | feat(signals): add daily trading signals |
| 855d7966 | 3f310f86 | docs: plan user guide rollout | docs(docs): plan user guide rollout |
| 7008212f | c44177d8 | docs: complete user guide inventory | docs(docs): inventory user-facing workflows for the guide |
| 70415f8b | 4ce8f344 | feat(web): add markdown user help center | feat(web): add markdown user help center |
| a6e4ef27 | 69a5304a | fix(api): use async data bridge in backtest workers | fix(api): use async data bridge in backtest workers |
| eae65d82 | a65a8e93 | docs(web): add beginner guide and annotated screenshots | docs(web): add beginner guide and annotated screenshots |
| 0c0cca7c | 9cf35558 | feat(web): unify public docs navigation | feat(web): unify public docs navigation |
| d987d98b | 7d961d97 | feat(web): add workspace links to public docs | feat(web): add workspace links to public docs |
| 7b1937fc | d84db113 | docs(web): add screener and stock detail guides | docs(web): add screener and stock detail guides |
| d7cf4cbc | 2fe113b5 | fix(agent): stabilize screening data queries | fix(agent): stabilize screening data queries |
| 37da7384 | a271bb83 | docs(web): add core backtest guides | docs(web): add core backtest guides |
| c38d5bad | c7394475 | docs(web): cover backtest states and parameter scans | docs(web): cover backtest states and parameter scans |
| 835c7ad0 | 787a207d | docs(web): cover ETF and futures backtests | docs(web): cover ETF and futures backtests |
| 3a326d69 | 6e5a8abb | docs(web): complete backtest workspace guide | docs(web): complete backtest workspace guide |
| c0ae7801 | f5fd02e0 | docs(web): add beginner factor research guides | docs(web): add beginner factor research guides |
| 292694c2 | 1f36b2a2 | docs(web): explain factor metrics with formulas | docs(web): explain factor metrics with formulas |
| 801c72f4 | eb3877fb | chore(deploy): 补全生产数据导入与启动修复 | fix(deploy): complete production data imports and startup recovery |
| 9988d4e9 | 375f578a | 修复股票代码规范化事务超时 | fix(market): prevent stock code normalization transaction timeouts |
| 4a0a0274 | 095f7437 | feat: 拆分独立公开文档应用 | feat(docs): extract a standalone public documentation app |
| 8e916e16 | 66cf8658 | 支持按组件幂等部署 | feat(deploy): support idempotent component deployments |
| 6033a51d | ebaa08b1 | docs: add factor research discipline guides | docs(docs): add factor research discipline guides |
| da8998b5 | 71406f34 | docs: add production maintenance plan | docs(maintenance): add production maintenance plan |
| eb973cbf | 56d80d59 | fix(deploy): make static builds readable by nginx | fix(deploy): make static builds readable by nginx |
| 63530553 | 0a88bb4a | docs: close custom factor strategy blocker | docs(factor): record custom factor strategy integration acceptance |
| 0f13c8dc | e0156e83 | 适配工作台移动端导航 | feat(web): adapt workspace navigation for mobile devices |
| 2c82ccfb | 958a935e | docs: add custom factor workflow guides | docs(docs): add custom factor workflow guides |
| 766d1db4 | da5dd2c2 | docs: add market valuation and signal guides | docs(docs): add market valuation and signal guides |
| 41ea1ede | d6cafd00 | feat: add production maintenance orchestration | feat(maintenance): add production maintenance orchestration |
| 27fd4f2f | c6ee7cf6 | fix: generate Prisma client during deploy | fix(deploy): generate Prisma client during deploy |
| 02ef845b | cb166200 | fix: gate maintenance timers during first deploy | fix(deploy): gate maintenance timers during first deploy |
| 75a8902f | 0a54ce15 | feat: add one-time maintenance activation | feat(maintenance): add one-time maintenance activation |
| 3bd90d31 | de58047a | fix: activate maintenance from deploy | fix(deploy): activate maintenance from deploy |
| 134889b1 | fb1d3354 | refactor: unify production bootstrap and maintenance startup | refactor(deploy): unify production bootstrap and maintenance startup |
| edcf8a5f | 14b2cc68 | refactor: unify maintenance command surface | refactor(maintenance): unify maintenance command surface |
| ad2c83c9 | 08f72f64 | fix: coordinate safe bootstrap downtime | fix(deploy): coordinate safe bootstrap downtime |
| af0d58f3 | 30054540 | feat: make bootstrap deployment-aware | feat(deploy): make bootstrap deployment-aware |
| 6783f832 | 8124fc7a | feat: track simulated and actual signal execution | feat(signals): track simulated and actual signal execution |
| 6c900e64 | 8d694748 | feat: add persistent conditional orders | feat(engine): add persistent conditional orders |
| 389d7190 | ebd80bb1 | feat: add completed weekly and monthly bars | feat(market): add completed weekly and monthly bars |
| 7285352a | 3b8a0bca | feat: add sizing comparison lab | feat(strategy): add sizing comparison lab |
| 8a89ea38 | b9e962cc | feat: add strategy capacity scans | feat(strategy): add strategy capacity scans |
| 8bfcc987 | 723adc4c | feat: let strategy agent run quick backtests | feat(strategy): let strategy agent run quick backtests |
| d681d6cd | 2b7454a6 | feat: let factor agent run disciplined analysis | feat(factor): let factor agent run disciplined analysis |
| 0d7026e3 | e1a18583 | docs: mark completed roadmap phases | docs(repo): record verified roadmap progress |
| 10a28ee6 | aa9c5e54 | feat: add point-in-time gross margin history | feat(market): add point-in-time gross margin history |
| 238286c9 | 1545a40d | feat: define equal-weight factor composites | feat(factor): define equal-weight factor composites |
| dbe6c1a7 | 2dc4a612 | feat: run persistent factor composites | feat(factor): run persistent factor composites |
| 6b5e5ee4 | a5673805 | feat: add multi-factor composition workbench | feat(factor): add multi-factor composition workbench |
| 5382031a | 7428e3af | fix: load quoted factor history fields | fix(factor): load quoted factor history fields |
| d7d47fae | a51ffc50 | docs: record gross margin stability exploration | docs(factor): record gross margin stability exploration |
| 2e568901 | a36f96c6 | fix: make weekly reference maintenance complete and memory-bounded | fix(maintenance): make weekly reference maintenance complete and memory-bounded |
| 0c8e1fce | fc0f7f59 | fix: bound weekly financial reconciliation | fix(maintenance): bound weekly financial reconciliation |
| e8f1608d | 09216a8e | docs: cover new research and signal workflows | docs(docs): cover new research and signal workflows |
| 16cd6eee | 2df48d4a | fix: skip daily maintenance on exchange holidays | fix(maintenance): skip daily maintenance on exchange holidays |
| 842fddfb | e9797412 | feat: 重构市场状态为可回放行业气象图 | feat(market): add replayable industry weather views |
| d11e5823 | 86d0cbef | fix: 部署时自动补全市场参考数据 | fix(deploy): backfill market reference data during deployment |
| b947daea | 3bc6a1f5 | feat: 将市场设为默认首页 | feat(web): make the market page the default landing page |
| 9f2313de | 8e878845 | feat: 将市场重构为多维气象卡片 | feat(market): present market state as multidimensional weather cards |
| 96088135 | e4015081 | fix: 友好处理登录网关异常 | fix(auth): handle login gateway failures gracefully |
| 96b5d9b6 | f738ab9b | feat: expand market weather index coverage | feat(market): expand market weather index coverage |
| 42da02e6 | 356eca12 | feat: add monthly factor weather dashboard | feat(factor): add monthly factor weather dashboard |
| 665d249d | 8e196165 | docs: document market and factor weather | docs(docs): document market and factor weather |
| ba850f31 | e69cc748 | feat: 支持 Python 策略沙箱运行 | feat(sandbox): run Python strategies in the sandbox |
| b86d9a1b | 25d71e23 | fix: 避免 sandboxd systemd namespace 冲突 | fix(deploy): avoid sandboxd systemd namespace conflicts |
| 52904de7 | 0285ce35 | fix: 修正 Python history 复权字段处理 | fix(sdk): correct adjusted Python history fields |
| d69c9c5e | 2359c406 | fix(web): 更新期间显示维护提示并保留路由 | fix(web): preserve routes while displaying maintenance notices |
| dca32705 | 735b0d49 | docs: 规划多资产 Factor V2 研究闭环 | docs(factor): plan multi-asset factor research workflows |
| 674e2362 | 50f653ff | feat(api): 添加多资产数据权限探针 | feat(market): add multi-asset data permission probes |
| 3af43b25 | 605d4488 | feat(factor): 建立不可变因子发布版本 | feat(factor): create immutable factor releases |
| 23856410 | 3c098592 | feat(factor): 支持历史指数范围研究 | feat(factor): support historical index research scopes |
| f2846569 | d62d1300 | feat(factor): 支持行业内因子排序 | feat(factor): rank factors within industries |
| 847aadcc | d8c9d91a | feat(factor): 添加范围稳健性诊断 | feat(factor): add research scope robustness diagnostics |
| 67e21a24 | ff2546ab | test(web): 覆盖因子研究范围验收 | test(factor): cover research scope acceptance |
| 09defda3 | 58bc17e7 | feat(factor): 建立分型研究协议 | feat(factor): define protocols for distinct research types |
| 3a743167 | 29db64d2 | refactor(factor): 按研究类型调度评估器 | refactor(factor): dispatch evaluators by research type |
| 6752014c | 009c3d59 | feat(factor): 推导可信发布元数据 | feat(factor): derive verified release metadata |
| 46add1ae | 1076443c | feat(web): 添加因子报告发布区 | feat(factor): add report publication controls |
| 70261c72 | fb24994b | test(web): 验收因子发布血缘 | test(factor): verify release lineage |
| 2bb8fde2 | d4d77acc | feat(engine): 按发布版本运行因子 | feat(engine): execute immutable factor releases |
| f5cfb3d8 | cc755b60 | feat(lab): 引用不可变因子发布版本 | feat(lab): reference immutable factor releases |
| a447f86e | 9e8cc207 | test(lab): 验收因子发布策略闭环 | test(lab): verify factor release strategy workflows |
| 9257cfe8 | 1669befd | feat(signals): 冻结因子发布血缘 | feat(signals): freeze factor release lineage |
| 8221ad6f | befc52a5 | feat(signals): 记录实际因子输入 | feat(signals): record actual factor inputs |
| 26c66679 | 3625fd18 | feat(factor): 从发布版创建策略 | feat(factor): create strategies from factor releases |
| eda5e92d | f88cd1a2 | feat(factor): 建立时间序列评估内核 | feat(factor): add a time-series evaluation core |
| 86f8355c | c0759e7e | feat(factor): 生成 ETF 趋势研究观测 | feat(factor): generate ETF trend research observations |
| 51b6fb47 | ff6b8f7f | feat(factor): 接通 ETF 时间序列研究任务 | feat(factor): connect ETF time-series research jobs |
| 44d15229 | 75f6a07b | feat(factor): 增加 ETF 时间序列研究界面 | feat(factor): add ETF time-series research views |
| 3edbeccc | d3edf0aa | feat(factor): 执行时间序列因子定义 | feat(factor): execute time-series factor definitions |
| 233c3e3e | b6dbefe7 | feat(factor): 接通时间序列样本外研究 | feat(factor): enable out-of-sample time-series research |
| 794bd355 | c887cb97 | feat(factor): 发布时间序列因子版本 | feat(factor): publish time-series factor releases |
| c47381a1 | 93b3c15c | feat(factor): 接通时间序列发布回测 | feat(factor): backtest time-series factor releases |
| 68171f17 | 4b345d6d | feat(factor): 将时间序列发布带入策略 | feat(factor): reference time-series releases in strategies |
| c6659fc6 | a07c5b40 | fix(factor): 限定ETF时间序列输入 | fix(factor): restrict ETF time-series inputs |
| ea86dd67 | 3a5cfbf0 | feat(factor): 持久化自定义研究类型 | feat(factor): persist custom research types |
| 26ef5007 | 09fe393b | feat(factor): 开放自定义时间序列研究 | feat(factor): enable custom time-series research |
| c4d8d4fa | 71fe3e45 | test(factor): 验证自定义信号策略闭环 | test(factor): verify custom signal strategy workflows |
| dced2ed8 | 2df34258 | feat(factor): 支持Agent运行时间序列研究 | feat(factor): let agents run time-series research |
| 9c4bc333 | 010eadd3 | feat: make factor identity immutable | feat(factor): make factor identity immutable |
| be13fe8b | 3c75eb2c | feat: add government yield curve factors | feat(factor): add government yield curve factors |
| ece14b49 | 092e03f9 | feat: enable time-series factors in daily signals | feat(signals): enable time-series factors in daily signals |
| ffebcd99 | 1b7cb649 | feat: add cross-asset panel factor research | feat(factor): add cross-asset panel factor research |
| 7a5b21b9 | 57dfc9bb | feat: validate panel factors in strategy lab | feat(lab): validate panel factors in strategy lab |
| 3ed0d267 | 93a2ed4a | test: validate panel factor holdout discipline | test(factor): validate panel factor holdout discipline |
| f4f6a068 | 7c75ab71 | feat: add bond duration ladder to panel research | feat(factor): add bond duration ladder to panel research |
| e5701b10 | f0954d51 | feat: add commodity etfs to panel research | feat(factor): add commodity ETFs to panel research |
| d9667738 | 0363b1c4 | feat: decompose panel evidence by asset class | feat(factor): decompose panel evidence by asset class |
| c0713939 | f8c8ddf1 | feat: add cross-asset panel composite research | feat(factor): add cross-asset panel composite research |
| 79754641 | 3ba2fbee | feat: publish panel composites to strategy runtime | feat(factor): publish panel composites to strategy runtime |
| 2ef7d70d | 7e6635f5 | feat: add multi-asset allocation attribution | feat(engine): add multi-asset allocation attribution |
| d2c6079d | ea300757 | feat: surface allocation attribution in lab | feat(lab): surface allocation attribution in lab |
| 75bab367 | 1ce7fd5a | feat: add rolling asset class correlations | feat(engine): add rolling asset class correlations |
| af83bdb8 | 36be3ab7 | feat: add rate regime allocation analysis | feat(engine): add rate regime allocation analysis |
| 1d9b83e2 | 292c6902 | feat: add point-in-time macro data foundation | feat(macro): add point-in-time macro data foundation |
| 75953c0c | a2e49a7f | feat: add macro as-of revision policies | feat(macro): add macro as-of revision policies |
| 35e27bb3 | f2595f9f | feat: add macro regime continuous scores | feat(macro): add macro regime continuous scores |
| 1ac8334a | c775394c | feat: add macro regime research report | feat(macro): add macro regime research report |
| 29e9de79 | f55ced50 | feat: connect macro regime research workflow | feat(macro): connect macro regime research workflow |
| 798ec3e3 | 64738d48 | feat: add macro regime research workbench | feat(macro): add macro regime research workbench |
| afbb8d06 | fcad2710 | feat: add commodity carry panel research | feat(factor): add commodity carry panel research |
| 2ab6d618 | d5f9541d | feat: add commodity carry time-series research | feat(factor): add commodity carry time-series research |
| 74939bb4 | b53831ef | feat: add point-in-time commodity warehouse receipts | feat(market): add point-in-time commodity warehouse receipts |
| 7b835a53 | fcb25faa | feat: productionize commodity warehouse receipt maintenance | feat(maintenance): productionize commodity warehouse receipt maintenance |
| 71fbef46 | f84af948 | feat: add warehouse receipt time-series observations | feat(factor): add warehouse receipt time-series observations |
| 0003990e | f1088db0 | feat: constrain factor research assets | feat(factor): constrain factor research assets |
| 852c6dce | 8862a5ce | feat: complete warehouse receipt factor research | feat(factor): expose warehouse receipt research and data cutoffs |
| 813a0252 | 88926f03 | feat: define phase 5 risk research contracts | feat(engine): define multi-asset risk research contracts |
| 51118f20 | 2651e103 | feat: extend domestic macro liquidity data | feat(market): extend domestic macro liquidity data |
| 6b1564fc | d9021199 | feat: add external rates and currency drivers | feat(market): add external rates and currency drivers |
| 0e7151a1 | 16a4e106 | feat: add credit spread risk drivers | feat(market): add credit spread risk drivers |
| 9d5f6a37 | 5c3634bf | feat: add commodity positioning data | feat(market): add commodity positioning data |
| 8a08f274 | ed2b5955 | feat: audit commodity continuous returns | feat(market): audit commodity continuous returns |
| ca5a822c | ea3b31e6 | feat: model multi-asset market risk | feat(engine): model multi-asset market risk |
| 588cd34d | 33452ddf | feat: model five-axis macro risk | feat(engine): model five-axis macro risk |
| 1f9d0e8a | f96c45eb | feat: diagnose alpha risk overlap | feat(engine): diagnose alpha risk overlap |
| 6a91e2bb | acc57eac | feat: add portfolio risk scenarios | feat(engine): add portfolio risk scenarios |
| fab2dd93 | e2313019 | feat: surface portfolio risk research | feat(lab): surface portfolio risk research |
| 676943c3 | 9833a589 | test: close phase 5 risk research | test(lab): verify portfolio risk research acceptance |
| a973d883 | a3f8af50 | docs: close factor v2 roadmap | docs(factor): record Factor V2 research acceptance |
| d64224ec | bb7f9034 | docs: expand help for latest research features | docs(docs): expand help for latest research features |
| 32c96fc7 | bb57b3e9 | feat: complete preset factor library expansion | feat(factor): expand validated financial and price factor presets |
| 495b734d | f402acbd | docs: close early market data backfill | docs(market): record historical data backfill completion |
| e76a8b54 | 89ecb88f | feat: expand strategy technical indicators | feat(strategy): expand strategy technical indicators |
| c13826b4 | fee7513f | feat: add robust cross-sectional factor inference | feat(factor): add robust cross-sectional factor inference |
| 77dd7f4e | c82b1ba2 | docs: 重定向为个人多市场量化研究实验室 | docs(repo): position jixie as a personal multi-market research lab |
| 3a9421c1 | 08540da0 | feat: complete multi-user engineering | feat(api): enforce multi-user access and queue research jobs |
| ceff5d12 | a52c89b3 | docs: 重构多市场量化研究路线图 | docs(repo): reorganize the multi-market research roadmap |
| 97475f19 | d274dbcd | feat: add natural-language research workbench | feat(research): add natural-language research workbench |
| b665e915 | a0a3025e | feat: migrate screen data into research | feat(research): migrate screen data into research |
| 20508d90 | b988c6eb | feat: replace Screen with Research universe workflow | feat(research): replace Screen with Research universe workflow |
| cd8734aa | 4c216672 | feat: structure research conclusions | feat(research): structure research conclusions |
| 400254da | 8a62664c | feat: add interactive research reruns | feat(research): add interactive research reruns |
| b70ffc2c | 71a43303 | feat: add distribution comparison research | feat(research): add distribution comparison research |
| 95adbc04 | 255186f5 | feat: add event study research | feat(research): add event study research |
| 9a436ec5 | 2585219a | feat: persist research run history | feat(research): persist research run history |
| 3e4cf0b8 | dcf5fa41 | feat: fingerprint research runs | feat(research): fingerprint research runs |
| 0c77a6d4 | c96be563 | feat: explain research run differences | feat(research): explain research run differences |
| 31411207 | aa1de69f | feat: retain failed research attempts | feat(research): retain failed research attempts |
| bde1efe8 | 0c7b5b9c | feat(research): close initial workspace and add curator workflow | feat(research): add catalog curation and research formula views |
| e0a85a6b | 3995dbea | feat(research): verify curator findings and add concept registry | feat(research): verify curator findings and add concept registry |
| 13649479 | def2e345 | refactor(research): separate playbooks from data bindings | refactor(research): separate playbooks from data bindings |
| cdfafd10 | ac75b2c7 | feat(research): close first semantic data slice | feat(research): add CPI sources and semantic data bindings |
| a931a705 | 4b1d74b7 | feat(research): add multivariate time-series protocol | feat(research): add multivariate time-series protocol |
| c6bd200c | f48c9705 | fix(macro): harden BLS CPI retrieval | fix(macro): harden BLS CPI retrieval |
| 43d64c4e | f293c714 | fix(macro): add OECD CPI fallback | fix(macro): add OECD CPI fallback |
| 8003ef13 | 96fd691d | fix(macro): add resilient US CPI fallbacks | fix(macro): add resilient US CPI fallbacks |
| b7681896 | c8b1b971 | fix(maintenance): retry ChinaBond curve downloads | fix(maintenance): retry ChinaBond curve downloads |
| 6f37dc09 | 5022325b | feat(research): freeze cross-market data contracts | feat(research): freeze cross-market data contracts |
| 5f515353 | cebe101d | feat(research): add cross-market benchmarks | feat(research): add cross-market benchmarks |
| eaff76ed | e43ca9e3 | feat: 新增响应式量化研究工作台 | feat(research): add a reactive quantitative research workspace |
| 44080005 | 62739d82 | feat: 增加研究工作台 Python 语言服务 | feat(research): add Python language services |
| 093ad4f1 | 522b8e64 | feat: 增加研究数据目录与代码补全 | feat(research): add a data catalog and code completion |
| 34244445 | 05ecfbd7 | feat: 增加受影响 Cell 批量运行 | feat(research): run affected cells in batches |
| 5ea6afdb | a3648f25 | feat: 支持中断研究 Cell 运行 | feat(research): interrupt running cells |
| 5013b4b4 | 3144ca09 | feat: 补齐研究原生统计图 | feat(research): expand native statistical charts |
| ef63f0fe | 2f161994 | feat: 增加研究大表受控预览 | feat(research): add bounded previews for large tables |
| 7d059031 | 832e6687 | feat: 完善研究输出产物边界 | feat(research): enforce output artifact boundaries |
| 45ab776c | eeadb280 | feat: 支持 Agent 研究 Cell 变更提案 | feat(research): let agents propose cell changes |
| c6751bc8 | 20fa6822 | feat: 支持研究 Cell 自动保存 | feat(research): autosave research cells |
| 2098d33c | 6a1e2bc4 | feat: 支持 Agent 受控运行研究提案 | feat(research): run agent proposals with execution controls |
| d4cedf04 | b0cffe88 | 修复生产维护数据回填与部署恢复 | fix(maintenance): recover production backfills and deployments |
| bce5ff41 | 684e0523 | 完善维护任务自动恢复机制 | fix(maintenance): improve automatic job recovery |
| 530c37c7 | 144d00dd | feat(research): add editable agent change reviews | feat(research): add editable agent change reviews |
| 65143866 | f0e29d4d | fix(research): simplify inline agent diffs | fix(research): simplify inline agent diffs |
| 8daa0832 | 6dd8cfe7 | test(research): guard standard inline agent diffs | test(research): guard standard inline agent diffs |
| 8538ff57 | a59ea1f3 | feat: add immutable research execution snapshots | feat(research): add immutable research execution snapshots |
| d06ad984 | 9d868024 | refactor(research): remove fixed validation protocols | refactor(research): remove fixed validation protocols |
| 982cdd0f | ae46ec6b | feat: generate factor drafts from research executions | feat(research): generate factor drafts from research executions |
| d036131a | ef1bc3e5 | feat(research): generate Python strategy drafts | feat(research): generate Python strategy drafts |
| 49c1dd82 | db9c7c6d | docs(research): prioritize Python factors | docs(research): prioritize Python factors |
| d2c5df66 | 923b6bd2 | feat(factor): add Python factor contracts | feat(factor): add Python factor contracts |
| e920ccfc | 4bb19389 | feat(factor): run cross-sectional Python factors | feat(factor): run cross-sectional Python factors |
| 90b0231b | adcbcb95 | feat(factor): publish and consume Python factors | feat(factor): publish and consume Python factors |
| a8761ade | 6a4b4b1f | feat(factor): make Python the authoring default | feat(factor): make Python the authoring default |
| 55576d5b | 98bbb927 | feat(research): add point-in-time equity datasets | feat(research): add point-in-time equity datasets |
| b41419ef | bf80a986 | test(research): cover equity panel workflow | test(research): cover equity panel workflow |
| c39a5f87 | f6eeab43 | fix: persist research agent cell change proposals | fix(research): persist research agent cell change proposals |
| c03819cf | 6137b60f | feat: expose research sdk catalog to agent | feat(research): expose the Research SDK catalog to agents |
| adacabd4 | 366f65b2 | feat: carry research scope into factor reports | feat(factor): carry research scope into factor reports |
| 64a60400 | 8b6764c2 | feat(research): stream agent progress phases | feat(research): stream agent progress phases |
| 2ea92733 | f89bb170 | feat(dev): start local python runtime with app | feat(dev): start local python runtime with app |
| 45af5d4a | 8b687a27 | docs: close reactive research mainline | docs(research): record reactive workspace completion |
| a129ffe6 | 8a3010b7 | docs: expand help for research workflows | docs(docs): expand help for research workflows |
| 14673e5d | eb5896f8 | feat(web): improve research workspace UX | feat(web): improve research workspace UX |
| 83ef2174 | b12b58fb | feat: add research semantic clarification gate | feat(research): add research semantic clarification gate |
| 54233f50 | 6d60f75c | feat(research): expose governed yield curves | feat(research): expose governed yield curves |
| a0766694 | 47f1b193 | feat(research): govern statistical Python runtime | feat(research): govern statistical Python runtime |
| 6a3ff62a | 69f7a888 | docs: cover research clarification and runtime | docs(docs): cover research clarification and runtime |
| 5d18ece0 | 87e484a0 | feat: expand ETF research universe | feat(research): expand ETF research universe |
| ff8d4eeb | fb543dac | feat(docs): add first bilingual learning path | feat(docs): add first bilingual learning path |
| 072712fa | c829f6a5 | fix: clean up dev processes on shutdown | fix(dev): clean up dev processes on shutdown |
| 01464cef | 0d4c10b1 | 修复 Python Factor 运行时镜像 | fix(sandbox): correct the Python factor runtime image |
| 83cf418b | bf6de64f | 加固 Python 沙盒容器生命周期 | fix(sandbox): harden Python container lifecycle management |
| 469a4aef | 3725835f | feat(docs): add strategy learning path | feat(docs): add strategy learning path |
| 4b9a4946 | a92bd5a8 | feat(docs): add factor learning path | feat(docs): add factor learning path |
| 183ab7e7 | b8ab6fca | 加固 Python 沙盒协议与容器清理 | fix(sandbox): harden Python protocols and container cleanup |
| c9b7a3a9 | aa8339a7 | feat(docs): add verified learning case results | feat(docs): add verified learning case results |
| dceb1296 | 2421dd4f | feat(docs): add bond signal learning path | feat(docs): add bond signal learning path |
| 365caf28 | 0b0d8006 | feat: add verified stock bond allocation path | feat(docs): add verified stock bond allocation path |
| d7a08360 | 639a8acf | feat(docs): complete stock bond allocation case | feat(docs): complete stock bond allocation case |
| 260381d9 | aa2613ba | fix(engine): enforce portfolio correctness | fix(engine): enforce portfolio correctness |
| 975ae7d9 | 87f3f170 | docs: 记录金融计算精度改造 TODO | docs(engine): record financial precision improvement tasks |
| a18927d7 | ac40b180 | feat(docs): add verified commodity carry learning path | feat(docs): add verified commodity carry learning path |
| 168bb623 | 9a1fdb22 | feat(docs): add positive sales yield learning path | feat(docs): add positive sales yield learning path |
| 88dc29f6 | b418ec84 | fix(web): improve research mobile navigation | fix(web): improve research mobile navigation |
| 83da17ca | 3d913707 | feat(research): expose local data catalog coverage | feat(research): expose local data catalog coverage |
| 689a50a9 | 175c52e4 | feat(research): add document search and archive | feat(research): add document search and archive |
| b87daf63 | 55fbc5da | feat(research): read immutable factor reports | feat(research): read immutable factor reports |
| 1ff517ef | 6669813e | feat(research): discover factor reports in catalog | feat(research): discover factor reports in catalog |
| 13e17a0f | 20702df2 | feat(research): preserve and read backtest reports | feat(research): preserve and read backtest reports |
| 7cb2984f | 7fa22e1e | feat(lab): browse immutable backtest history | feat(lab): browse immutable backtest history |
| 67ea9e97 | 1f7aea8e | feat(lab): compare backtest reports | feat(lab): compare backtest reports |
| 2cdf73ca | f60d51c7 | feat(research): expose local datasets in catalog | feat(research): expose local datasets in catalog |
| 34113b9b | 5d7c97c6 | feat(research): expose macro fx and China rates | feat(research): expose macro fx and China rates |
| 6c17d9f5 | a8cd1d54 | feat(research): expose commodity datasets | feat(research): expose commodity datasets |
| 8ca89a56 | 8288b0a6 | feat(research): expose market and equity data | feat(research): expose market and equity data |
| 54990cd0 | 5e6737e4 | feat(research): expose scan and factor weather results | feat(research): expose scan and factor weather results |
| 97cc0198 | 3203f962 | feat(research): expose remaining market reference data | feat(research): expose remaining market reference data |
| 0393ab6f | 73b58034 | test(research): align catalog expectations | test(research): align catalog expectations |
| b21c6ba5 | d49f33f5 | feat(research): bound agent context | feat(research): bound agent context |
| 321089e8 | 70c111f4 | feat(research): attach cells to agent context | feat(research): attach cells to agent context |
| 9e1334fc | 4da05081 | docs: prefer complete task delivery | docs(repo): prefer complete task delivery |
| adf6a2b7 | 9bc13034 | fix(research): unify agent composer layout | fix(research): unify agent composer layout |
| 20c89421 | d08e247a | feat(research): preserve navigable cell context | feat(research): preserve navigable cell context |
| ef6fef31 | dd7acab6 | feat(research): make cell deletion dependency-aware | feat(research): make cell deletion dependency-aware |
| b98a7e23 | d7ffb6b5 | 规划估值驱动的基本面研究 | docs(market): plan valuation-driven fundamental research |
| 40ec5d72 | 62c92114 | 完成基本面研究 M0 来源验证 | feat(market): verify fundamental data sources |
| 1ccaf330 | 252adddf | 完成基本面研究 M1 版本化财报 | feat(market): add versioned financial statements |
| ae4f1e9e | 4e17a55e | 完成基本面研究 M2 标准化财务内核 | feat(market): standardize financial statement calculations |
| 805f93d4 | 73708a33 | 完成基本面研究 M3 Research 数据能力 | feat(research): expose fundamental research datasets |
| f52de044 | 2b6f0f97 | 完成基本面研究 M4 估值纵向闭环 | feat(research): connect end-to-end valuation research |
| 63688994 | c68f9e47 | 修复 M5 财报异常分类与指标隔离 | fix(market): isolate financial metrics and classify statement anomalies |
| fc302058 | d8ccbff1 | 完成基本面研究 M5 估值复用与行业驱动评估 | feat(research): reuse valuations and evaluate industry drivers |
| 7787f21b | 91a9963f | 完善三公司估值复核与财务样本审计 | feat(research): extend valuation reviews and financial sample audits |
| 12ce9092 | 113a81f6 | 完善基本面自选财报查询并明确研究平台职责 | feat(research): support selected financial statements and clarify scope |
| 177f63ab | 420e49f5 | 记录后端架构重构计划与实施基线 | docs(architecture): record the backend refactor plan and baseline |
| 00a0e83a | 2758268f | 整理公共基础设施与认证业务边界 | refactor(api): separate infrastructure and authentication responsibilities |
| bc4a1651 | 042f137f | 拆分公共运行设施与领域 Python 协议 | refactor(api): separate runtime infrastructure from Python domain protocols |
| ed8c4aae | 5422e8e3 | 统一任务生命周期与结果事务并集中启动装配 | refactor(api): unify job lifecycles and bootstrap registration |
| a034c611 | f925f8e7 | 按职责拆分 Research 文档执行与提案流程 | refactor(research): separate documents, execution, and proposals |
| 1bba29cd | ec60d700 | 整理 Research 数据能力与业务入口 | refactor(research): organize datasets and business entry points |
| 014899ba | 2d3b8a6f | 按职责整理 Factor 定义分析与发布流程 | refactor(factor): organize definitions, analysis, and publication |
| a52cfec1 | c9c4f2b8 | 整理 Strategy 执行、Engine 模拟与风险分析边界 | refactor(strategy): separate execution, simulation, and risk analysis |
| 82a1ff4b | d0fa4312 | 按职责整理 Signals 部署、运行与账户对账 | refactor(signals): separate deployments, runs, and accounting |
| d064503c | acb10f50 | 整理 Agent 对话、工具执行与公开库业务边界 | refactor(agent): separate conversations, tool execution, and sharing |
| 51e90e13 | c5b99532 | 整理 Market 数据领域、同步与维护入口 | refactor(market): organize datasets, synchronization, and maintenance |
| 3c55fd2f | 0ca1c507 | 按回测报告独立部署策略 | feat(signals): deploy strategies from individual backtest reports |
| 2cc06a35 | 08205857 | 固化后端依赖边界并完善架构阅读地图 | refactor(api): enforce dependency boundaries and document architecture |
| 72895a44 | b02db965 | chore(api): 清理旧策略演示脚本 | chore(api): remove obsolete strategy demonstration scripts |
| 8d48df41 | 7f4f3a7e | chore(api): 移除已退役的一次性数据迁移 | chore(api): remove retired one-time data migrations |
| 50c93423 | a99973c2 | chore(api): 按用途整理维护与研究脚本 | chore(api): organize maintenance and research scripts by purpose |
| 6dc1a4e6 | 9e3dad1a | refactor(agent): 移除策略对话快速回测 | refactor(agent): remove quick backtests from strategy conversations |
| 3f320e5d | 8718b15e | refactor(api): 使用原生模块别名替换跨模块相对导入 | refactor(api): use native aliases for cross-module imports |
| a26a6cf5 | b34aaba0 | refactor(api): 将包级测试迁入 tests 目录 | refactor(api): move package-level tests into the tests directory |
| d500eb5b | a53709a9 | refactor(api): 统一路由具名导出并扁平化认证 HTTP 入口 | refactor(api): standardize named routes and flatten authentication entry points |
| 1a893f6a | 5a3472ae | refactor(api): 统一各业务模块的 routes 入口 | refactor(api): standardize business module route entry points |
| 2c264926 | ab5d1958 | refactor(api): 统一策略与因子资源路由 | refactor(api): standardize strategy and factor resource routes |
| f6509001 | 39e8a48c | refactor(strategy): clarify resource routes and route ownership | refactor(strategy): clarify resource routes and route ownership |
| 1a68f1bd | a96955ac | refactor(factor): clarify resource routes and route ownership | refactor(factor): clarify resource routes and route ownership |
| a6b0fe62 | 3ecbe3f7 | refactor(research): clarify resource routes and route ownership | refactor(research): clarify resource routes and route ownership |
| a45688c1 | cc714612 | refactor(api): clarify remaining resource routes and ownership | refactor(api): clarify remaining resource routes and ownership |
