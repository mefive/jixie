export const zhFactorWeather = {
  eyebrow: 'FACTOR OBSERVATORY',
  title: '因子气象',
  subtitle:
    '按统一月频口径观察预置因子和已发布自定义因子的实际表现。颜色代表符合预期方向的费后多空收益。',
  methodology: {
    monthly: '月末调仓',
    neutral: '行业＋市值中性化',
    weighting: '十分位等权',
    completedMonths: '仅展示完整月份',
  },
  actions: {
    pin: '钉住因子',
    unpin: '取消钉住',
    retry: '重新计算',
    cancel: '取消',
  },
  groups: {
    preset: '预置因子',
    custom: '我的因子',
    count: '{{count}} 张卡片',
  },
  tags: {
    preset: '预置',
    custom: '自定义',
  },
  direction: {
    positive: '高值优先',
    negative: '低值优先',
  },
  metrics: {
    selectedMonth: '{{month}}',
    trailingThree: '近3月',
    trailingTwelve: '近12月',
    rollingIc: '12月均值IC',
    rawIc: '原始 Rank IC {{value}}',
    coverage: '覆盖率 {{value}}',
    turnover: '最高组换手 {{value}}',
    sample: '样本 {{count}}',
    unavailable: '暂无',
  },
  status: {
    computing: '正在生成月度历史',
    computingHint: '后台离线运行，不占用页面请求；长窗口因子的首次回填可能需要几分钟。',
    error: '计算失败',
    errorHint: '请稍后重新计算。',
    noPeriods: '尚无完整月度观测',
  },
  picker: {
    title: '钉住一个已发布因子',
    factor: '因子',
    factorPlaceholder: '选择预置或已发布因子',
    direction: '预期方向',
    directionHint: '方向只用于对齐颜色和收益符号，不会修改原始 Rank IC 或因子代码。',
    draftHint: '草稿因子需要先在因子研究中选择批准报告并发布。',
    confirm: '钉住并回填',
  },
  unpin: {
    title: '取消钉住“{{name}}”？',
    description: '将删除这张卡片及其离线月度观测，不会删除因子本身或研究报告。',
    confirm: '取消钉住',
  },
  empty: {
    description: '还没有钉住任何因子。选择一个因子后，系统会在后台回填月度表现。',
    action: '选择第一个因子',
  },
  messages: {
    loading: '加载因子气象…',
    loadFailed: '因子气象加载失败',
    pinStarted: '已钉住，正在后台生成月度历史',
    operationFailed: '操作失败，请稍后重试',
  },
  monthTooltip: '{{month}} · 方向对齐费后收益 {{net}} · 原始 IC {{ic}}',
};
