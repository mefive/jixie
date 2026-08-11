# 用户使用手册功能与截图清单

> 阶段 A 工作记录。首次清点日期：2026-07-28；阶段 J 更新日期：2026-08-04。
> 总体计划见 `docs/design/user-guide.md`。

## 1. 使用方式

本文档记录四类信息：

1. 当前产品向用户提供的页面和操作。
2. 每项操作应写入哪一组使用手册文章。
3. 可以核对页面的现有 E2E 和验收截图。
4. 尚未验证、需要补测或需要重新拍摄的内容。

这里列出的验收截图都是未经标注的测试截图，只能作为写作和页面核对依据。正式使用手册必须通过专门的文档截图流程重新拍摄。

## 2. 页面功能与文章对应表

### 2.1 登录

| 项目 | 内容 |
| --- | --- |
| 路由 | `/login` |
| 页面操作 | 输入邮箱、继续、新邮箱输入邀请码、发送验证码、输入六位验证码、登录、换个邮箱、重新开始 |
| 使用手册文章 | 登录；邀请码；收不到验证码；更换登录邮箱 |
| 当前 E2E | 其他 E2E 只调用开发环境直接登录，没有走完整邮箱、邀请码和验证码页面 |
| 当前截图 | 没有本轮生成的正式登录流程截图 |
| 缺口 | 需要为邮箱、邀请码、验证码和错误状态建立可重复的页面夹具或网络拦截，再拍摄各步骤 |

登录文档不得使用“开发环境直接登录”作为普通用户步骤。

### 2.2 顶部导航

| 项目 | 内容 |
| --- | --- |
| 页面入口 | 市场、因子气象、回测工作台、选股看图、因子研究、估值、今日信号 |
| 共享操作 | 切换中文/英文、打开使用帮助、查看当前邮箱、退出；系统维护时查看等待说明 |
| 使用手册文章 | 页面导航；切换语言；退出登录 |
| 当前 E2E | `help.mjs` 会验证产品侧新窗口打开帮助、文档内部同页切换，以及桌面和窄屏导航 |
| 当前截图 | 多数桌面截图包含顶部导航 |
| 缺口 | 无；产品标识和根地址返回市场，维护页正文已补充刷新、等待和联系维护人员的判断方法 |

### 2.3 选股看图

| 项目 | 内容 |
| --- | --- |
| 路由 | `/screen` |
| 页面操作 | 新对话；输入股票、ETF 或筛选条件；使用示例；查看筛选结果；移除条件；增加条件；调整排序；保存筛选；重新打开已保存筛选；打开历史会话；删除筛选或会话；从结果打开股票详情 |
| 使用手册文章 | 直接查询股票或 ETF；按条件筛选；修改条件；排序；保存筛选；历史对话；删除筛选；打开股票详情 |
| 当前 E2E | `screener.mjs` |
| 当前截图 | `1-screen-empty.png`、`2-query-view.png`、`2b-chips-edit.png`、`2c-saved-query-sidebar.png`、`2e-chat-empty.png`、`3-stock-detail.png` |
| 本轮结果 | 确定性筛选、条件修改、增加条件、排序、保存、重新打开、删除和股票详情跳转通过；阶段 D 已生成筛选结果、修改排序、保存和对话入口的正式标注截图；真实股票查询、同会话继续追问和 ETF 比较专项 E2E 通过 |
| 缺口 | 无；后续查询结果新增交互形式时再补对应文章与截图 |

正式文档需要区分：

- “直接查询一只股票或 ETF”
- “按条件筛选多只股票”
- “继续对话修改筛选”
- “保存筛选供以后重新运行”

这四种操作不能合并成一个模糊的“智能选股”步骤。

### 2.4 股票详情

| 项目 | 内容 |
| --- | --- |
| 路由 | `/stock/:code` |
| 页面操作 | 查看 K 线；切换前复权、后复权和不复权；切换线性和对数；查看 PE；查看成交量 |
| 使用手册文章 | 查看 K 线；复权；线性和对数；PE；成交量 |
| 当前 E2E | `screener.mjs` |
| 当前截图 | `3-stock-detail.png`、`3c-stock-raw.png`、`3b-stock-log.png` |
| 本轮结果 | 从筛选结果打开股票详情，前复权、后复权、不复权、线性和对数显示通过；阶段 D 已生成股票详情和后复权正式标注截图，并完成 K 线、PE、成交量和数据日期说明 |
| 缺口 | 无；后续页面增加独立指标开关时再补对应操作 |

### 2.5 回测工作台：开始与策略管理

| 项目 | 内容 |
| --- | --- |
| 路由 | `/lab`、`/lab?id=<策略编号>`、`/lab?new=1` |
| 页面操作 | 新建策略；输入一句话描述；使用示例；直接写代码；打开历史策略；修改策略；处理未运行修改提示；让策略 Agent 快捷试算当前代码 |
| 使用手册文章 | 认识回测工作台；新建策略；一句话生成策略；Agent 快捷回测；使用示例；直接写代码；历史策略；修改后重新运行；未运行修改提示 |
| 当前 E2E | `screener.mjs`、`learn.mjs`、`sdk-hover.mjs`、`help-content-backtest.mjs`、`help-content-backtest-states.mjs`、`help-content-strategy-agent.mjs` |
| 当前截图 | `workspace-01.png`、`strategy-description-01.png`、`strategy-generated-01.png`、`strategy-revised-01.png`、`strategy-revised-result-01.png`、`edit-rerun-01.png`；历史验收目录中的 `4-lab-hero.png`、`4b-lab-cards.png`、`4c-code-editor.png`、`4c1-factor-hover.png`、`4d-new-dirty-confirm.png`、`learn-6-lab-hero.png`、`7r-sdk-hover.png` |
| 本轮结果 | 使用专用账号完成两次真实模型调用：从描述生成沪深 300 ETF 100 股策略，继续修改为 200 股并运行回测；补充快捷试算只用于当前对话检查、正式结果仍须在工作台运行的边界 |
| 缺口 | 无 |

### 2.6 回测工作台：设置与运行

| 项目 | 内容 |
| --- | --- |
| 页面操作 | 设置起始日期、结束日期、资金、基础滑点、冲击系数和策略参数；选择日线、周线或月线；运行回测；查看运行状态；查看日志；重新连接进行中的任务 |
| 使用手册文章 | 设置回测参数；使用日线、周线和月线；运行回测和查看日志；运行中刷新页面；失败处理 |
| 当前 E2E | `strategy-orchestration.mjs`、`help-content-backtest.mjs`、`help-content-backtest-states.mjs` |
| 当前截图 | `run-settings-01.png`、`run-logs-01.png`、`reconnect-01.png`、`failure-01.png` |
| 本轮结果 | 普通月度策略真实回测通过；日期、资金、成本、运行状态、日志、刷新后任务恢复和代码编译失败均有当前正式截图；重复提交会被拒绝，结果会保存到策略 |
| 缺口 | 普通策略的运行状态无缺口；ETF、期货和混合策略仍待专项验证 |

本轮修正了主 E2E 中两处过时操作：

1. 资金输入框改为按“资金”的可访问名称定位，不再假定运行面板只有一个数字输入框。
2. 取消“有改动尚未运行”提示后，先重新打开“编辑启动参数”，再恢复资金值。

### 2.7 回测工作台：结果与交易明细

| 项目 | 内容 |
| --- | --- |
| 页面操作 | 查看净值、回撤、基准、累计收益、年化收益、超额收益、信息比率、最大回撤、胜率、盈亏比、换手、期末权益、成交笔数、显性费用、滑点损耗、月度收益和交易明细 |
| 路由 | 工作台结果区域；独立交易明细页 `/trades` |
| 使用手册文章 | 查看回测结果；查看净值、回撤和月度收益；查看交易明细和成本 |
| 当前 E2E | `strategy-orchestration.mjs`、`help-content-backtest.mjs` |
| 当前截图 | `results-overview-01.png`、`equity-drawdown-01.png`、`trades-01.png`、`trades-page-01.png` |
| 本轮结果 | 阶段 E 已使用当前代码重新运行真实回测，完成最新指标、净值、回撤、月度收益、工作台交易明细和独立交易明细页截图 |
| 缺口 | 核心普通策略结果阅读无缺口；ETF、期货和混合策略的专用结果仍待各自专项修复和验证 |

### 2.8 参数扫描

| 项目 | 内容 |
| --- | --- |
| 页面操作 | 打开扫描实验；在参数稳健性、仓位方案对比和容量测算间切换；填写候选值；选择观察指标；运行多个组合；查看结果图表和容量提示；打开某个组合 |
| 使用手册文章 | 比较多组策略参数、仓位方案和容量；为什么回测不等于未来收益 |
| 当前 E2E | `strategy-parameter-scan.mjs`、`help-content-parameter-scan.mjs` |
| 当前截图 | `parameter-scan-settings-01.png`、`parameter-scan-results-01.png`、`sizing-scan-settings-01.png`、`sizing-scan-results-01.png`、`capacity-scan-settings-01.png`、`capacity-scan-results-01.png`；验收目录中的 `strategy-parameter-scan.png` |
| 本轮结果 | 真实运行 4 组参数组合、3 种仓位方案和 3 个容量等级；图表、明细表与容量提示均通过；文章解释样本切分、过度拟合、仓位口径、成交额占比和冲击成本 |
| 缺口 | 无；后续增加新的扫描模式时同步扩展 |

### 2.9 ETF 策略

| 项目 | 内容 |
| --- | --- |
| 页面操作 | 从回测工作台使用 ETF 示例；在选股看图中直接查询 ETF；运行 ETF 策略；查看 ETF 交易明细 |
| 使用手册文章 | 查询 ETF；运行 ETF 策略；ETF 与股票策略的差异 |
| 当前 E2E | `etf-trading.mjs`、`help-content-etf-futures.mjs` |
| 当前截图 | `etf-entry-01.png`、`etf-trades-01.png`；验收目录中的 `etf-1-lab-entry.png`、`etf-2-research-entry.png`、`etf-3-trade-detail.png` |
| 本轮结果 | 主要 ETF 轮动入口、真实 ETF 买入和卖出、ETF 资产标识、成交汇总和筛选通过；此前的 worker 错误未再出现 |
| 缺口 | 无；不同 ETF 品种的具体交易制度后续随品种支持范围补充 |

### 2.10 股指期货和混合策略

| 项目 | 内容 |
| --- | --- |
| 页面操作 | 声明股指期货；查看股票账户权益、期货账户权益和期货保证金；查看期货成交；运行股票和股指期货混合策略 |
| 使用手册文章 | 股指期货基础；期货保证金；混合策略；期货风险 |
| 当前 E2E | `mixed-futures.mjs`、`help-content-etf-futures.mjs` |
| 当前截图 | `futures-trades-01.png`、`mixed-results-01.png`、`mixed-trades-01.png`；验收目录中的 `mixed-futures-result.png` |
| 本轮结果 | 纯股指期货开平仓、主力换月和实际月合约通过；混合策略约 6 秒完成，分账户权益、保证金、净敞口及股票期货合并成交通过；此前两分钟超时未再出现 |
| 缺口 | 无；当前文章已说明手数、名义金额、保证金、换月成本和对冲不能消除全部风险 |

### 2.11 因子研究：预设因子与分析

| 项目 | 内容 |
| --- | --- |
| 路由 | `/factors`、`/factors?factor=<因子>`、`/factors?factor=<因子>&report=<报告>` |
| 页面操作 | 打开因子库；选择预设因子；查看只读代码；设置频率和区间；设置中性化；设置股票池、缺失值、异常值和交易成本；运行分析；让因子 Agent 运行探索分析 |
| 使用手册文章 | 因子研究能回答什么；预设因子；分析设置；运行分析；因子 Agent 探索分析 |
| 当前 E2E | `screener.mjs`、`historical-investability.mjs`、`factor-report-history.mjs`、`help-content-factor-basics.mjs`、`help-content-factor-metrics.mjs`、`help-content-factor-discipline.mjs` |
| 当前截图 | 正式截图 `factor-workspace-01.png`、`factor-settings-01.png`、`factor-research-card-01.png`、`factor-running-01.png`、`factor-neutralization-setting-01.png`、`factor-neutralization-history-01.png`、`factor-research-hypothesis-01.png`、`factor-research-summary-01.png`；验收目录中的 `7-factors.png`、`7f-abturn-builtin.png`、`7c-preset-readonly.png`、`7o-factor-methodology.png`、`4-7a-historical-investability.png` |
| 本轮结果 | 阶段 F 使用盈利收益率完成探索、假设验证和正式保留段；阶段 I 补充 Agent 探索分析与正式保留段的边界，以及 `grossprofitMargin` 百分比单位和时点历史口径 |
| 缺口 | 预设因子和研究纪律闭环已完成；自定义因子与策略标识作为下一批 |

### 2.12 因子研究：结果

| 项目 | 内容 |
| --- | --- |
| 页面操作 | 查看分组收益、分位数组合、Rank IC、IC 衰减、多空收益、费后净值、换手、样本数、相关性矩阵和计算图表 |
| 使用手册文章 | 分组收益；Rank IC；IC 衰减；多空收益；交易成本；换手；相关性矩阵；计算图表 |
| 当前 E2E | `screener.mjs`、`computed-chart.mjs`、`help-content-factor-basics.mjs`、`help-content-factor-metrics.mjs`、`help-content-factor-discipline.mjs` |
| 当前截图 | 正式截图 `factor-methodology-01.png`、`factor-overview-01.png`、`factor-deciles-01.png`、`factor-rank-ic-01.png`、`factor-ic-decay-01.png`、`factor-cost-settings-01.png`、`factor-cost-results-01.png`、`factor-neutralization-result-01.png`、`factor-correlation-settings-01.png`、`factor-correlation-result-01.png`；验收目录中的 `7-factors.png`、`7b-factors-week.png`、`7d-factors-neutral.png`、`7e-factors-correlation.png`、`7q-computed-chart-cards.png` |
| 本轮结果 | 第二批解释分组收益、Rank IC、ICIR、IC 衰减、换手、成本和中性化；第三批按实际每期截面 Spearman 均值解释相关性矩阵，并真实计算盈利收益率、账面市值比、股息率和市值列 |
| 缺口 | 因子报告核心结果和相关性无缺口；后续因子结果新增指标时同步补充 |

### 2.13 因子研究：历史报告与样本外

| 项目 | 内容 |
| --- | --- |
| 页面操作 | 打开历史报告；恢复历史参数；识别代码或参数已修改；处理未运行修改；创建研究卡；运行留出期；揭示样本外结果；窄屏查看 |
| 使用手册文章 | 历史报告；报告已过期；研究假设；留出期；样本外结果 |
| 当前 E2E | `factor-report-history.mjs`、`help-content-factor-discipline.mjs` |
| 当前截图 | 正式截图 `factor-report-outdated-01.png`、`factor-holdout-confirm-01.png`、`factor-holdout-sealed-01.png`、`factor-holdout-history-01.png`、`factor-reveal-confirm-01.png`、`factor-holdout-revealed-01.png`；验收目录中的 `7g-factor-history-button.png`、`7g-factor-history-desktop.png`、`7h-factor-history-narrow.png`、`7i-factor-report-outdated.png`、`7j-factor-history-param-guard.png`、`7k-factor-code-outdated.png`、`7l-factor-discard-guard.png`、`7m-factor-running-resume.png`、`7n-factor-research-card.png` |
| 本轮结果 | 历史恢复、报告过期提示、研究卡、探索变体计数、正式保留段资格、冻结代码、结果封存、不可逆揭示、首次揭示时间和预设标准判定均有当前正式文章与真实截图 |
| 缺口 | 无；正文已排在预设因子基础和指标文章之后 |

### 2.14 因子研究：自定义、多因子与策略

| 项目 | 内容 |
| --- | --- |
| 页面操作 | 复制预设因子；编辑副本；新建自定义因子并设置唯一 key；创建和编辑多因子合成；运行并阅读合成报告；发布 Factor；从策略编辑器查看因子实现；在策略中引用单因子 |
| 使用手册文章 | 复制预设因子；自定义因子；创建多因子合成；阅读多因子报告；Factor key；在策略中使用因子 |
| 当前 E2E | `screener.mjs`、`sdk-hover.mjs`、`factor-strategy-history.mjs`、`help-content-factor-custom.mjs`、`help-content-factor-composite.mjs` |
| 当前截图 | 自定义因子正式截图 10 张；新增 `factor-composite-definition-01.png`、`factor-composite-report-01.png`；验收目录中的 `7c-preset-readonly.png`、`7c1-factor-key.png`、`4c1-factor-hover.png`、`7r-sdk-hover.png` |
| 本轮结果 | 自定义因子的复制、编辑、真实分析、标识锁定和策略引用已验证；阶段 I 新增等权多因子合成，使用盈利收益率和 ROE 完成真实 V4 分析，并说明共同股票池、标准化、方向和当前不能直接作为策略键引用的边界 |
| 验证 | `factor-strategy-history.mjs` 通过；`factor-semantics.test.ts` 11 项通过；原 `number 0 is not a function` 阻塞已关闭 |
| 缺口 | 无；Agent 入口已说明，固定截图流程不依赖外部模型响应，其余关键步骤均通过真实页面和真实计算 |

本轮把 SDK 悬停断言改为验证稳定内容：

- `StrategyCtx`
- `.universe(indexCode?: string): Promise<Universe>`
- 中文说明
- “SDK 文档”链接

不再依赖 Monaco 是否在 `StrategyCtx` 后显示泛型参数。

### 2.15 因子气象

| 项目 | 内容 |
| --- | --- |
| 路由 | `/factor-weather` |
| 页面操作 | 钉住预置因子或已定稿自定义因子；选择预期方向；等待历史回填；选择历史月份；查看费后多空收益、近 3 月、近 12 月、滚动 IC、覆盖率、换手和样本；重算失败卡片；取消钉住 |
| 使用手册文章 | 开始使用因子气象；阅读因子气象卡片 |
| 当前 E2E | `factor-weather.mjs`、`help-content-factor-weather.mjs` |
| 当前截图 | `factor-weather-overview-01.png`、`factor-weather-pin-01.png`、`factor-weather-history-01.png` |
| 本轮结果 | 固定月末调仓、行业加市值中性化、十分位等权和仅完整月份的方法已写入正文；两组卡片、48 个月份格、历史选择、钉住选择器和窄屏布局通过 |
| 缺口 | 无；计算失败、重算和取消钉住已有正文边界，后续页面方法变化时同步更新 |

### 2.16 市场

| 项目 | 内容 |
| --- | --- |
| 路由 | `/market` |
| 页面操作 | 在申万行业、规模宽基、市场板块和风格策略之间切换；选择周、月、季、年；查看卡片收益、热度、活跃、广度、估值和状态；回放历史；打开卡片详情 |
| 使用手册文章 | 查看市场气象图；理解市场气象卡片；回放历史并查看卡片详情 |
| 当前 E2E | `market-state.mjs`、`help-content-market-valuation.mjs` |
| 当前截图 | `market-weather-overview-01.png`、`market-weather-dimensions-01.png`、`market-weather-playback-01.png`、`market-weather-detail-01.png` |
| 本轮结果 | 旧单范围四指标正文已重写为卡片式市场气象；31 个行业、10 个规模指数、8 个板块指数和 16 个风格指数、时间轴、详情抽屉和窄屏布局全部通过 |
| 缺口 | 无；正文明确热度不是上涨概率，估值来源独立，历史不使用今天成分回填 |

### 2.17 估值

| 项目 | 内容 |
| --- | --- |
| 路由 | `/valuation` |
| 页面操作 | 选择指数；查看市盈率 TTM、市净率、静态市盈率和换手率；查看近十年和全历史百分位；缩放历史图；阅读口径 |
| 使用手册文章 | 查看指数估值；正确理解历史百分位 |
| 当前 E2E | `market-state.mjs`、`help-content-market-valuation.mjs` |
| 当前截图 | 正式截图 `valuation-overview-01.png`、`valuation-index-01.png`、`valuation-history-01.png`；验收目录中的 `valuation.png` |
| 本轮结果 | 指数切换、四项指标、近 5 年、近 10 年、全部历史、图表缩放、两种百分位和计算口径均有正式文章和真实标注截图 |
| 缺口 | 无；正文明确低百分位不等于马上上涨，不同指数相同百分位也不等于绝对估值相同 |

### 2.18 今日信号

| 项目 | 内容 |
| --- | --- |
| 路由 | `/signals` |
| 前置操作 | 在回测工作台完成回测并点击“部署上线” |
| 页面操作 | 查看运行中策略；立即生成；查看信号日、执行日、模型权益、邮件通知、买卖方向、股数、参考价、概算金额和运行历史；区分模型、模拟和实际账户；回填实际成交；查看执行率与偏差；把待挂条件单录入券商；理解“今日无操作”；处理中断或失败 |
| 使用手册文章 | 部署回测策略；生成今日信号；查看信号指令；记录实际成交并比较执行偏差；使用和记录条件单；查看历史并暂停上线 |
| 当前 E2E | `daily-signals.mjs`、`help-content-signals.mjs` |
| 当前截图 | 原有部署与信号正式截图 8 张；新增 `signal-conditional-01.png`、`signal-execution-overview-01.png`、`signal-execution-record-01.png`、`signal-execution-complete-01.png`；验收目录中的中文、英文和窄屏成功截图 |
| 本轮结果 | 真实前置回测、部署、无操作、300 股买入和下一交易日结算通过；待挂跟踪止损、模拟成交、实际成交回填、实际账户指标、执行率和成交偏差均由专项 E2E 验证；旧 `number 1 is not a function` 未再出现 |
| 缺口 | 无；E2E 使用已有完整行情的固定信号日，避免当前日期超过本地固定数据截止日 |

### 2.19 策略 SDK 参考

| 项目 | 内容 |
| --- | --- |
| 路由 | `/docs/sdk` |
| 页面操作 | 按分组查找方法；使用锚点；从编辑器悬停或菜单打开；切换中英文；同页切换到使用帮助；返回工作台 |
| 使用手册文章 | 只在“直接编写策略代码”部分介绍如何查 SDK |
| 当前 E2E | `screener.mjs`、`learn.mjs`、`sdk-hover.mjs`、`help.mjs` |
| 当前截图 | `6-sdk-docs.png`、`6b-sdk-docs-en.png`、`learn-5-docs-crosslink.png`、`7r-sdk-hover.png` |
| 本轮结果 | 页面、语言切换、锚点、帮助切换、工作台入口和编辑器悬停链接通过 |
| 处理方式 | 保持结构化生成，不迁入 Markdown 使用手册 |

### 2.20 旧入门教程

| 项目 | 内容 |
| --- | --- |
| 路由 | `/learn` |
| 当前章节 | 第一个策略；`onBar`；`bar` 与 `bars`；`order` 与 `target`；截面选股；常见问题；下一步 |
| 当前 E2E | `learn.mjs` |
| 当前截图 | `learn-1-top.png` 至 `learn-6-lab-hero.png` |
| 本轮结果 | 页面、章节滚动、SDK 交叉链接和工作台入口通过 |
| 处理方式 | 已从导航移除并由产品路由跳转到新使用帮助；可复用内容已按第 5 节迁入进阶策略代码文章 |

## 3. 量化交易基础与页面对应表

| 基础知识 | 首次出现页面 | 关联操作文章 |
| --- | --- | --- |
| 股票、ETF、指数 | 选股看图、估值 | 直接查询；指数估值 |
| 开盘价、收盘价、成交量、成交额 | 股票详情 | 查看 K 线；查看成交量 |
| 前复权、后复权、不复权 | 股票详情、回测 | 切换复权；回测价格 |
| 市盈率、市净率、股息率、市值 | 选股看图、估值 | 按估值筛选；指数估值 |
| 策略和回测 | 回测工作台 | 第一次运行回测 |
| 回测区间和初始资金 | 回测工作台 | 回测设置 |
| 累计收益、年化收益、超额收益 | 回测结果 | 阅读绩效指标 |
| 最大回撤 | 回测结果 | 查看回撤 |
| 胜率和盈亏比 | 回测结果 | 阅读绩效指标 |
| 换手、佣金、印花税、滑点、市场冲击 | 回测结果、因子研究 | 回测设置；交易成本 |
| T+1、涨跌停、停牌、整手 | 回测、交易明细 | 为什么订单没有成交 |
| 参数选择和过度拟合 | 参数扫描 | 参数扫描 |
| 仓位方案、策略容量和市场冲击 | 扫描实验 | 比较多组策略参数 |
| 因子 | 因子研究 | 第一次运行预设因子 |
| 多因子标准化、方向和等权合成 | 因子研究 | 创建多因子合成；阅读多因子报告 |
| 分组收益和 Rank IC | 因子结果 | 阅读因子报告 |
| 中性化 | 因子设置 | 市值和行业中性化 |
| 样本内、留出期和样本外 | 因子历史 | 留出期和样本外结果 |
| 历史百分位 | 市场、估值 | 阅读百分位 |
| 保证金和期货逐日结算 | 混合策略 | 股指期货基础 |
| 信号日、执行日和参考价 | 今日信号 | 查看今日信号 |
| 模型、模拟、实际账户与执行率 | 今日信号 | 记录实际成交并比较执行偏差 |
| 止损、跟踪止损、限价买入和止盈 | 今日信号 | 使用和记录条件单 |

基础文章使用产品中的具体例子，不另写与产品无关的量化教材。

## 4. E2E 执行记录

### 4.1 本轮结果

| E2E | 结果 | 说明 |
| --- | --- | --- |
| `screener.mjs` | 通过 | 修正资金输入框和参数面板重开后，完整主流程通过 |
| `learn.mjs` | 通过 | 旧教程、SDK 链接和工作台入口通过 |
| `historical-investability.mjs` | 通过 | 默认股票池和历史可投资性设置通过 |
| `factor-report-history.mjs` | 通过 | 历史、修改保护、研究卡和留出期通过 |
| `help-content-factor-basics.mjs` | 通过 | 真实盈利收益率分析和 6 张阶段 F 入门标注截图通过 |
| `help-content-factor-metrics.mjs` | 通过 | 原始及市值加行业中性化分析和 8 张阶段 F 指标标注截图通过 |
| `help-content-factor-discipline.mjs` | 通过 | 假设探索、正式保留段封存揭示、相关性计算和 10 张阶段 F 研究纪律标注截图通过 |
| `help-content-factor-custom.mjs` | 通过 | 复制、新建、真实分析、Factor 发布、raw key 策略引用、编辑器悬停、真实回测和标注截图通过 |
| `computed-chart.mjs` | 通过 | 310 行计算结果和图表卡片通过 |
| `sdk-hover.mjs` | 通过 | 修正泛型显示相关的过时断言后通过 |
| `factor-strategy-history.mjs` | 通过 | 2026-07-30 真实数据库重跑通过：窗口历史自定义因子进入隔离 worker，回测完成并产生 28 笔交易 |
| `strategy-orchestration.mjs` | 通过 | API 重启后，普通月度定投回测通过，成交 1 笔 |
| `help-content-strategy-agent.mjs` | 通过 | 两次真实模型调用完成策略生成和 100→200 股修改，随后真实回测通过 |
| `strategy-parameter-scan.mjs` | 通过 | 四个参数组合通过 |
| `help-content-parameter-scan.mjs` | 通过 | 4 组参数、3 种仓位方案、3 个容量等级和 6 张正式截图通过 |
| `help-content-factor-composite.mjs` | 通过 | 真实创建盈利收益率与 ROE 等权合成，完成 V4 分析和 2 张正式截图 |
| `help-content-factor-weather.mjs` | 通过 | 固定页面数据验证总览、钉住对话框、历史月份和 3 张正式截图 |
| `daily-signals.mjs` | 通过 | 真实回测、部署、页面立即生成、300 股买入、持久化结果、中英文和窄屏通过 |
| `help-content-market-valuation.mjs` | 通过 | 真实市场气象四维度、回放、卡片详情和估值页，共 7 张标注截图 |
| `help-content-signals.mjs` | 通过 | 部署、版本过期、无操作、买入、下一日结算、待挂条件、模拟与实际成交和 12 张标注截图通过 |
| `etf-trading.mjs` | 通过 | ETF 页面入口、真实买卖成交、资产标识和交易明细通过 |
| `market-state.mjs` | 通过 | 31/10/8/16 张卡片、时间轴、详情和窄屏布局通过 |
| `mixed-futures.mjs` | 通过 | 混合回测约 6 秒完成，股票／期货账户权益、保证金和净敞口通过；测试策略已自动清理 |

### 4.2 相关单元测试

| 测试 | 结果 |
| --- | --- |
| `src/engine/factor-semantics.test.ts` | 11 项通过，包括进墙后的 `turnoverRateF` 历史 |
| `src/engine/walled-run.test.ts` | 5 项通过，包括目标持仓、信号捕获和期货 |

这说明失败集中在真实数据库和产品 worker 路径，不能仅凭单元测试宣布功能可用于文档。

### 4.3 本轮未运行的可选步骤

- `screener.mjs` 的 `E2E_NL=1`：需要外部模型调用。
- `screener.mjs` 的 `E2E_BT=1`：主脚本中的完整结果和交易明细截图。

自然语言步骤需要在阶段 C 至 F 分批运行，避免一次调用产生大量不稳定内容。正式截图中使用的输入句子必须固定。

## 5. 旧 `/learn` 处理清单

| 现有章节 | 处理 | 目标位置 | 原因 |
| --- | --- | --- | --- |
| “十分钟写出你的第一个策略”总标题 | 重写 | 开始使用；直接写代码 | 时间承诺不必要，而且它不是整个产品的入门 |
| “五分钟：你的第一个策略” | 拆分并重拍 | 第一次运行回测；直接写代码 | 保留可运行示例，但要先写页面设置、运行和结果，不能只有代码 |
| `onBar` | 保留并改写 | 进阶：策略代码基础 | 是代码用户需要的概念，不是所有新用户的起点 |
| `bar` 与 `bars` | 保留并改写 | 进阶：读取行情数据 | 增加当前 SDK 链接和真实编辑器截图 |
| `order` 与 `target` | 保留并改写 | 进阶：下单和目标持仓 | 保留“目标持仓是完整快照”的警告 |
| 截面选股示例 | 保留并更新 | 进阶：编写选股策略 | 重新核对当前因子字段、运行设置和结果 |
| 常见坑 | 拆分 | 各操作文章的常见问题；进阶代码常见问题 | 问题应出现在用户遇到它的文章中 |
| 下一步 | 替换 | 使用帮助首页 | 改为产品完整阅读路径，不只链接 SDK 和回测工作台 |

旧教程的以下写法不进入新手册：

- “建立心智”
- “先跑通，再理解”
- 以预计完成时间作为标题
- 在没有页面截图和运行设置的情况下直接要求复制代码

旧教程中的代码和解释不能直接复制。迁移前必须重新执行并与当前 SDK、交易规则和页面文字核对。

## 6. 截图处理结论

### 6.1 可以作为页面核对依据

- 本轮重新生成且对应 E2E 通过的截图。
- 页面日期和数据范围清楚的图表截图。
- 中文界面下按钮和字段完整可见的截图。

### 6.2 不能直接进入正式手册

- 带有 `e2e@test.com` 或测试策略名称的完整页面截图。
- 只用于证明错误状态的 `error.png`、`daily-signals-error.png`。
- 本轮对应 E2E 失败或超时的结果截图。
- 没有步骤编号的原始截图。
- 与当前页面控件不一致的历史截图。
- 英文截图混入中文第一版文章。

### 6.3 阶段 B 后需要的截图能力

1. 使用固定中文测试账号和固定输入。
2. 截图前隐藏或替换邮箱。
3. 按文章保存到独立目录，不写入通用 `acceptance/`。
4. 保留原始图和标注图。
5. 数字标记与 Markdown 步骤一一对应。
6. 支持桌面局部截图、完整页面截图和必要的窄屏截图。
7. 对图表等待 ECharts 绘制完成。

## 7. 阶段 A 结论

阶段 A 的页面清点、文章对应、截图清单和旧教程处理清单已经完成。

进入阶段 B 前必须保留以下事实：

1. 新使用手册入口使用 `/docs/help`，策略 SDK 使用 `/docs/sdk`。
2. 中文第一版按普通用户路径组织，策略代码和因子代码放在进阶部分。
3. 现有验收截图不直接进入手册。
4. 自然语言生成、真实结果页、交易明细、ETF、今日信号和混合期货均已有当前真实 E2E。
5. `factor-strategy-history` 与 `daily-signals` 的历史函数调用错误均已于 2026-07-30 重跑关闭。
6. `mixed-futures` 已重跑通过，股票与期货混合回测约 6 秒完成。

阶段 J 已把市场气象和因子气象补入帮助中心。阶段 K 以 `665d249` 为基线完成后续用户功能补录：
新增 Python 策略、Factor 发布与四类研究方法、多资产归因、组合风险和信号血缘 9 篇中英文正文，
帮助中心扩展到 75 篇；新增 17 张真实功能标注图、TypeScript／Python 代码高亮与同页切换，并由
产品专项 E2E 和文档站全量 E2E 验收。数据同步、迁移和部署实现不进入用户操作正文；商品
Carry／仓单、宏观最新值和风险研究继续保留其研究边界。阶段 H 继续暂缓。
