import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';

// User-facing message catalog. Keys are English identifiers the code references; values are per-locale
// strings with {name}-style placeholders. This is ONLY for text a user reads (HTTP errors, response
// notes, code-generated reply chrome). LLM prompt text is NOT here — prompts are static English strings
// in code, never routed through i18n (see docs/design/i18n.md).
const MESSAGES = {
  invalidInput: { zh: '入参不合法', en: 'Invalid input' },
  maintenanceInProgress: {
    zh: '市场数据正在维护，请稍后再试',
    en: 'Market data maintenance is in progress; try again shortly',
  },

  // —— Agent reply chrome (code-generated, not model output; localized by the turn's locale) ——
  codeUpdated: { zh: '(已更新代码)', en: '(code updated)' },
  changeDidNotCompile: {
    zh: '(⚠️ 生成的改动没能通过编译,已保留原代码;换个说法再试。错误:{error})',
    en: '(⚠️ The generated change did not compile; the original code was kept. Try rephrasing. Error: {error})',
  },
  invalidAgentReply: {
    zh: '模型未能生成有效答案,请重试',
    en: 'The model did not produce a valid answer; please try again',
  },
  turnHostGone: {
    zh: '会话宿主已不存在(可能已被删除)',
    en: 'The conversation host no longer exists (it may have been deleted)',
  },

  // —— Not-found (entities) ——
  strategyNotFound: { zh: '策略不存在', en: 'Strategy not found' },
  factorNotFound: { zh: '因子不存在', en: 'Factor not found' },
  publicStrategyMustBeSelfContained: {
    zh: '公开策略暂不支持依赖自定义因子，请先改为只使用内置数据和因子',
    en: 'Public strategies must currently use only built-in data and factors',
  },
  assetMustBePublishedBeforeSharing: {
    zh: '因子完成发布后才能公开分享',
    en: 'A factor must be published before it can be shared publicly',
  },
  screenNotFound: { zh: '选股不存在', en: 'Screen not found' },
  conversationNotFound: { zh: '会话不存在', en: 'Conversation not found' },
  researchStudyNotFound: { zh: '研究记录不存在', en: 'Research study not found' },
  researchCuratorRunNotFound: { zh: '研究整理记录不存在', en: 'Research curation run not found' },
  researchCuratorFindingNotFound: {
    zh: '研究整理候选不存在',
    en: 'Research curation finding not found',
  },
  researchLanguageServiceUnavailable: {
    zh: 'Python 语言服务暂不可用，请稍后重试',
    en: 'The Python language service is temporarily unavailable; try again shortly',
  },

  // —— Turn already running for an entity ——
  strategyTurnInProgress: {
    zh: '该策略已有正在进行的回复,请等它结束或取消',
    en: 'This strategy already has a reply in progress; wait for it to finish or cancel it',
  },
  factorTurnInProgress: {
    zh: '该因子已有正在进行的回复,请等它结束或取消',
    en: 'This factor already has a reply in progress; wait for it to finish or cancel it',
  },
  conversationTurnInProgress: {
    zh: '该会话已有正在进行的回复,请等它结束或取消',
    en: 'This conversation already has a reply in progress; wait for it to finish or cancel it',
  },

  // —— Naming (strategy / factor) ——
  needCodeOrPrompt: { zh: '需要 code 或 prompt', en: 'code or prompt required' },
  nameFailed: { zh: '命名失败', en: 'Naming failed' },
  unnamedStrategy: { zh: '未命名策略', en: 'Untitled strategy' },
  unnamedFactor: { zh: '未命名因子', en: 'Untitled factor' },
  copySuffix: { zh: '副本', en: 'copy' },

  // —— Factor ——
  factorCodeInvalid: { zh: '因子代码无效', en: 'Invalid factor code' },
  factorKeyInvalid: {
    zh: 'Factor key 只能使用小写英文、数字和下划线,且必须以字母开头',
    en: 'The Factor key may contain only lowercase letters, digits, and underscores, and must start with a letter',
  },
  factorKeyUnavailable: {
    zh: 'Factor key 已被占用或与内置 key 冲突,请换一个 key',
    en: 'The Factor key is already used or reserved by a built-in Factor; choose another key',
  },
  presetFactorReadonlyEdit: {
    zh: '预置因子只读,不能修改;可「复制为自定义」后改副本',
    en: 'Preset factors are read-only and cannot be modified; copy to a custom factor and edit the copy',
  },
  presetFactorReadonlyDelete: {
    zh: '预置因子只读,不能删除',
    en: 'Preset factors are read-only and cannot be deleted',
  },
  factorWeatherRequiresFinalized: {
    zh: '只有已发布的因子才能加入因子气象',
    en: 'Only published factors can be added to factor weather',
  },
  factorWeatherDirectionRequired: {
    zh: '请先选择因子的预期方向',
    en: 'Select the factor expected direction first',
  },
  factorWeatherPinNotFound: {
    zh: '因子气象卡片不存在',
    en: 'Factor weather card not found',
  },
  factorWeatherComputeFailed: {
    zh: '月度历史计算失败，请稍后重试',
    en: 'Monthly history computation failed; try again later',
  },
  factorWeatherRunningCannotUnpin: {
    zh: '月度历史正在计算，完成后才能取消钉住',
    en: 'Monthly history is being computed; unpin it after the run finishes',
  },
  pinnedFactorReadonlyEdit: {
    zh: '该因子已加入因子气象,代码快照已锁定;请复制为新因子后修改',
    en: 'This factor is pinned to factor weather and its code version is locked; copy it to a new factor before editing',
  },
  pinnedFactorReadonlyDelete: {
    zh: '该因子已加入因子气象,请先取消钉住再删除',
    en: 'This factor is pinned to factor weather; unpin it before deleting',
  },
  unknownFactor: { zh: '未知因子 {factor}', en: 'Unknown factor {factor}' },
  publishedFactorReadonly: {
    zh: '已发布或已归档的因子不可修改，请先复制为新草稿',
    en: 'Published or archived factors are immutable; copy one into a new draft to edit it',
  },
  publishedFactorCannotDelete: {
    zh: '已发布的因子不能删除，只能归档',
    en: 'A published factor cannot be deleted; archive it instead',
  },
  factorPublishReportInvalid: {
    zh: '发布依据必须是同一因子已完成且已揭示的研究报告',
    en: 'The approved report must be a completed and revealed report for the same factor',
  },
  factorPublishReportOutdated: {
    zh: '因子代码已在该报告后发生变化，请重新运行研究',
    en: 'The factor code changed after this report; run the research again before publishing',
  },
  windowNotComputed: {
    zh: '该窗口尚未计算,请先运行',
    en: 'This window has not been computed yet; run it first',
  },
  factorJobNotFound: { zh: '任务不存在或已过期', en: 'Job not found or expired' },
  factorAnalysisFailed: {
    zh: '因子分析失败，请查看任务日志后重试',
    en: 'Factor analysis failed; review the job log and try again',
  },
  factorAnalysisKindUnsupported: {
    zh: '研究类型 {kind} 的评估器尚未启用',
    en: 'The evaluator for analysis kind {kind} is not enabled yet',
  },
  factorCriterionUnsupported: {
    zh: '主判据与当前研究方法不匹配',
    en: 'The primary criterion does not match the selected research method',
  },
  factorTimeSeriesLoading: {
    zh: '正在加载 {count} 个 ETF 的复权历史…',
    en: 'Loading adjusted ETF history for {count} asset(s)…',
  },
  factorCommodityCarryTimeSeriesLoading: {
    zh: '正在加载 {count} 个商品的期货 Carry 与代理 ETF 复权历史…',
    en: 'Loading futures carry and adjusted proxy-ETF history for {count} commodity asset(s)…',
  },
  factorCommodityWarehouseReceiptTimeSeriesLoading: {
    zh: '正在加载 {count} 个商品的仓单与代理 ETF 复权历史…',
    en: 'Loading warehouse receipts and adjusted proxy-ETF history for {count} commodity asset(s)…',
  },
  factorTimeSeriesEvaluating: {
    zh: '正在评估 {count} 条时点观测…',
    en: 'Evaluating {count} point-in-time observation(s)…',
  },
  factorPanelLoading: {
    zh: '正在加载 {count} 个 ETF 的 Panel 横截面…',
    en: 'Loading the ETF panel cross-section for {count} asset(s)…',
  },
  factorPanelEvaluating: {
    zh: '正在评估 {count} 条 Panel 时点观测…',
    en: 'Evaluating {count} panel point-in-time observation(s)…',
  },
  factorMacroRegimeLoading: {
    zh: '正在加载 {count} 个目标 ETF 的宏观状态研究数据…',
    en: 'Loading macro-regime research data for {count} target ETF(s)…',
  },
  factorMacroRegimeEvaluating: {
    zh: '正在评估 {count} 条宏观状态条件收益观测…',
    en: 'Evaluating {count} macro-regime conditional-return observation(s)…',
  },
  factorUniverseHistoryMissing: {
    zh: '指数 {index} 在 {date} 之前没有历史成分，无法进行时点无偏的因子研究',
    en: 'Index {index} has no constituent snapshot on or before {date}; point-in-time factor research cannot continue',
  },
  factorUniverseHistoryStale: {
    zh: '指数 {index} 在研究日 {date} 只能取得 {snapshot} 的过期成分，请先同步历史指数成分',
    en: 'Index {index} only has the stale {snapshot} constituent snapshot for research date {date}; sync historical constituents first',
  },
  factorIndustryHistoryMissing: {
    zh: '缺少申万一级行业历史，无法进行行业内排序',
    en: 'Shenwan level-1 history is unavailable; within-industry ranking cannot continue',
  },
  factorRankingWithinIndustry: {
    zh: '使用研究日可见的申万一级行业进行行业内排序',
    en: 'Ranking within point-in-time Shenwan level-1 industries',
  },
  factorProcExited: {
    zh: '因子分析进程异常退出 (code {code})',
    en: 'Factor analysis process exited abnormally (code {code})',
  },

  // —— Date range (shared across backtest / factor / screen) ——
  startAfterEnd: {
    zh: '起始日期必须早于结束日期',
    en: 'Start date must be earlier than end date',
  },

  // —— Backtest ——
  backtestJobNotFound: {
    zh: '回测任务不存在或已过期',
    en: 'Backtest job not found or expired',
  },
  strategyBacktestInProgress: {
    zh: '该策略已有正在进行的回测,请等它结束后再试',
    en: 'This strategy already has a backtest in progress; wait for it to finish',
  },
  backtestStartFailed: {
    zh: '回测进程启动失败',
    en: 'Could not start the backtest process',
  },
  backtestProcExited: {
    zh: '回测进程异常退出 (code {code})',
    en: 'Backtest process exited abnormally (code {code})',
  },
  backtestRiskAnalysisUnavailable: {
    zh: '风险研究暂不可用，交易回测结果已保留：{error}',
    en: 'Risk research is unavailable; the trading backtest result was preserved: {error}',
  },
  strategyScanCodeInvalid: {
    zh: '策略代码无法读取参数，请检查 params 声明',
    en: 'Could not inspect strategy parameters; check the params declaration',
  },
  strategyPythonScanUnsupported: {
    zh: 'py-v1 暂不支持参数扫描，请先运行普通回测',
    en: 'py-v1 does not support parameter scans yet; run a regular backtest instead',
  },
  strategyScanInvalid: {
    zh: '参数扫描配置不合法',
    en: 'Invalid parameter-scan configuration',
  },
  strategyScanNoParameters: {
    zh: '策略尚未声明可扫描的数值参数',
    en: 'The strategy does not declare any numeric parameters to scan',
  },
  strategyScanSplitInvalid: {
    zh: '样本切分日必须是回测区间内的交易日，且之后仍有交易日',
    en: 'The split must be a trading day inside the backtest range with a later trading day available',
  },
  strategyScanInProgress: {
    zh: '该策略已有正在进行的参数扫描',
    en: 'This strategy already has a parameter scan in progress',
  },
  strategyScanStartFailed: {
    zh: '参数扫描进程启动失败',
    en: 'Could not start the parameter-scan process',
  },
  strategyScanProcExited: {
    zh: '参数扫描进程异常退出 (code {code})',
    en: 'Parameter-scan process exited abnormally (code {code})',
  },
  strategyScanNotFound: {
    zh: '参数扫描报告不存在',
    en: 'Parameter-scan report not found',
  },
  strategyScanJobNotFound: {
    zh: '参数扫描任务不存在或已过期',
    en: 'Parameter-scan job not found or expired',
  },
  strategyScanCell: {
    zh: '参数组合 {current}/{total} · {values}',
    en: 'Parameter combination {current}/{total} · {values}',
  },

  // —— Daily strategy deployment and signals ——
  strategyNeedsBacktestBeforeDeploy: {
    zh: '策略必须先完成一次回测才能上线',
    en: 'Run the strategy successfully before deploying it',
  },
  strategyFutureSignalsUnsupported: {
    zh: '每日信号当前只支持股票和 ETF 策略，期货策略暂不能上线',
    en: 'Daily signals currently support stock and ETF strategies only; futures deployments are not available yet',
  },
  strategyPythonSignalsUnsupported: {
    zh: 'py-v1 暂不支持每日信号部署',
    en: 'py-v1 does not support daily-signal deployments yet',
  },
  strategyDeploymentNotFound: {
    zh: '策略部署不存在',
    en: 'Strategy deployment not found',
  },
  strategyDeploymentPaused: {
    zh: '策略部署已暂停',
    en: 'Strategy deployment is paused',
  },
  signalRunNotFound: {
    zh: '信号运行不存在',
    en: 'Signal run not found',
  },
  signalExecutionNotFound: {
    zh: '执行记录不存在',
    en: 'Signal execution not found',
  },
  signalExecutionUnavailable: {
    zh: '该执行记录尚不可回填，或成交数量超过指令数量',
    en: 'This execution cannot be recorded yet, or the filled quantity exceeds the instruction',
  },
  signalJobNotFound: {
    zh: '信号任务不存在或已过期',
    en: 'Signal job not found or expired',
  },
  signalTradeDateInvalid: {
    zh: '信号日期必须是已收盘的交易日',
    en: 'The signal date must be a completed trading day',
  },
  signalNextTradeDateMissing: {
    zh: '交易日历中缺少下一交易日，请先同步交易日历',
    en: 'The next trading day is missing; sync the trading calendar first',
  },
  signalDataNotReady: {
    zh: '{date} 的市场数据尚未准备完成',
    en: 'Market data for {date} is not ready yet',
  },
  signalStartFailed: {
    zh: '信号生成进程启动失败',
    en: 'Could not start the signal-generation process',
  },
  signalProcExited: {
    zh: '信号生成进程异常退出 (code {code})',
    en: 'Signal-generation process exited abnormally (code {code})',
  },
  signalCaptureStart: {
    zh: '生成 {date} 收盘信号 · 执行日 {execDate}',
    en: 'Generating signals from the {date} close · execution date {execDate}',
  },
  signalCaptureDone: {
    zh: '信号生成完成 · {count} 条',
    en: 'Signal generation complete · {count} instruction(s)',
  },
  signalEmailSubject: {
    zh: '[机械交易系] {execDate} 信号：{buys} 买 {sells} 卖',
    en: '[Jixie] {execDate} signals: {buys} buy, {sells} sell',
  },
  signalEmailEmptySubject: {
    zh: '[机械交易系] {execDate} 今日无操作',
    en: '[Jixie] {execDate}: no action',
  },
  signalEmailErrorSubject: {
    zh: '[机械交易系] {tradeDate} 信号生成失败',
    en: '[Jixie] {tradeDate} signal generation failed',
  },
  signalEmailHeading: {
    zh: '{strategy} · 执行清单',
    en: '{strategy} · execution instructions',
  },
  signalEmailEmpty: {
    zh: '策略今日没有产生买卖操作。机械系统的不动也是决策。',
    en: 'The strategy produced no orders today. Doing nothing is still a mechanical decision.',
  },
  signalEmailError: {
    zh: '信号生成失败：{error}',
    en: 'Signal generation failed: {error}',
  },
  signalEmailReferenceNote: {
    zh: '市价指令次日开盘执行；条件单从下一交易日起等待触发，需在券商端挂单。',
    en: 'Market instructions execute at the next open; conditional orders wait for a trigger from the next trading day and must be placed with the broker.',
  },
  signalEmailOpenPage: {
    zh: '打开今日信号',
    en: 'Open daily signals',
  },
  signalEmailBuy: { zh: '买入', en: 'BUY' },
  signalEmailSell: { zh: '卖出', en: 'SELL' },
  signalEmailMarketOpen: { zh: '次日开盘', en: 'NEXT OPEN' },
  signalEmailStopLoss: { zh: '止损', en: 'STOP LOSS' },
  signalEmailTrailingStop: { zh: '跟踪止损', en: 'TRAILING STOP' },
  signalEmailLimitBuy: { zh: '限价买入', en: 'LIMIT BUY' },
  signalEmailTakeProfit: { zh: '止盈', en: 'TAKE PROFIT' },

  // —— Backtest engine progress logs (system-tagged, streamed to the job) ——
  backtestStart: {
    zh: '开始回测 · {start} ~ {end} · 初始资金 {cash}',
    en: 'Backtest started · {start} ~ {end} · initial cash {cash}',
  },
  backtestRebalance: {
    zh: '{date} 调仓 → 持仓 {count} 只',
    en: '{date} rebalanced → {count} holdings',
  },
  backtestYearlyHeartbeat: {
    zh: '{year} · 权益 {equity} · 进度 {pct}%',
    en: '{year} · equity {equity} · progress {pct}%',
  },
  backtestDone: {
    zh: '完成 · {days} 天 · {trades} 笔 · 期末 {finalValue} · 收益 {ret}%',
    en: 'Done · {days} days · {trades} trades · final {finalValue} · return {ret}%',
  },
  indexNoConstituents: {
    zh: '指数 {indexCode} 未收录成分数据(无法限定到该指数)',
    en: 'Index {indexCode} has no constituent data on record (cannot restrict to this index)',
  },
  unknownEngineFactor: {
    zh: '未知因子 {key}(可用:{available},或已发布的因子 key)',
    en: 'Unknown factor {key} (available: {available}, or a published factor key)',
  },
  customFactorMissing: {
    zh: '自定义因子不存在或已删除:{keys}(只能引用自己的因子)',
    en: 'Custom factor missing or deleted: {keys} (only your own factors can be referenced)',
  },
  factorResearchOnlyInputsUnavailable: {
    zh: '研究专用字段尚不能进入策略:{fields}',
    en: 'Research-only fields are not yet available to strategies: {fields}',
  },
  factorResearchAssetsUnsupported: {
    zh: '该 Factor 不支持以下研究资产:{assets}',
    en: 'This Factor does not support the following research assets: {assets}',
  },
  indexCoverageGap: {
    zh: '⚠️ 指数 {indexCode} 成分数据从 {date} 起,此前的交易日按空池处理(选不出标的)',
    en: '⚠️ Index {indexCode} constituent data starts from {date}; earlier trading days are treated as an empty universe (no selections)',
  },

  // —— Factor-analysis progress logs (system-tagged, streamed to the job during analysis) ——
  freqWeek: { zh: '周度', en: 'weekly' },
  freqMonth: { zh: '月度', en: 'monthly' },
  factorMissing: {
    zh: '⚠️ 因子 {factor} 不存在(预置未 seed 或已被删除)',
    en: '⚠️ Factor {factor} does not exist (preset not seeded or already deleted)',
  },
  factorRebalanceDates: {
    zh: '调仓日 {count} 个({freq})· 加载行情快照…',
    en: '{count} rebalance dates ({freq}) · loading price snapshots…',
  },
  factorComputingValues: {
    zh: '计算因子 {factor} 的值…',
    en: 'Computing values for factor {factor}…',
  },
  factorDailyCrossSection: {
    zh: '逐日横截面计算…',
    en: 'Computing daily cross-section…',
  },
  factorLoadingSections: {
    zh: '加载估值/资金流截面({count} 日)…',
    en: 'Loading valuation/money-flow cross-sections ({count} days)…',
  },
  factorPerStockWindow: {
    zh: '逐股计算窗口因子(window={window},{count} 只)…',
    en: 'Computing windowed factor per stock (window={window}, {count} stocks)…',
  },
  factorComputeProgress: {
    zh: '  已算 {done}/{total} 只',
    en: '  computed {done}/{total} stocks',
  },
  factorComputeErrors: {
    zh: '⚠️ 因子 compute 有抛错(相应股票已剔除),首个错误:{error}',
    en: '⚠️ Factor compute threw (affected stocks were dropped); first error: {error}',
  },
  factorLoadingDecaySnapshots: {
    zh: '加载 IC 衰减前瞻快照({count} 日)…',
    en: 'Loading IC-decay forward snapshots ({count} days)…',
  },
  factorNeutralizing: {
    zh: '中性化因子值(模式:{mode})…',
    en: 'Neutralizing factor values (mode: {mode})…',
  },
  factorCorrelating: {
    zh: '计算 {count} 列两两相关…',
    en: 'Computing pairwise correlation across {count} columns…',
  },
  factorAggregating: {
    zh: '汇总 IC / 分层 / IC 衰减…',
    en: 'Aggregating IC / buckets / IC-decay…',
  },

  // —— Sandbox console (strategy / factor user code) ——
  userLogCapped: {
    zh: '用户日志超过 {cap} 行,后续输出已省略',
    en: 'User log exceeded {cap} lines; further output omitted',
  },

  // —— Agent turn subscription ——
  turnNotFound: {
    zh: 'turn 不存在或已结束(会话以已保存内容为准)',
    en: 'Turn not found or already ended (the saved conversation is the source of truth)',
  },
  turnForbidden: { zh: '无权订阅该 turn', en: 'Not allowed to subscribe to this turn' },
  queryFailed: { zh: '查询失败', en: 'Query failed' },
  onlyGetSubscribe: { zh: '仅支持 GET 订阅', en: 'Only GET is supported for subscriptions' },

  // —— Screen ——
  noDataInRange: {
    zh: '该标的在区间内无数据',
    en: 'No data for this instrument in the range',
  },

  // —— Auth (verification code / invite code / account) ——
  emailAlreadyRegistered: {
    zh: '该邮箱已注册，登录无需邀请码',
    en: 'This email is already registered; no invite code is needed to log in',
  },
  accountDisabled: { zh: '账号已被禁用', en: 'Account has been disabled' },
  inviteCodeRequired: {
    zh: '新邮箱注册需要邀请码',
    en: 'Registering a new email requires an invite code',
  },
  inviteCodeInvalidFormat: { zh: '邀请码格式不正确', en: 'Invite code format is incorrect' },
  inviteCodeInvalidOrUsed: {
    zh: '邀请码无效或已使用',
    en: 'Invite code is invalid or already used',
  },
  codeAlreadySent: {
    zh: '验证码已发送，请稍后再试',
    en: 'Verification code already sent; please try again later',
  },
  emailSendFailed: {
    zh: '邮件发送失败，请稍后重试',
    en: 'Failed to send email; please try again later',
  },
  codeInvalidated: {
    zh: '验证码已失效，请重新申请',
    en: 'Verification code is no longer valid; please request a new one',
  },
  codeAlreadyUsed: { zh: '验证码已被使用', en: 'Verification code has already been used' },
  codeExpired: {
    zh: '验证码已过期，请重新申请',
    en: 'Verification code has expired; please request a new one',
  },
  tooManyAttempts: {
    zh: '验证次数过多，请重新申请验证码',
    en: 'Too many attempts; please request a new verification code',
  },
  codeWrong: { zh: '验证码错误', en: 'Incorrect verification code' },
  registerNeedsInvite: {
    zh: '注册需要邀请码，请重新申请',
    en: 'Registration requires an invite code; please request again',
  },
  inviteCodeExpired: {
    zh: '邀请码已失效，请重新申请',
    en: 'Invite code is no longer valid; please request again',
  },

  // —— Login verification-code email (subject + HTML body) ——
  emailLoginSubject: {
    zh: '机械交易系 登录验证码：{code}',
    en: 'Jixie login code: {code}',
  },
  emailLoginHeading: {
    zh: '机械交易系 登录',
    en: 'Jixie login',
  },
  emailLoginPrompt: {
    zh: '你的登录验证码：',
    en: 'Your login verification code:',
  },
  emailLoginValidity: {
    zh: '10 分钟内有效。',
    en: 'Valid for 10 minutes.',
  },
  emailLoginIgnore: {
    zh: '如果不是你本人操作，请忽略此邮件。',
    en: 'If you did not request this, please ignore this email.',
  },
} satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof MESSAGES;

type MessageParams = Record<string, string | number>;

// Render a message key in the given locale, substituting {name} placeholders.
export function t(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const entry = MESSAGES[key];
  let text = entry[locale] ?? entry[DEFAULT_LOCALE];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
