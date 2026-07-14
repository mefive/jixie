import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';

// User-facing message catalog. Keys are English identifiers the code references; values are per-locale
// strings with {name}-style placeholders. This is ONLY for text a user reads (HTTP errors, response
// notes, code-generated reply chrome). LLM prompt text is NOT here — prompts are static English strings
// in code, never routed through i18n (see docs/design/i18n.md).
const MESSAGES = {
  invalidInput: { zh: '入参不合法', en: 'Invalid input' },

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
  screenNotFound: { zh: '选股不存在', en: 'Screen not found' },
  conversationNotFound: { zh: '会话不存在', en: 'Conversation not found' },

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
    zh: '策略标识只能使用小写英文、数字和下划线,且必须以字母开头',
    en: 'The strategy key may contain only lowercase letters, digits, and underscores, and must start with a letter',
  },
  factorKeyUnavailable: {
    zh: '无法分配唯一的策略标识,请换一个名称',
    en: 'Could not allocate a unique strategy key; choose another name',
  },
  presetFactorReadonlyEdit: {
    zh: '预置因子只读,不能修改;可「复制为自定义」后改副本',
    en: 'Preset factors are read-only and cannot be modified; copy to a custom factor and edit the copy',
  },
  presetFactorReadonlyDelete: {
    zh: '预置因子只读,不能删除',
    en: 'Preset factors are read-only and cannot be deleted',
  },
  unknownFactor: { zh: '未知因子 {factor}', en: 'Unknown factor {factor}' },
  windowNotComputed: {
    zh: '该窗口尚未计算,请先运行',
    en: 'This window has not been computed yet; run it first',
  },
  factorJobNotFound: { zh: '任务不存在或已过期', en: 'Job not found or expired' },
  factorAnalysisFailed: {
    zh: '因子分析失败，请查看任务日志后重试',
    en: 'Factor analysis failed; review the job log and try again',
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
    zh: '未知因子 {key}(可用:{available},或 custom:<因子标识>)',
    en: 'Unknown factor {key} (available: {available}, or custom:<factor key>)',
  },
  customFactorMissing: {
    zh: '自定义因子不存在或已删除:{keys}(只能引用自己的因子)',
    en: 'Custom factor missing or deleted: {keys} (only your own factors can be referenced)',
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
