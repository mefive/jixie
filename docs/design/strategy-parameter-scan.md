# 策略参数稳健性扫描与成本透明化

> 2026-07-28 制定并执行。对应原 ROADMAP 1.1 与 1.2，当前归入已完成基础 B。

## 目标

本轮把已有但不可见的滑点模型变成可对账的回测口径，并给 code-first 策略增加一套不改写源码的
可调参数声明。在同一份冻结代码、成本和数据区间上串行运行一维或二维参数网格，同时可选地把每组
参数分别跑样本内与样本外区间，用邻域稳定性而不是单点最优判断策略。

## 边界

- 普通稳健性扫描支持有限数值与非空字符串参数，一次扫描一至两个同类型参数，组合最多 25 组。
- 仓位方案视图只扫描一个字符串参数、2~5 个方案，不允许样本切分；每格额外保存从 1 起步的净值，
  用于多方案叠画，并计算年化波动率与最长水下交易日。
- 容量视图扫描保留维度 `initialCash`，支持 3~7 个、1 万至 100 亿元的资金档位，不要求策略声明
  参数，也不允许样本切分；它复用同一份代码、日期和成本模型，仅替换每格的初始资金。
- 调度 worker 串行启动独立 OS 子进程，每个参数组合退出后再跑下一组，不并发打 SQLite。
- 样本切分是可选的单个交易日边界，不做 walk-forward、自动调参或贝叶斯优化。
- 扫描不修改策略代码、默认参数、`Strategy.lastResult` 或普通回测历史。
- 报告保存每组摘要，不保存每组完整成交；仅仓位方案额外保存归一净值。
- 每日信号不进入扫描实验。

## 滑点口径

`CostConfig` 补齐股票/ETF 的 `slippageBps` 与 `impactCoef`，普通回测结果冻结实际采用的完整成本
快照。每笔成交新增可选 `slippageCost`：

- 股票/ETF：`abs(fillPrice - openBeforeSlippage) × shares`；
- 期货：`futureSlippageTicks × tickSize × contracts × multiplier`。

结果新增 `totalFees` 与 `totalSlippage`。旧结果没有这些字段时继续可读，前端显示为不可用，而不是
拿当前默认值倒推历史。

## 可调参数声明

策略在 `defineStrategy` 中声明当前默认值：

```ts
export default defineStrategy({
  params: {
    lookback: 20,
    topFraction: 0.1,
  },
  onBar(ctx) {
    const movingAverage = ctx.sma('510300.SH', ctx.params.lookback);
  },
});
```

`defineStrategy` 用泛型把 `params` 的键和值推导到 `ctx.params`（字面量会拓宽为 number/string，
使分类分支可比较）。扫描请求只传同类型覆盖值；运行前由墙内
加载器把覆盖值合并到声明值。服务端拒绝未知键、非有限数值和没有声明参数的扫描。这样不做源码
字符串替换，也不产生代码与扫描值不同步的第二份策略表示。

## ScanSpec

```ts
interface StrategyScanSpec {
  dimensions: Array<{ key: string; values: Array<number | string> }>; // one or two
  splitDate?: TradeDate; // absent = full-sample only
  view?: 'parameters' | 'sizing' | 'capacity';
}
```

普通参数与仓位方案值保持用户顺序但去重;容量资金档位去重后按升序保存。总组合数不得超过 25。
若有 `splitDate`：

- 样本内：`config.start … splitDate`；
- 样本外：交易日历中 `splitDate` 的下一开市日 … `config.end`。

两个区间分别创建全新的引擎运行，不共享策略闭包或账户状态。

## 持久化

新增不可变 `StrategyScanReport`：

- owner 与 strategy 关联；
- 冻结 `BacktestConfig`、`StrategyScanSpec`、代码 hash 和数据截止日；
- 保存 `running | done | error | stale`、错误、摘要 payload；
- 一对一关联 `Job`，刷新可续接，进程重启时与普通后台任务一起标 stale。

同一策略只允许一个 running scan。完成报告不做相同输入缓存命中：每次显式扫描都是一条研究记录。
删除策略级联删除其扫描报告。

每组只保存参数和两段可选摘要：总/年化/超额收益、Sharpe、最大回撤、信息比率、Calmar、胜率、
Profit Factor、换手、成交数、期末权益、显性费用与滑点。容量摘要额外保存
`年化滑点损耗 = totalSlippage / initialCash × 252 / 回测交易日数`。完整成交仅通过普通回测生成。

## API 与 UI

- `POST /api/app/strategy/scans?strategyId=…`：冻结当前编辑器 config 并创建报告/Job。
- `POST /api/app/strategies/scan-parameters/inspect`：通过 TypeScript AST 静态读取当前代码声明的有限数值/字符串参数，不启动 sandbox 或执行用户代码。
- `GET /api/app/strategy/scans/running?strategyId=…`：恢复运行中任务。
- `GET /api/app/strategy/scans/:reportId`：报告详情与结果。
- `GET /api/app/strategy/scans/:reportId/job?since=…`：轮询日志。
- `GET /api/app/strategy/scans?strategyId=…`：历史摘要。

Lab 的 Run 参数弹层增加成本参数与“参数扫描”入口。扫描弹层从当前代码的 AST 静态声明读取参数，
选择一或二维、填写值与可选切分日期。结果在 Lab 内展示：

- 一维：逐参数表格与指标折线；
- 二维：指标热力图；
- 有切分：样本内/样本外指标并排，颜色不把单点“最优”包装成推荐。
- 仓位方案：归一化净值叠画 + 年化收益/波动、最大回撤、最长水下期、Sharpe 对照表。
- 容量测算：初始资金—年化收益/滑点损耗曲线 + 小资金基准、滑点年损耗 1%、收益减半三个阈值卡片。

## 验收

1. 同参数扫描摘要与独立普通回测逐位一致。
2. 逐笔 `fee` / `slippageCost` 加总等于结果汇总；股票、ETF、期货均有单测。
3. 一/二维笛卡尔积、25 组上限、未知参数、非法切分日期有确定性单测。
4. 扫描不覆盖 `Strategy.lastResult`；相同 spec 再跑会生成新报告。
5. 刷新能恢复 running job；进程重启后遗留报告变 stale。
6. 无 `params` 的旧策略普通回测结果不变。
7. API 单测、墙内/直跑一致性、typecheck、build 与中英文浏览器 E2E 通过。
8. 容量扫描不把 `initialCash` 传入策略参数覆盖，且无 `params` 的策略也能运行容量网格。

2026-07-28 实际验收补充：真实 Lab 二维 2×2 扫描连续运行三轮均通过；每轮生成四格不可变报告，
且普通回测快照保持为空。扫描 cell 使用独立 OS 子进程，隔离虚拟机与 Prisma 连接随 cell 退出完整
回收。

2026-07-31 容量测算补充：同一 E2E 策略连续完成参数 4 格、仓位 3 格、容量 3 格扫描；容量报告
冻结每格初始资金与年化滑点损耗，页面展示收益衰减曲线、三个阈值卡片和逐档明细，扫描结束后临时
策略与工作进程均清理。

## 2026-09-24 静态参数识别调整（引用检查修订已审阅并验证）

表单识别与扫描提交共用 `strategy/scans/inspect-parameters.ts`，不再使用 runtime metadata 获取参数。
使用现有 TypeScript Compiler API；API 的 TypeScript 依赖移到生产依赖，版本不变。
支持默认导出的 `defineStrategy` 内联对象、直接对象，以及仅用于默认导出的顶层 const 策略。
params 缺省返回空对象；固定键和有限数值／非空字符串字面量可识别，动态表达式、调用、展开等明确拒绝。
具体写法与兼容性说明已同步中英帮助；Signals／Agent metadata 检查和实际回测／扫描 runtime 校验不变。

新增 AST 解析与真实 HTTP 参数识别测试，覆盖语法、值类型、动态拒绝、双语错误与禁止 runtime 加载。
本次按 review-gated-development 先交付静态检查，行为验证在代码审阅通过后执行；不提交或推送 Git。

静态验证：根级 `pnpm typecheck` 通过（含后端边界扫描、SDK 生成物一致性、sandbox 工具与全部 workspace 类型检查）；变更 TS/JSON 文件的 Prettier 检查及定向 ESLint 通过，`git diff --check` 通过。
审阅后计划运行：新增 `scans/inspect-parameters.test.ts`、`routes/scan-parameters.test.ts`，现有 `routes/index.integration.test.ts`、`scans/scan.test.ts`、`runtime/typescript/params.test.ts`、`runtime/typescript/typescript-strategy-runtime.test.ts`、`runtime/typescript/isolation.test.ts` 与 `sdk/contract.test.ts`，以及 `pnpm check:backend-boundaries` 的检查器自测。

补充全仓 `pnpm lint` 时扫描进入本地 `.venv` 第三方 Notebook 静态代码，已主动终止，不计为通过；本次变更文件的定向 ESLint 已通过。

代码审阅通过后的实际验证：上述 8 个 API 测试文件全部通过，共 136 个用例；其中静态参数识别 63 个、真实参数识别 HTTP 5 个、Strategy 路由集成 29 个、扫描算法 6 个、参数覆盖 3 个、TypeScript runtime 11 个、隔离 10 个、SDK 契约 9 个。`pnpm check:backend-boundaries` 的 30 个检查器自测全部通过，后端扫描 0 违规。无需修改产品代码或测试。测试进程均已退出，路由集成测试的清理钩子关闭临时数据库并删除临时目录；未启动 API/Web 服务。最终 `git diff --check` 通过。遵照用户要求，所有改动保持未提交，未推送。

### 引用检查修订（已审阅并验证）

提交评估发现：按标识符文本检查会将同名参数键和回调局部变量误判为导出策略的引用。
修订使用仅含策略源码与 SDK 工厂声明的内存 TypeScript Program，通过符号绑定区分引用；
不读取文件系统、不解析外部导入、不加载标准库、不生成或执行代码。语法诊断也由该 Program 提供，移除重复转译。
对象简写和命名导出显式解析其引用目标，避免修复误报时漏掉真正的对象逃逸；SDK 工厂检查同样使用符号身份。
补充同名属性、局部变量、函数参数、解构、真实引用、简写逃逸、导出别名及工厂替换测试，并更新中英帮助。
此前 136 个用例通过是首版结果，不代表本次修订已完成行为验证。修订通过人工代码审阅后再运行相关测试；仍不提交或推送。

本次修订静态检查已通过：根级 `pnpm typecheck`（含后端边界与生成物一致性）、修改文件 ESLint/Prettier 和 `git diff --check`。新增 22 个引用绑定回归用例，尚未执行；待本次产品代码审阅后，重跑原定 8 个测试文件。

引用检查修订经用户审阅通过后的验证：原定 8 个测试文件全部通过，共 158 个用例；静态参数识别从 63 个增加到 85 个，新增 22 个符号绑定回归用例全部通过。HTTP、扫描、SDK、参数覆盖、sandbox 运行及隔离回归均通过；后端边界检查器 30 个自测通过，扫描 0 违规。无需追加产品或测试修复。测试进程正常退出，未启动常驻服务；最终差异检查通过。改动仍未提交、未推送。
