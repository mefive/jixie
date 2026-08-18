# 设计：响应式量化研究工作台

> 2026-08-17 产品决策。本文定义当前“主线一”的新产品表面，取代
> `natural-language-quant-research.md` 中“聊天 + 四种协议就是完整研究入口”和“不建设自由 Cell”的旧假设。
> 已完成的 Research 协议、语义目录、`ResearchStudy` / `ResearchRun`、运行指纹、失败尝试和 Curator
> 不废弃，而是作为新工作台的验证与审计基础继续复用。

> **实施状态（2026-08-18）**：jixie-native 的首个垂直切片已经完成并通过真实浏览器验收。当前覆盖持久化
> 研究文档、三类 Cell、独立 Python runtime、AST 依赖与 stale 传播、平台时序取数、表格、Matplotlib、
> 结构化 ECharts、静态 Research SDK Contract、Monaco 参数与返回列补全、Pyright 跨 Cell 语言服务、可搜索数据目录、
> 目录驱动的标的/指标补全与代码插入、受影响 Cell 拓扑批量运行、干净全文运行和 Validation → `ResearchRun`。
> Agent 受审计修改 Cell、完整执行比较以及 Factor / Strategy 带血缘交接仍是后续里程碑，
> 因此本文的“首版完成定义”尚未全部关闭。

## 1. 产品判断

jixie 面向愿意学习或已经掌握基础 Python、pandas 和统计学的个人量化研究者。Agent 用来降低取数、编码、
排错和方法选择成本，但不能以固定表单或聊天结果代替研究者的表达能力。

工作台不是 Jupyter 的外部 SDK，也不引入 Jupyter 作为产品或运行时。它是在 jixie Research 页面内建设的
量化研究文档：用户、Agent、平台数据、Python 计算、交互图表、正式验证和研究血缘共处于同一研究对象。

参考 [marimo](https://docs.marimo.io/) 的响应式数据流思想，但首版不直接把 marimo 编辑器或服务嵌入产品：

- 通过 Cell 的变量定义与引用构建依赖 DAG；
- 上游变化时将下游标为 `stale`，避免旧输出伪装成当前结果；
- 量化计算默认使用 lazy 模式，不因一次编辑自动触发昂贵数据请求、模型或回测；
- 正式固化必须在干净运行时中按依赖顺序完整执行；
- 是否直接采用 marimo 代码，只能在短期 PoC 验证数据桥、Agent、持久化、WebSocket 与沙箱边界后决定。

一句话定义：**Research 负责自由提出、探索和复查问题；Factor 负责把预测规律固化成信号资产；Strategy
负责把信号、规则和约束变成仓位与交易。**

## 2. 产品边界与三类研究去向

Research 是横向研究环境，不是所有产物都必须进入交易链路：

```text
                        ┌→ 保留为研究结论 / 风险认知
研究问题 → Research ───┼→ Factor 草稿 → 正式报告 → Holdout → 发布
                        └→ Strategy 草稿 → 回测

Published Factor → Strategy → Backtest / SignalRun
                         ↑              │
                         └── Research 复盘与归因 ←┘
```

- 通用关系、数据质量、风险、归因和市场状态研究可以停留在 Research；
- 能在 `asOfDate × asset` 上产生确定性预测值的候选，才允许提取为 Factor 草稿；
- 均线、再平衡、风险预算等规则型想法可以直接形成 Strategy 草稿，不强迫伪装成 Factor；
- 已发布 Factor 不直接决定仓位，Strategy 负责组合、约束、调仓、成本和成交；
- FactorReport、BacktestRun 和交易明细可以作为只读输入重新进入 Research，但不能反向改写冻结产物。

三者共享资产身份、Universe、交易日历、PIT、复权、币种、单位、数据截止日和指纹语义；不共享同一组
无限制 API：Research 可以批量读取历史并返回 DataFrame，Factor 只能读取声明过且当时可得的输入，Strategy
只能读取当前决策日及之前的数据并拥有持仓和订单能力。

## 3. 信息架构

Research 页面从“聊天记录”转成“研究文档”，Agent 成为可折叠的协作者：

```text
┌ 研究标题 │ 数据截止日 │ Runtime │ 运行受影响 │ 完整验证 ┐
├────────────┬──────────────────────────┬──────────────┤
│ 数据与变量  │ 研究文档                  │ Research Agent│
│            │                           │              │
│ 搜索数据    │ [Markdown：假设与口径]    │ 插入/修改 Cell│
│ Universe   │ [Python]             ▶   │ 解释与排错    │
│ 数据覆盖    │ [表格 / 图表输出]         │ 方法审查      │
│ 已用变量    │ [Validation]         ▶   │ 总结与提升    │
└────────────┴──────────────────────────┴──────────────┘
```

左侧数据目录不直接查询数据库。它通过 Research 语义目录展示稳定对象、字段、单位、频率、覆盖、PIT、revision
和使用限制，并把受支持的取数代码插入 Python Cell。右侧 Agent 操作的是同一份文档，不另行生成不可追踪的
“聊天版研究”。当前窄屏兼容的首版先从工作区工具栏打开数据目录抽屉；当覆盖、已用变量和 Universe 管理进入
同一阶段后，再把它演进为图中的常驻左栏，而不是提前挤压研究文档宽度。

## 4. Cell 与响应式执行

### 4.1 首版 Cell

首版只有三种可编辑 Cell：

1. `markdown`：假设、口径、过程、结论和限制；
2. `python`：平台数据、pandas、NumPy、SciPy、statsmodels、scikit-learn 与绘图；
3. `validation`：调用版本化 Research 协议，产生受审计的结构化结果和 `ResearchRun`。

表格、图表、文本和异常都是 Cell 输出，不再发明独立的“图表 Cell”。后续交互参数若进入产品，应是带稳定
值和类型的输入控件，并进入执行 spec 与指纹；首版不引入任意 widget 系统。

### 4.2 DAG 与状态

Python Cell 保存源码后，由 Python AST 分析其全局变量 definitions / references，构建 Cell DAG。首版规则：

- 一个全局变量只能由一个 Cell 定义；重复定义和循环依赖在执行前报错；
- 以下划线开头的临时变量可以保留为 Cell 局部约定，具体隔离方式在 runtime spike 中验证；
- 修改或删除上游 Cell 后，下游输出立即标记 `stale`；
- Python 无法可靠感知 `df["x"] = ...`、`list.append(...)` 等对象内部变异，帮助与 Agent 应鼓励
  `raw → clean → returns` 这样的不可变式命名；
- 页面顺序服务于叙事，执行顺序由依赖图决定；
- 默认不自动执行昂贵后代，只提供“运行当前”“运行受影响”“完整验证”。

“运行受影响”以当前 Cell 为起点，执行当前 Cell 与全部传递下游，排除无关分支，并用稳定拓扑序而不是页面顺序
串行运行。开始前会将已有输出的受影响下游标记 `stale`；某个 Cell 失败后，只跳过依赖该失败结果的后代，其他
分支继续执行。受影响分支存在重复定义或循环依赖时，在执行任何 Cell 前整体拒绝并返回明确错误。

Cell 状态统一为：

```ts
type ResearchCellState =
  | 'idle'
  | 'running'
  | 'success'
  | 'stale'
  | 'error';
```

`success` 只表示源码和当前输出一致，不表示统计方法正确；`validation` 成功且所属完整执行已经固化后，才可以
显示“已验证”徽标。

## 5. Research Runtime API 与 Factor / Strategy 的交集

Research 中仍需要一组 Python API，但它是平台内置运行时，不是要求用户安装的外部 SDK。当前首个取数契约是：

```python
monthly = data.series(
    "index",
    "000300.SH",
    start="20200101",
    end="20251231",
    measure="market.adjusted_close",
    frequency="monthly",
    transform="simple_return",
)
```

其静态返回结构是 `date: datetime64[ns]` 与 `value: float64`。用户写下赋值语句后，Monaco 无需执行 Cell
即可从 SDK Contract 推导 `monthly["date"]`、`monthly["value"]` 以及 `charts.*` 的 `x` / `y` 字段候选。
首版只承诺直接 SDK 返回值的静态 schema，不推导任意 pandas `rename` / `merge` 之后的动态结构，也不依赖
执行后观察值来提供基础补全。

### 5.1 Prisma、公开契约与生成边界

Prisma schema 是内部存储事实，Research SDK Contract 是研究员可依赖的公开事实。公开契约由底层数据能力
封装而来，但不能直接镜像 Prisma model：数据库字段、关系、`Decimal` 和内部命名可能变化，`data.series()`
还会完成字段选择、日期转换、频率聚合与变换，最终稳定输出的是 `date + value`。

```text
Prisma schema / loaders
        ↓ 显式服务映射
Research SDK Contract（唯一公开真相源）
        ├─ API 请求与返回校验
        ├─ Monaco 签名、枚举和 DataFrame 列补全
        ├─ 生成 Python .pyi
        └─ Python runtime 签名一致性测试
```

具体同步机制：

- 开发者只修改 `packages/shared/src/research-sdk-contract.ts` 中的公开参数、枚举和返回列；
- `pnpm gen:research-sdk` 从该契约生成 `apps/sandboxd/python/jixie_research_sdk.pyi`，不手工维护生成物；
- `pnpm check:research-sdk` 以只读方式比较生成结果，根级 `build` 与 `typecheck` 均先执行该检查；
- API 数据桥直接从同一契约构造请求枚举与返回列校验，额外测试 Python runtime 的真实参数名与契约一致；
- Prisma migration 如果只是内部重构，不改变公开 SDK，就不更新 Contract；如果服务映射或公开返回发生变化，
  类型检查、契约测试或生成物检查必须失败，迫使开发者显式决定是否升级 Contract。

不把 Git hook 作为正确性的唯一保障。hook 可以做本地快速反馈，但可能被跳过；可复现的生成命令、根级检查和
测试才是合并与部署时的可靠门禁。

### 5.2 Python 语言服务

研究编辑器使用 Monaco，但语言语义不靠正则模拟。API 常驻 Pyright language server，并把同一研究文档中按顺序
排列的 Python Cell 组合成一个虚拟 Python module；每次请求再把位置、诊断和 workspace edit 映射回原 Cell。
因此无需执行 Cell 即可获得：

- Python、平台 SDK 与固定 runtime 库的语义补全、hover 和 signature help；
- 未定义变量、参数和属性错误等静态诊断；
- 跨 Cell go to definition、references 和 rename；
- `data.series()` 直接返回列的 Contract 精确补全。

Pyright workspace 使用生成的 `jixie_research_sdk.pyi`，并随 `research-py-v1` 提供 pandas、NumPy 与 Matplotlib
常用研究接口的静态 stub。SDK stub 和沙箱生成物复用同一 renderer，避免两套签名漂移。DataFrame 任意
`rename` / `merge` 之后的列名仍不做虚假推断；这是静态类型边界，不通过“先执行一次再观察对象”改变。

首阶段不包含 debugger、终端、文件树、运行时 `pip install`、Jupyter 扩展协议或第三方包的无限类型覆盖。这些
属于 IDE / 环境管理能力，不应和当前的 Python language service 混成一个里程碑。

### 5.3 数据目录与编辑器补全

数据目录不是 Prisma 表浏览器。API 从相同的证券主数据、跨市场 benchmark 登记和 Research Measure Catalog
构造稳定的 `asset_type + identifier + measure` 组合：用户搜索中文名、英文名或代码，选择研究区间、频率和变换，
平台只生成现有 `data.series()` 调用并插入当前或最近聚焦的 Python Cell，不创造另一条取数路径。

Monaco 的 `identifier="..."` 与 `measure="..."` 补全调用同一个目录接口。标的候选按资产类别过滤；指标候选先按
Measure Catalog 的 `assetTypes` 过滤，再使用具体标的的 `compatibleMeasureIds` 收窄。例如普通境内指数不能误选
只对登记跨市场 benchmark 有效的 `market.cny_close`。搜索结果、抽屉代码生成与编辑器补全因此共享同一组稳定
标识，而不是在前端各自维护代码常量。

调用经宿主数据桥进入现有语义目录和确定性 loader；容器不持有数据库凭证，不挂载数据库，也不开放网络。
每次调用记录稳定数据引用、参数、覆盖、revision、available date、返回摘要和指纹。

共享的是底层数据与计算语义，不是相同调用形态：

| 能力 | Research Runtime | Factor Runtime | Strategy Runtime |
|---|---|---|---|
| 历史数据 | 任意合规区间，批量 DataFrame | 仅声明输入，逐时点 PIT | 当前决策日及以前 |
| Universe | 历史快照与面板 | 冻结适用范围 | 当前可交易候选池 |
| 自由 Python | 允许，沙箱内 | 不允许任意副作用 | 只允许策略模块契约 |
| 绘图与表格 | 允许 | 标准报告负责 | 标准回测结果负责 |
| Published Factor | 可分析和比较 | 自身产出 | 只读消费稳定 key |
| 持仓与订单 | 不允许 | 不允许 | 允许 |

从 Research 提取 Factor 时，只带入选中 Cell 的候选公式、字段依赖、Universe、预测期限、预期方向、来源
ResearchExecution 和未解决限制；进入 Factor 页面后仍须满足定义校验、正式报告、Explore / Holdout 与发布纪律。
从 Research 创建 Strategy 时带入规则、资产范围、调仓和来源执行，但必须在 Strategy Lab 中补齐仓位、成本、
成交与风险约束并重新回测。

## 6. Research 协议究竟是什么

协议既不是“固化的一段研究代码”，也不是“UI 定制出来的一张报告”。它是一个**版本化的端到端验证契约**：

```ts
interface ResearchProtocolDefinition {
  id: string;
  version: number;
  inputSchema: unknown;
  parameterSchema: unknown;
  preconditions: unknown[];
  executor: string;
  resultSchema: unknown;
  diagnostics: unknown[];
  conclusionRules: unknown[];
  renderers: unknown[];
  helpSlugs: string[];
}
```

它至少包含六层：

1. **输入契约**：允许哪些序列、Universe、事件、单位、频率和时间语义；
2. **参数与前置条件**：样本量、滞后、基准、异常值、显著性和不可静默改变的默认值；
3. **确定性执行器**：当前可以是经过测试的 TypeScript 实现，未来也可以是冻结 Python 实现；语言不是身份；
4. **诊断与结论规则**：不能由 UI 或 LLM 临时解释出不存在的证据；
5. **结果 schema**：点估计、区间、效应量、稳定性、失败方式和数据摘要；
6. **渲染说明**：同一结构化结果可以在 Validation Cell、详情页、对比页和导出报告中使用。

因此 UI 只是协议结果的一种投影。时间序列关系协议可以生成散点图、滚动系数图和诊断表，但这些图不是协议
本体；删除某张图不应改变统计结果，修改执行器或结论规则则必须升级协议或实现指纹。

报告 UI 默认由可复用 block 组合，而不是每增加一个协议就手写一整张页面：`metric`、`table`、`chart`、
`diagnostic`、`formula`、`limitation` 和 `narrative` block 从结构化结果取值。只有事件路径、偏回归等确实具有
特殊交互语义的结果才增加专用 block；专用 block 仍不得重新计算统计结果。

Python Cell 中的任意研究代码有三个证据等级：

- **探索输出**：当前会话执行结果，允许快速迭代；
- **可复现输出**：在干净 runtime 完整执行成功，冻结源码、输入和环境；
- **验证结果**：经过登记协议产生的结构化 `ResearchRun`。

可复现不等于方法正确，验证也不等于具有投资价值。Factor 与 Strategy 仍负责预测和可交易性证据。

## 7. 图表与富输出

### 7.1 一般 Notebook 平台怎样处理图表

Python 本身不“返回一张图”。绘图库产生不同类型的富输出：

- Matplotlib / Seaborn 通常由后端生成 PNG 或 SVG；
- Plotly、Altair、Bokeh 通常生成结构化 JSON / Vega spec 或受控 HTML/JavaScript，由浏览器交互渲染；
- DataFrame 由平台识别并渲染为表格或数据网格；
- Notebook 运行时负责捕获这些输出，编辑器负责展示。

完整 Jupyter 或 marimo 可以支持大量第三方 display protocol，但 jixie 首版不需要照搬全部兼容层。

### 7.2 jixie 采用双轨图表

#### 轨道 A：自由 Python 绘图

```python
returns.plot(figsize=(12, 5))
```

- Matplotlib 使用无窗口 Agg 后端；
- Cell 结束时捕获尚未关闭的 figure，输出 PNG；验证 SVG 的字体、体积和安全边界后可同时支持 SVG；
- 适合任意第三方统计图、论文复现和用户快速表达；
- 固化时保存图片 artifact、源码、数据指纹和环境，不把图片当作唯一事实来源；
- 静态图不提供原生 tooltip、缩放和图例联动，这是自由度换来的明确取舍。

#### 轨道 B：jixie 原生交互图

```python
charts.line(
    returns,
    title="Monthly returns",
    x="date",
    series=["510300.SH", "510500.SH"],
)
```

`charts.*` 不在 Python 中生成像素或任意 ECharts option，而是返回受 schema 约束的 `ResearchChartSpec`：

```ts
interface ResearchChartOutput {
  kind: 'chart';
  spec: ResearchChartSpec;
  data: ResearchChartDataRef;
  dataFingerprint: string;
}
```

前端继续复用现有 ECharts shell，提供 tooltip、缩放、图例开关、区间选择、数据点日期和多序列联动。Agent
执行“画图”时优先产生这种交互图；用户直接调用 pandas / Matplotlib 时保留静态图。Validation Cell 的正式
图表全部使用结构化结果和原生 ChartSpec，不依赖截图。

首批原生 helper 只覆盖高频且语义稳定的图：

- `line` / `area`：时间序列、净值、回撤、滚动统计；
- `scatter`：关系、回归拟合和日期 tooltip；
- `histogram` / `boxplot`：分布；
- `heatmap`：相关矩阵；
- `event_path`：事件窗与置信带。

不允许 Python Cell 返回任意 HTML/JavaScript 直接进入主页面，避免 XSS、不可重放和无限依赖。Plotly 适配器
可以在真实需求出现后增加：Python 端只传 `fig.to_plotly_json()` 的白名单子集，前端是否引入 Plotly 需要另行
评估 bundle、主题、双语、导出和安全成本；它不阻塞首版。

### 7.3 表格与输出上限

Cell 输出统一为受控联合类型：

```ts
type ResearchCellOutput =
  | { kind: 'text'; text: string }
  | { kind: 'scalar'; value: string | number | boolean | null }
  | { kind: 'table'; schema: unknown; preview: unknown[]; dataRef?: string }
  | { kind: 'image'; mimeType: 'image/png' | 'image/svg+xml'; artifactId: string }
  | ResearchChartOutput
  | { kind: 'validation'; researchRunId: string }
  | { kind: 'error'; name: string; message: string; traceback?: string };
```

DataFrame 默认只把列 schema、统计摘要和有上限的 preview 送到浏览器；完整数据保留在 runtime 或受控 artifact，
避免把百万行 JSON 写进 Prisma 或 DOM。交互图的小型 series 可以随输出冻结，大型数据使用内容寻址 artifact
并记录 hash。正式报告不得只保存图片：必须保存产生图表的结构化结果或可重放引用。

## 8. Runtime、沙箱与持久化

复用现有 `jixie-sandboxd`、rootless Podman、固定镜像、无网络、只读根文件系统和 framed RPC，但新增独立
research runner，不在策略 runner 中堆积 Notebook 逻辑：

```text
Research page
  ⇅ Cell / output stream
API research session
  ⇅ framed RPC + typed data requests
jixie-sandboxd
  └─ research-py-v1 container
       ├─ persistent Python globals
       ├─ AST definitions/references
       ├─ pandas / numpy / scipy / statsmodels / sklearn
       ├─ matplotlib Agg
       └─ jixie data + charts bindings
```

建议领域对象：

```text
ResearchStudy
├─ ResearchDocument
│  └─ ResearchCell[]
├─ ResearchExecution[]
│  └─ ResearchCellOutput[] / artifacts / fingerprints
├─ ResearchRun[]                 # Validation Cell 的正式协议运行
└─ AgentConversation
```

- `ResearchDocument` 是可编辑当前态；
- `ResearchExecution` 冻结一次 DAG 源码、依赖、环境、输入和输出；
- `ResearchRun` 继续保存协议级正式结果，可以关联来源 Cell 与 Execution；
- 不持久化不可解释的 Python 内存状态；重新打开文档时必须重建 runtime；
- 只有全新容器完整执行成功且所有必要 Cell 非 stale，才允许固化“可复现执行”；
- 环境以 `research-py-v1` 等不可变版本标识，首版禁用用户运行时 `pip install`。

## 9. Agent 工具边界

Research Agent 至少需要：

- `readResearchDocument`
- `createResearchCell`
- `updateResearchCell`
- `deleteResearchCell`
- `executeResearchCell`
- `executeAffectedResearchCells`
- `validateResearchDocument`
- `searchResearchDataCatalog`
- `compareResearchExecutions`
- `proposeFactorDraft`
- `proposeStrategyDraft`

Agent 修改 Cell 必须显示 diff 或明确变更摘要，并进入对话 trace；Agent 发起的参数、模型和假设尝试同样进入
实验台账。Agent 不得自动揭示 Holdout、发布 Factor、部署 Strategy 或代表用户接受投资结论。

## 10. 分阶段实现

### M0：运行时 PoC 与架构门

- 用一个真实时间序列问题验证独立 research runner、共享状态、中断、重启、超时和资源回收；
- 同时做一次限时 marimo 嵌入 PoC，验证数据桥、Agent 操作、输出提取、同源代理和沙箱，不把 PoC 当正式依赖；
- 根据证据在“完整采用 marimo”与“jixie-native DAG/runtime”之间做最终工程选择。

### M1：研究文档框架

- `ResearchDocument` / `ResearchCell` CRUD 与自动保存；
- Markdown / Python Cell、AST DAG、重复定义、循环依赖、stale 状态；
- 单 Cell、受影响 Cell、重启和中断；
- 文本、异常、DataFrame preview、Matplotlib PNG。

### M2：平台数据与交互图

- 只读数据桥、语义目录插入、PIT/revision 和数据指纹；
- 静态 Research SDK Contract、生成/check、Monaco 参数与直接返回列补全；
- `charts.line/scatter/histogram/boxplot/heatmap/event_path`；
- ECharts 富交互、表格分页/虚拟化和 artifact 上限；
- Agent 增删改、执行和解释 Cell。

### M3：验证、固化与现有协议接线

- Validation Cell 接入现有四协议；
- 干净容器完整执行、`ResearchExecution`、输出 artifact 与环境指纹；
- `ResearchRun` 关联来源 Execution / Cell；
- 新旧运行、代码、数据、环境和结论差异比较。

### M4：Factor / Strategy / Backtest 闭环

- 提取 Factor 草稿并保留来源与未解决项；
- 创建 Strategy 草稿，不绕过 Lab 回测；
- Research 只读加载 FactorReport、BacktestRun、持仓和交易用于复盘；
- 已发布 Factor 和冻结回测不可被研究文档反向修改。

## 11. 方法与模板 backlog

先搭建框架，不用统计学目录阻塞 M0–M3。以下能力按真实研究问题、方法审计和数据准备逐项进入 Validation
协议或可复用模板：

- 横截面 IC、分层、衰减、换手、容量与因子冗余；
- Fama–MacBeth / Panel 回归；
- 平稳性、协整和误差修正；
- 滚动、扩展窗口和 Walk-forward；
- Bootstrap、参数稳定性和多重检验 / FDR；
- 组合收益、风险、因子和交易归因；
- 情景与压力测试；
- 回测成交、成本、容量和实际偏差诊断。

其中已在 FactorReport、组合风险或回测结果中存在的实现必须复用或抽取共同计算内核，不得在 Research 再造
一个口径不同的版本。

## 12. 当前不做

- 兼容 `.ipynb` 或实现 Jupyter Kernel protocol；
- 同时建设 jixie Cell UI 与一套独立 Notebook 页面；
- 完整终端、文件树、调试器、任意 Jupyter / marimo 扩展；
- 用户运行时安装任意包；
- 任意 HTML / JavaScript 输出；
- 自动重跑昂贵模型、回测或数据请求；
- 多人实时协作、GPU、分布式计算和高频 / Tick 研究；
- 自动批量挖因子、自动揭示 Holdout、自动发布或自动部署。

## 13. 首版完成定义

一个掌握基础 Python 的个人量化研究者可以在 jixie 内完成：

1. 创建带假设和数据截止日的研究文档；
2. 使用平台数据和 pandas 构造任意中等规模研究；
3. 获得表格、静态 Python 图和 jixie 原生交互图；
4. 修改上游后准确看到所有受影响结果变为 stale；
5. 由 Agent 读取、修改和执行同一份文档；
6. 用现有协议建立至少一个 Validation Cell；
7. 在干净环境完整执行并固化代码、数据、环境、图表和结果；
8. 将合格候选显式送往 Factor 或 Strategy，而不是复制粘贴且不丢失血缘。

首版成功不以覆盖全部统计方法为条件；成功标准是自由探索、正式验证和下游产品之间的边界清楚、运行可信、
结果可复现。
