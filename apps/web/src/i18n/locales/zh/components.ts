// Shared components (agent stream, cards, log/loading views). zh is the source-of-truth shape.
export const zhComponents = {
  // Agent turn stream (transient status lines)
  streamConnectionFailed: '流式连接失败',
  queryingTool: '正在查询 {{name}}…',
  repairingCode: '代码编译未通过,修复中(第 {{round}} 次)…',
  writingCode: '正在写代码…',
  thinking: '思考中…',
  stop: '停止',

  // Generic states
  queryFailed: '查询失败',
  saveFailed: '保存失败',
  loadFailed: '加载失败',
  retry: '重试',
  noData: '暂无数据',

  // Confirm dialog
  confirmTitle: '确认',
  confirmOk: '确认',
  cancel: '取消',

  // Tool trace / DB query counts
  queriedDb: '查库 {{count}} 次:',
  queriedDbDone: '已查库 {{count}} 次:',
  traceRows: ' → {{rows}} 行',
  traceFailed: ' → 失败',
  traceShow: '查看执行记录',
  traceHide: '收起执行记录',
  traceLoading: '正在加载执行记录…',
  reasoning: '模型推理记录',
  traceArguments: '调用参数',
  traceObservation: '工具返回',
  traceModel: '模型调用 {{count}}',
  traceTool: '调用工具 {{name}}',
  traceValidation: '代码验证 {{round}}',
  traceError: '执行失败',
  traceCancelled: '执行已取消',
  traceDuration: '{{duration}} ms',
  tracePassed: '验证通过',
  traceFailedStatus: '验证失败',

  // Chat chart
  points: '{{count}} 点',
  chartQueryFailed: '图表查询失败(条件可能已过期):',

  // Query card
  unnamedScreen: '未命名筛选',
  pinnedToWall: '已钉到卡片墙(选股页)',
  stockCount: '共 {{count}} 只',
  pinTooltip: '钉到卡片墙(保存这条筛选,选股页可反复重跑)',
  queryFailedMaybeExpired: '查询失败(条件可能已过期):',
  moreRows: '前 {{count}} 条,钉住后到选股页看全部',
  nameColumn: '名称',
  marketValueUnit: '亿',
  field: {
    close: '现价',
    pctChg: '涨跌',
    dvRatio: '股息率',
    totalMv: '总市值',
    circMv: '流通市值',
    turnoverRate: '换手率',
  },

  // Log view (line source tags)
  tagUser: '用户',
  tagSystem: '系统',
};
