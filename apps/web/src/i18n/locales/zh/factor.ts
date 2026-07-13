// Factor research page (IDE-style workbench: Agent chat + library | editor + log | analysis result).
// zh is the source-of-truth shape; en/factor.ts mirrors it under `typeof zhFactor`.
export const zhFactor = {
  agentLabel: 'Agent',
  libraryTab: '因子库',
  newFactor: '新建',

  unnamedNew: '新因子（未保存）',
  noneSelected: '未选择因子',

  placeholderQa: '问问这个预设因子 —— 如「IC 0.03 算强吗」「适合什么周期」—— 回车发送',
  placeholderAuthor: '描述你想要的因子,如「盈利收益率 1/PE」「小市值」;或继续对话调整 —— 回车发送',

  chatEmptyQa:
    '这是预置因子(只读代码,见中间编辑器)。有关它 / 因子分析的问题都可以问 —— Agent 只答疑,不改代码;想改参数出变体,点编辑器上方「复制为自定义」。',
  chatEmptyAuthor:
    '跟 Agent 说你想要的因子(估值 / 规模 / 流动性 / 资金流 / 价格动量波动类),它写成代码进中间编辑器。财报明细类(ROE 增速等)暂缺数据。',

  presetGroup: '预设因子',
  customGroup: '自定义因子',
  customEmpty: '还没有,用 Agent 写一个',
  deleteTitle: '删除',
  deleteConfirmTitle: '删除确认',
  deleteConfirmContent: '确定删除自定义因子「{{name}}」吗?删除后不可恢复。',
  deleteOk: '删除',
  cancel: '取消',

  presetReadonly: '预置因子,代码只读',
  forkToCustom: '复制为自定义',
  editorLoading: '加载编辑器……',
  strategyKey: '策略标识',
  strategyKeyPlaceholder: 'earnings_yield',
  strategyKeyDraftHint: '由 Agent 根据因子生成,确认前可修改;确认后才能在 Strategy 中使用',
  strategyKeyInvalid: '只能使用小写英文、数字和下划线,且必须以字母开头',
  strategyKeyFinalize: '确认并锁定',
  strategyKeyConfirm: '确认使用 {{key}}?锁定后不能修改。',
  strategyKeyFinalized: '策略标识已锁定',
  strategyKeyLocked: '已锁定',

  log: '日志',
  logEmpty: '运行分析后在此查看日志(系统进度 + 你的 console 输出)',

  pickPrompt: '← 选一个因子,或让 Agent 写一个,再运行分析',

  freq: '频率',
  range: '区间',
  neutralLabel: '中性化',
  neutralNone: '无',
  neutralSize: '市值',
  neutralSizeIndustry: '市值+行业',
  neutralSizeTag: '·市值中性',
  neutralSizeIndustryTag: '·市值行业中性',
  paramsSummary: '{{frequency}}频 · {{start}} 至 {{end}} · {{neutral}}',
  paramsSettings: '分析设置',
  paramsMore: '更多设置',

  corrTrigger: '相关性矩阵',
  corrTitle: '因子相关性矩阵',
  corrSelectPlaceholder: '选 2~8 个因子',
  corrRun: '计算',
  corrHint:
    '两两截面 Spearman 按{{per}}取均值,区间 {{startYear}}–{{endYear}}(跟随右侧参数条)。含固定「市值」列查换皮',
  corrRunning: '计算中……(含窗口因子会慢,实时进度略)',
  corrCap: '{{periods}} 个{{per}}均值 · 红=正相关(冗余)· 蓝=负相关 · 对角线=1',
  corrEmpty: '选至少 2 个因子后点「计算」',
  view: '查看',
  run: '运行分析',
  recompute: '重算',
  runsLabel: '已跑',
  unitWeek: '周',
  unitMonth: '月',

  computing: '计算中……(基本面 / 自定义因子几秒;结果入库下次秒开)· 实时日志见中间「日志」',
  runPrompt: '设好频率 / 区间,点「运行分析」',
  sample: '样本 {{periods}} {{per}} · {{startYear}}–{{endYear}}',
  weightEqual: '等权',
  weightMktcap: '市值加权',

  dirUp: '正向 · 做多高分位',
  dirDown: '反向 · 做多低分位',
  dirFlat: '方向不显著',

  decileCap:
    '横轴 D1(因子值最低)→ D{{n}}(最高),纵轴各档「下一{{per}}」年化收益 —— 一路上行=动量,一路下行=反转。',
  decileCapMktcap: '「市值加权」看大票能否真赚到(等权易被小盘放大)。',

  metricIcMean: 'Rank IC 均值',
  metricIcMeanHint: '符号=方向 · 绝对值=强度',
  metricIcir: 'ICIR(年化)',
  metricIcirHint: 'IC 稳定性',
  metricIcPos: 'IC>0 占比',
  metricIcPosHint: '多少{{per}}份方向一致',
  metricLsAnn: '多空 D{{n}}−D1 年化',
  metricLsAnnHint: '纯因子收益',
  metricLsSharpe: '多空 Sharpe',
  metricLsMdd: '多空最大回撤',
  metricTopTurnover: '最高档{{per}}换手',
  metricTopTurnoverHint: '越高摩擦越重',

  lsNavTitle: '多空净值 · 费前 vs 费后',
  lsNavCap:
    '等权多空,费后每次调仓按两腿换手 × 单股往返成本(佣金+印花+滑点≈千3)扣减。融券受限,多空为假想构造,此图用于因子间比生存力',
  lsNavGross: '费前',
  lsNavNet: '费后',
  metricLsNetAnn: '费后多空(D10−D1)年化',
  metricLsNetAnnHint: '扣交易成本后的多空收益',
  metricLsNetSharpe: '费后 Sharpe',
  metricLsNetMdd: '费后最大回撤',

  icDecayTitle: 'IC 衰减 · 因子的持有周期',
  icDecayCap: '横轴前瞻交易日,纵轴 Rank IC —— {{hint}}',
  decayPeak: '|IC| 峰值在 {{days}} 日 · {{trend}}',
  decayTrendSlow: '越往后越强(慢因子,宜长持)',
  decayTrendFast: '短端更强、随后衰减(快因子,宜短持)',

  heatmapTitle: '分位 × 前瞻期 · 各档在不同持有期的收益',
  heatmapCap:
    '格子=日均前瞻收益(‱ 万分,已按持有天数归一化,横向可比),红涨绿跌。看哪个前瞻期下 D1→D{{n}} 单调最强、信号衰不衰。',

  kindPrice: '价格',
  kindFundamental: '基本面',
  kindMoneyflow: '资金流',
  kindCustom: '自定义',

  // Chart axis / tooltip labels (decile bar chart, IC-decay line, quantile heatmap).
  decileD1Low: 'D1低',
  decileDnHigh: 'D{{n}}高',
  decileTipAnn: '年化收益 {{pct}}%',
  decileTipSharpe: 'Sharpe {{sharpe}} · 期末净值 {{nav}}',
  icDecayTipHorizon: '{{days}} 日前瞻',
  days: '{{days}}日',
  qhCorner: '前瞻\\分位',

  // Store-side messages (surfaced via i18n.t in factor-store.ts).
  errorPrefix: '出错了:{{message}}',
  saveFailed: '因子保存失败,无法开始对话',
  requestFailed: '请求失败',
  turnStopped: '(已停止本轮回复)',
  unnamedFactor: '未命名因子',
  analysisInterrupted: '分析中断(服务重启),请重试',
  analysisFailed: '分析失败',

  // Built-in preset factor display names, keyed by catalog slug (apps/api/src/factor/builtin-factors.ts).
  builtin: {
    mom: '动量(60日,跳5)',
    mom_12_1: '动量(12-1月)',
    rev: '反转(5日)',
    vol: '波动率(20日)',
    vol120: '波动率(120日)',
    abturn: '异常换手率(21日/252日)',
    ep: '盈利收益率(1/PE_TTM)',
    bp: '账面市值比(1/PB)',
    dv: '股息率(%)',
    size: '规模(ln总市值)',
    roe: 'ROE质量(%)',
    gross_margin: '毛利率(%)',
    mf_net_main: '主力净额(万元)',
    mf_net_total: '总净额(万元)',
  },
};
