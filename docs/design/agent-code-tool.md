# 设计:agent 沙盒计算工具 analyzeData(SQL 取数 → 代码变换)

> 2026-07-07 用户拍板立项(对话式统计分析的「逃生舱」:SQL 表达不了的中等复杂统计,
> 由模型写一小段 JS 在沙盒里算)。**当日实施完成**,实况见 ROADMAP 7.7;本文保留为设计依据。
> 与设计的偏差:超时定 10s(含 dev 下 worker tsx 启动 ~300ms);说明书生成采用
> 「gen 脚本物化 + vitest 防漂移」而非运行时解析(prod dist 无源码)。

## 一句话

一个工具 = 「命名 SQL 取数 + 一段 JS 变换代码」打包执行:数据在服务端从只读 SQL 流进沙盒,
算完只把**结果**(不是数据)回给模型——数据全程不经过 LLM 上下文,和 renderChart 同一条铁律。

## 为什么是这个形态

- SQLite 的真实边界:无 stddev/相关/回归内置,多步流水线(先算 A 再用 A 算 B)在单条 SQL 里
  复杂度爆炸、模型易错。SQL 管关系代数,代码管数值计算——各归其位。
- **不做**「模型先 sqlQuery 拉数、再把数据贴进代码」:数据过模型 = token 爆炸 + 幻觉面 +
  截断失真。取数和计算必须绑在同一次工具调用里,服务端内部传递。
- 语言 = JS(不是 Python):沙盒/编译/修复环基建现成(compileFactor 同款),零新运行时;
  Python 结论见 `python-and-sandbox.md`(已拍板不做平行线)。

## 工具契约

```ts
analyzeData({
  queries: [{ name: string, sql: string }],  // ≤4 条,逐条走 prepareReadOnlySql 守卫,
                                             // 行数上限 10000/条(数据不进模型,可以比 sqlQuery 大)
  code: string,                              // JS 模块:export default ({ data, stats }) => 结果
  purpose: string,                           // 一句话说明算什么(toolTrace 展示用)
})
```

- `data.<name>` = 对应 SQL 的结果行数组(`Record<string, number|string|null>[]`)。
- 返回值要求 JSON 可序列化;observation = `JSON.stringify(结果)` 截断到 ~8KB
  (超限报错回灌:「请在代码里聚合,别返回明细」)。
- 代码抛错 / 编译失败 → 人类可读错误回灌,模型自修(与编译修复环同哲学)。

## 沙盒(复用既有决策,见 python-and-sandbox.md 问题二)

- esbuild transform 剥类型 + `new Function` 注入白名单标识符(`data`、`stats`、`console`,
  `require` 封死)——与 compileFactor 完全同款。
- 执行在**独立 worker 线程**(仿 sql-worker):超时 5s `terminate` 硬杀 + `resourceLimits`
  内存上限 256MB。顺手把 python-and-sandbox 里「worker 加固」的建议在这条新路径上先落地。
- 无网络无文件系统可触达(沙盒里本来就没有 fetch/fs 的注入)。

## 库的选择(用户问「npm 有现成统计库吧」)

| 层 | 内容 | 决定 |
|---|---|---|
| 第一层(v1,零新依赖) | **自家 `lib/stats.ts`**:mean/std/pearson/spearman/winsorize/quantileBuckets/sharpe/annualizedReturn/maxDrawdown/navFromReturns——因子分析线在用、有单测、量化语义对口 | 注入为 `stats.*`,v1 只给这个 |
| 第二层(需求拉动) | **simple-statistics**(纯 JS 零依赖,社区标准):线性回归、分位数、t 检验、直方分箱等描述统计全家桶 | 撞到 stats.ts 不够的真实用例再加,加时并入 `stats.*` 命名空间 |
| 不引 | mathjs(太重)、jstat(年久)、danfojs(JS 版 pandas,重且不成熟——关系变换本就归 SQL,不需要 DataFrame) | — |

npm 生态结论:描述统计/回归有成熟纯 JS 库(simple-statistics 是事实标准),但**没有值得用的
pandas 等价物**——这恰好不是问题,因为 SQL 已经承担了 join/group/窗口这部分。

## Prompt 要点(工具 description)

- 何时用:sqlQuery/renderChart 算不动的——相关性、回归、波动率、多步骤衍生计算;
- 何时不用:简单聚合(sqlQuery 就够)、IC/分层因子检验(去因子页管道)、回测(去实验室);
- 附 1 个完整示例:两指数相关性 = 两条 query 按日期对齐 + `stats.pearson`;
- 提醒:返回聚合结果不返回明细;`data` 里日期是 'YYYYMMDD' 字符串。

## 边界(定死)

- **只读、无副作用**:代码拿不到 prisma/网络/文件,只有注入的 data 和 stats;
- **结果不落库、不产卡片**(v1):observation 回灌 → 模型文字作答。**图表仍归 renderChart**;
  「用算出来的数据画图」已立项为 ROADMAP **7.8**,详设见 `docs/design/computed-chart.md`
  (Phase A:ChartSpec `source:'compute'` + 重跑端点);
- 工具轮数仍在每 turn ≤5 的总预算内,不单独开小灶。

## 验收

- mock 单测:多 query 注入、代码错误回灌、超时杀线程、结果超限报错;
- 真库冒烟:「沪深300 和中证1000 最近一年相关性多少」——模型一次 analyzeData 调用得出
  相关系数,数字与 stats.pearson 手算一致;
- e2e:对话问一个 SQL 答不了的统计问题 → 文字结论落地,截图验收。

## 工作量

约 1~1.5 人日:worker 沙盒(抄 sql-worker + compileFactor 各半)0.5 + 工具与 prompt 0.25 +
测试冒烟 e2e 0.5。
