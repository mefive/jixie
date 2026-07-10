// Backtest workbench (/lab): the code-first IDE, trade detail, strategy cards. zh is the source-of-truth shape.
export const zhLab = {
  // New-strategy hero + prompt block
  heroTitle: '新建策略',
  heroHint: '用一句话描述你的策略，AI 写成代码，再自己调参',
  newModalHint: '用一句话描述你的新策略，AI 写成代码，再自己调参',
  recentVisits: '最近访问',
  promptPlaceholder:
    '如「每月买入股息率最高的 20 只，等权」「沪深300 里 ROE 大于 15% 的 30 只，每月调仓」',
  examplesLabel: '试试：',
  writeCodeDirectly: '或直接写代码 →',
  firstTimeTutorial: '第一次用?看入门教程 ↗',
  newButton: '新建',

  // Example starter prompts (chip label + the sentence sent to the agent)
  exampleHighDivLabel: '高股息 20 只',
  exampleHighDivPrompt: '每月买入股息率最高的 20 只，等权',
  exampleLowValLabel: '沪深300 低估值',
  exampleLowValPrompt: '沪深300 里 ROE 大于 15%、市盈率最低的 30 只，每月调仓，等权',
  exampleMomentumLabel: '中证500 动量',
  exampleMomentumPrompt: '中证500 里 20 日动量最强的 20 只，每周轮动，等权',

  // Unrun-edits leave guard
  unrunTitle: '有改动尚未运行',
  discardChanges: '放弃改动',
  unrunBody:
    '当前策略的代码 / 参数改动还没运行回测，离开将丢失。点「运行回测」保存后再操作，或放弃改动继续。',

  // Agent panel
  agentUnsavedName: '新策略（未保存）',
  historyTab: '历史',
  chatPlaceholder: '继续对话调整策略，如「加个 5% 止损」「改成周度调仓」— 回车发送',
  chatEmpty: '跟 Agent 说你想要的策略，或让它改现有代码。改动会直接写进中间的编辑器。',
  historyEmpty: '还没有策略，跑一次回测会自动保存。',

  // Run-config header
  runStart: '起始',
  runEnd: '结束',
  runCapital: '资金',
  unitWan: '万',
  runBacktest: '运行回测',
  runDisabledHint: '改动策略后可重新运行',

  // Code editor
  loadingEditor: '加载编辑器…',
  sdkDocTooltip: 'SDK 文档:{{name}}',
  sdkDocMenuLabel: '📖 查看 SDK 文档',
  factorLinkTooltip: '查看因子实现:{{name}}',
  factorImplementationLink: '查看因子实现',

  // Result overview
  runningCalc: '回测计算中…… 实时日志见下方「日志」',
  runFailed: '回测失败：{{error}}',
  resultEmpty: '写好左侧策略后点「运行回测」查看净值与指标。',
  loadingChart: '加载图表…',

  // Metrics (Sharpe / Calmar stay untranslated)
  metricAnnReturn: '年化收益',
  metricTotalReturn: '累计收益',
  metricExcessReturn: '超额收益',
  metricInfoRatio: '信息比率',
  metricMaxDrawdown: '最大回撤',
  metricWinRate: '胜率',
  metricProfitFactor: '盈亏比',
  metricTurnover: '年换手',
  metricFinalValue: '期末权益',
  metricTrades: '成交笔数',
  metricStockSleeve: '股票账户权益',
  metricFutureSleeve: '期货账户权益',
  metricFutureMargin: '期货保证金',
  metricNetExposure: '净敞口',

  // Log dock
  logStarting: '正在启动回测进程…',
  logEmpty: '运行策略后在此查看日志（系统进度 + 你的 console 输出）',
  logTab: '日志',

  // Result tabs
  tabOverview: '结果概览',
  tabTradeDetail: '交易明细（{{count}} 笔）',
  loadingTrades: '加载交易…',
  openInPage: '页面打开',

  // Monthly returns table
  monthlyTitle: '月度收益',
  monthLabel: '{{month}}月',
  yearTotal: '全年',

  // Trade detail chart + list
  seriesKline: 'K线',
  seriesStrategyReturn: '策略收益',
  seriesBenchmark: '沪深300',
  seriesVolume: '量',
  seriesTrade: '交易',
  navEquity: '权益',
  tdAll: '全部',
  tdHintAll: 'K 线为选中标的;交易点(黄)与右侧列表为全部标的的成交。价格为不复权真实成交价',
  tdHintSingle: '交易点(黄)在 K 线下方横轴;点它 → 右侧定位。价格为不复权真实成交价',
  tdNoData: '无行情',
  tdColInstrument: '标的',
  tdColDate: '日期',
  tdColSide: '方向',
  tdColShares: '数量',
  tdColContracts: '手数',
  tdColPrice: '价格',
  tdColAmount: '金额',
  sideBuy: '买',
  sideSell: '卖',

  // Standalone trade-detail page
  tpTitle: '交易详情',
  tpMissingId: '缺少策略 id',
  tpNotFound: '策略不存在或无权访问',
  tpLoading: '加载中……',
  tpNoTrades: '该策略暂无交易记录',
  tpLoadingChart: '加载图表……',
  tradesUnit: '{{count}} 笔',

  // Strategy card + picker
  deleteConfirmTitle: '删除确认',
  deleteConfirmContent: '确定删除「{{name}}」吗?删除后不可恢复。',
  delete: '删除',
  cancel: '取消',
  notBacktested: '未回测',
  myStrategies: '我的策略',
  pickerEmpty: '还没有保存的策略(跑一次回测会自动保存)',

  // Store-driven messages (agent bubbles + backtest errors)
  storeError: '出错了:{{message}}',
  storeRequestFailed: '请求失败',
  storeChatStartFailed: '出错了:策略保存失败,无法开始对话',
  storeTurnStopped: '(已停止本轮回复)',
  storeSaveFailedNoBacktest: '策略保存失败,无法回测',
  storeSaveFailed: '策略保存失败',
  storeSubmitFailed: '回测提交失败',
  storeBacktestInterrupted: '回测中断(服务重启),请重试',
  storeBacktestFailed: '回测失败',
};
