# 设计：响应式量化研究工作台

> 2026-08-17 产品决策，2026-08-19 收敛 Cell 边界。本文是当前“主线一”的唯一产品设计依据。Research 只
> 保留 Markdown / Python 两类 Cell；数据目录、Universe、Python SDK、完整执行快照和 Curator 继续复用。

> **实施状态（2026-08-19）**：jixie-native 的首个垂直切片已经完成并通过真实浏览器验收。当前覆盖持久化
> 研究文档、两类 Cell、独立 Python runtime、AST 依赖与 stale 传播、平台时序取数、表格、Matplotlib、
> 结构化 ECharts、静态 Research SDK Contract、Monaco 参数与返回列补全、Pyright 跨 Cell 语言服务、可搜索数据目录、
> 目录驱动的标的/指标补全与代码插入、原生 line / scatter / histogram / boxplot / heatmap / event_path
> 交互图、受控大表分页/虚拟化与 1 MiB 预览预算、图片 artifact 按权限懒加载、输出硬上限、受影响 Cell
> 拓扑批量运行、运行中断、干净全文运行和
> 不可变完整运行快照、文档内运行历史、只读回看与显式封存。
> Agent 受审计增删改 Cell、用户授权的受控执行、精确结果解释和简版尝试比较已经完成；M3 以当前快照能力
> 收工，不把数据副本、自动执行归因、反向来源关联或全局档案作为首版阻塞项。M4 的首版交接闭环也已完成：
> 成功封存的 ResearchExecution 可经 LLM 语义门生成带来源、摘要与未解决项的 Factor / Strategy 草稿；二者
> 默认延续 Python 心智并使用 `py-v1`。Factor Python 已覆盖静态 SDK、受限运行时、横截面/时序/Panel、
> FactorReport、发布、Strategy 消费和 Monaco/Pyright；既有 TypeScript Factor 保持兼容。派生报告回流 Research
> 与不可变 BacktestReport 仍属于独立 backlog，不阻塞本文首版完成定义。Research → Factor 还会把快照中明确且
> 可表达的股票池、日期、频率、过滤条件、标的和事前方向保存为 FactorReport 建议参数；Factor 工作台只在草稿
> 尚无报告时预填并要求用户确认，不自动运行，也不把 Universe 写进 Factor 公式。

## 1. 产品判断

jixie 面向愿意学习或已经掌握基础 Python、pandas 和统计学的个人量化研究者。Agent 用来降低取数、编码、
排错和方法选择成本，但不能以固定表单或聊天结果代替研究者的表达能力。

工作台不是 Jupyter 的外部 SDK，也不引入 Jupyter 作为产品或运行时。它是在 jixie Research 页面内建设的
量化研究文档：用户、Agent、平台数据、Python 计算、交互图表、完整运行快照和研究血缘共处于同一研究对象。

参考 [marimo](https://docs.marimo.io/) 的响应式数据流思想，但首版不直接把 marimo 编辑器或服务嵌入产品：

- 通过 Cell 的变量定义与引用构建依赖 DAG；
- 上游变化时将下游标为 `stale`，避免旧输出伪装成当前结果；
- 量化计算默认使用 lazy 模式，不因一次编辑自动触发昂贵数据请求、模型或回测；
- 正式固化必须在干净运行时中按依赖顺序完整执行；
- 当前已选择 jixie-native DAG/runtime；marimo 只保留为交互思想参考，不再作为首版嵌入候选。

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
└────────────┴──────────────────────────┴──────────────┘
```

左侧数据目录不直接查询数据库。它通过 Research 语义目录展示稳定对象、字段、单位、频率、覆盖、PIT、revision
和使用限制，并把受支持的取数代码插入 Python Cell。右侧 Agent 操作的是同一份文档，不另行生成不可追踪的
“聊天版研究”。当前窄屏兼容的首版先从工作区工具栏打开数据目录抽屉；当覆盖、已用变量和 Universe 管理进入
同一阶段后，再把它演进为图中的常驻左栏，而不是提前挤压研究文档宽度。

## 4. Cell 与响应式执行

### 4.1 首版 Cell

首版只有两种可编辑 Cell：

1. `markdown`：假设、口径、过程、结论和限制；
2. `python`：平台数据、pandas、NumPy、SciPy、statsmodels、scikit-learn、诊断与绘图。

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
- 默认不自动执行昂贵后代，只提供“运行当前”“运行受影响”“干净运行全文”。

“运行受影响”以当前 Cell 为起点，执行当前 Cell 与全部传递下游，排除无关分支，并用稳定拓扑序而不是页面顺序
串行运行。开始前会将已有输出的受影响下游标记 `stale`；某个 Cell 失败后，只跳过依赖该失败结果的后代，其他
分支继续执行。受影响分支存在重复定义或循环依赖时，在执行任何 Cell 前整体拒绝并返回明确错误。

中断是文档级运行控制，不是只取消浏览器请求：当 Python Cell 正在执行时，宿主会终止该文档的 Python
session，并在下一次执行时创建全新 session，防止被中断代码留下不可知的内存状态。被中断 Cell 如果已有一次
成功输出，则回到 `stale` 并保留旧输出；从未成功执行过则回到 `idle`。本次不可变执行快照记为
`cancelled`，受影响运行和全文运行都停止调度后续 Cell。Markdown 是即时原子操作。

Cell 状态统一为：

```ts
type ResearchCellState =
  | 'idle'
  | 'running'
  | 'success'
  | 'stale'
  | 'error';
```

`success` 只表示源码和当前输出一致，不表示统计方法正确。完整运行快照冻结“当时运行了什么”，不会替用户判断方法或结论正确。

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

原生图表 API 当前覆盖 `charts.line / area / bar / scatter / histogram / boxplot / heatmap / event_path`。
`histogram` 在 runtime 内按有限数值和指定 bins 确定性分箱；`boxplot` 从原始值计算五数概括并支持可选分组；
`heatmap` 要求唯一的 x/y 坐标，相关矩阵等跨零数据使用以 0 为中心的发散色阶；`event_path` 同时标记 `t=0`
事件日和零收益线。它们都返回受 schema 约束的行式 artifact，由 ECharts 提供 tooltip、缩放、图例或色阶交互，
不把 Python 截图冒充平台交互图。

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
ResearchExecution 和未解决限制。其中公式进入可复用的 Factor 定义；Universe、日期、频率、过滤条件与方向进入
可审查的 FactorReport 建议参数。建议参数只在尚无报告的草稿中预填，用户确认后才运行；不能表达的研究口径列为
未解决项，不静默退回全 A 股等默认值。进入 Factor 页面后仍须满足定义校验、正式报告、Explore / Holdout 与发布纪律。
从 Research 创建 Strategy 时带入规则、资产范围、调仓和来源执行，但必须在 Strategy Lab 中补齐仓位、成本、
成交与风险约束并重新回测。

## 6. 统计方法、公式与证据层级

Research 不再维护固定统计流程或专用报告卡。统计方法直接存在于可读、可编辑、可运行的研究文档中：

- Markdown 写问题、事前假设、estimand、公式、变量定义、前提、判断标准和限制；
- Python 使用平台数据与成熟库实现计算、诊断、表格和图表；
- Agent 可以为初学者生成两者，但不能用自然语言宣称代码没有产生的数值或结论；
- 用户可以修改 Agent 代码、查看输出、重跑并让 Agent 基于精确输出解释。

“Agent 给出公式”本身不够。公式负责解释算什么，Python 源码负责证明实际怎么算，执行输出负责展示这次算出
什么，三者必须一致。高频方法可沉淀为 Markdown + Python 文档模板或经过测试的 Python helper，但模板不是新的
Cell 类型，也不拥有隐藏执行器或专用结果表。

Python Cell 输出只有两个证据等级：

- **探索输出**：单 Cell、受影响分支或 Agent 受控尝试的当前结果，适合快速迭代；
- **完整运行快照**：从干净 runtime 执行全文，冻结当时的源码、DAG、输出、artifact 和环境。

完整运行快照用于回看，不保存底层数据副本，也不等于统计方法正确或具有投资价值。用户需要复查时重新完整运行
并产生新快照；Factor 与 Strategy 继续负责预测纪律、样本外验证和可交易性证据。

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
- 固化时保存图片 artifact、源码和环境，不把图片当作唯一事实来源；
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
执行“画图”时优先产生这种交互图；用户直接调用 pandas / Matplotlib 时保留静态图。完整运行同时冻结图表 spec、数据预览或静态图片 artifact。

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
  | { kind: 'error'; name: string; message: string; traceback?: string };
```

DataFrame 与 list-of-records 默认只发送 200 行、64 列、最多 1 MiB 的受控 preview，单元格最多 256 字符；
返回契约同时记录原始行列数、实际 preview 字节数、具体上限及行、列、单元格、字节是否截断。前端每页默认显示
50 行并使用虚拟滚动，元信息明确写成
“预览行 / 总行”，不把 preview 冒充完整数据。完整对象仍留在当前 Python runtime；研究员可显式切片查看别的
区段，页面重开后若需要完整对象则按依赖重跑。首版不把百万行 JSON 写进 Prisma，也不为探索表格另造远程查询
接口。

输出上限必须显式失败或显示警告，不能静默截断统计口径：原生图最多接收 5,000 行，通用多序列图最多 20 条
series；Matplotlib 单张 PNG 最多 4 MiB；Python runtime 向 API 传输的整组原始输出最多 8 MiB。API 会在持久化前
剥离图片 base64，Cell / Execution 的内联 JSON 降为 2 MiB 上限；超限图表要求用户明确聚合或抽样，超限静态图要求
降低画布或 DPI。

图片作为所属 `ResearchCellExecution` 的不可变 `ResearchArtifact` BLOB 保存在 SQLite，Cell 当前输出与执行快照引用同一
artifact id，并保存 SHA-256、类型、字节数和可得的尺寸。前端只在图片进入视区时请求按用户与文档鉴权的读取接口，
响应可私有缓存但每次复用都必须携带 ETag 重新鉴权，不使用跨账号可直接命中的 `immutable` 缓存；旧版本已保存的内联 `dataUrl` 继续可读。本阶段保留原始 PNG，
不在前端转 WebP 或重压缩，避免让视觉
结果与执行产物不一致。只有当容量、备份或横向扩展数据证明 SQLite BLOB 不再合适时，才迁移到对象存储。跨会话查看完整大表或大型
series 仍等待真实需求，再增加独立内容寻址数据产物与按页读取接口。正式报告不得只保存图片：必须保存产生图表的结构化结果或可重放引用。

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
ResearchDocument
├─ ResearchCell[]                 # Markdown / Python
├─ ResearchExecution[]
│  └─ ResearchCellExecution[] / artifacts / fingerprints
└─ AgentConversation
```

- `ResearchDocument` 是可编辑当前态；
- `ResearchExecution` 冻结一次 DAG 源码、依赖、环境和输出；
- 不持久化不可解释的 Python 内存状态；重新打开文档时必须重建 runtime；
- 每次全新环境完整执行都进入运行历史，只有成功执行才允许显式封存为研究版本；
- 环境以 `research-py-v1` 等不可变版本标识，首版禁用用户运行时 `pip install`。

## 9. Agent 工具边界

Research Agent 至少需要：

- `readResearchDocument`
- `createResearchCell`
- `updateResearchCell`
- `deleteResearchCell`
- `executeResearchCell`
- `executeAffectedResearchCells`
- `runResearchDocument`
- `searchResearchDataCatalog`
- `proposeFactorDraft`
- `proposeStrategyDraft`

Agent 修改 Cell 必须显示 diff 或明确变更摘要，并进入对话 trace；Agent 发起的参数、模型和假设尝试同样进入
实验台账。Agent 不得自动揭示 Holdout、发布 Factor、部署 Strategy 或代表用户接受投资结论。

第一阶段不把 `createResearchCell` / `updateResearchCell` / `deleteResearchCell` 作为可立即写入的 Agent
工具，而是收敛为每轮最多一次 `proposeResearchCellChanges` 批量提案。服务端保存每个操作的完整
before/after 源码、行数、Cell revision、依赖定义与来源 AgentTurn/Message；前端以 Monaco
DiffEditor 只读审查，用户显式应用或拒绝。应用使用文档 `contentRevision`、Cell revision 与原源码三重检查；
任一条件变化即固化为 `conflicted`，不覆盖用户新内容。一个批次内的新建、修改、删除以同一
数据库事务原子落地，仅刷新 DAG/stale，不自动执行 Cell。

第三阶段把非删除提案演进为 Cursor 式开放变更会话。Agent Turn 完成后，前端先 `flushAll`，再把只含创建和
修改的提案原子写入当前文档并进入 `open` review；删除仍保留显式应用，避免未确认删除破坏 Cell 执行历史。
同一文档同一时间只有一个开放会话，后续 Agent Turn 必须读取当前已保存源码，并作为不可变 step 追加到该会话。
界面不堆叠多层 diff，而是按 Cell 显示“该 Cell 在本会话首次被触碰前的源码 → 当前最新源码”的聚合内联 diff；
每轮 before/after、AgentTurn/Message 来源仍单独保存，展示折叠不等于审计历史作废。

内联 DiffEditor 的 original model 只读，modified model 就是当前 Cell 草稿。用户修改 modified model 时继续走
既有文档级自动保存协调器；`dirty` 只表示尚未保存，和 `open / accepted / reverted` review 状态正交。Accept
先 `flushAll`，把用户最后保存的源码作为最终版本并关闭会话，本身不再写一份 Agent 原始 afterSource；Undo
则原子恢复各 Cell 第一次进入会话时的基线，并删除本会话创建且尚未运行的 Cell。开放 review 期间禁止运行、
新增或删除 Cell，但允许继续编辑和追问 Agent；这样回滚不会删除执行证据，也不会让 runtime 混入未确认源码。

Agent 生成期间若用户再次修改目标 Cell，应用前的 revision/contentRevision 校验必须冲突并停止，不能自动三方
合并 Python 语义。用户继续追问前同样先 `flushAll`，因此下一轮 Agent 获取的是前一轮 Agent 修改与用户调整后的
当前源码。会话 Accept 后，只有最后一个 step 承担整段会话的受控运行入口；运行基准更新为 Accept 时的最终
`contentRevision`，但每个 step 仍保留独立来源。

### 9.1 自动保存与内容修订

研究文档采用文档级自动保存协调器，不让每个 Cell 各自创建 timer：编辑器 `onChange` 立即用源码精确字符串
比较更新 `dirty`，协调器仅在存在 dirty Cell 时以 500ms tick 扫描。单个 Cell 停止输入 800ms 后保存；持续
输入最长 5s 也必须保存一次。一个文档同一时间只发送一个保存请求，后续变化合并进队列，避免失焦、运行和
多个 Cell 同时编辑造成乱序覆盖。

Cell 顶部将编辑保存状态与执行状态分开显示：`已保存 / 待保存 / 保存中 / 保存失败 / 保存冲突` 不复用
`idle / stale / running / success / error`。运行当前 Cell、运行受影响分支、运行全部、发送 Agent 消息、接受
Agent 变更、新增或删除 Cell、切换或新建文档前都先 `flushAll`；保存失败或冲突时阻止后续动作。失焦只作为
一次立即 flush 的加速器，不再是正确性的唯一保障。

每次 Cell 写入携带 `expectedRevision`，服务端原子校验后才增加 Cell revision；不匹配返回 409 并保留本地
草稿，不允许静默覆盖另一标签页或 Agent 的新内容。`ResearchDocument.contentRevision` 仅在源码、配置或 Cell
结构变化以及 Agent 提案应用时增加；运行状态、输出与 `updatedAt` 活动时间不增加它。Agent 提案以
`expectedDocumentContentRevision` 判断整个提案是否过期，因此单纯运行 Cell 不会制造伪冲突。

刷新或浏览器崩溃后的本地草稿恢复属于后续 backlog；首版在离开页面时对未保存内容触发浏览器原生警告。

### 9.2 Agent 受控执行、解释与尝试比较

第一、二阶段接受 Agent diff 时才原子修改文档并标记 stale。第三阶段中，非删除提案进入开放 review 时已经修改
文档并标记 stale，但禁止执行；Accept 只关闭 review，并把全部 step 的 `appliedDocumentContentRevision` 更新为
用户最终保存版本。用户随后通过最后一个 step 卡片上的独立图标按钮，显式运行整个会话修改的 Python Cell 及其受影响下游。显式应用的删除提案仍沿用原流程；涉及删除 Python Cell 时必须重置 runtime 并
干净运行当前全文，避免已删除变量残留在解释器内存里。

每次授权运行创建一个 `ResearchCellChangeAttempt`，冻结提案、应用后的 `contentRevision`、根 Cell、计划 Cell、
实际 `ResearchCellExecution`、成功/失败/中断状态和错误。所有执行快照通过 attempt 外键分组；运行前、每个 Cell
之间和运行结束后都复查文档内容修订，另一标签页的编辑不能让一次尝试混入不同版本源码。运行失败与被上游阻断
的分支同样保留，不只记录成功样本。

同一提案重跑后，卡片比较本次和上次尝试的源码 hash、输出 hash、状态与环境指纹，并明确显示计划/实际执行的
Cell 数量。这是探索层的简版比较；完整运行则保存为彼此独立的只读快照，不在首版自动归因代码、数据、环境或
结论变化。用户需要复查时重新完整运行，再分别查看两次快照。

用户可对任一已结束尝试显式请求 Agent 解释。请求携带 attempt id，服务端只向模型提供该尝试的不可变源码、
执行状态、错误、环境指纹和受控输出预览；超出上下文预算的源码或输出显式标记截断。Agent 必须区分失败、跳过、截断和完整运行快照，不得把探索输出升级为投资结论，也不会因为解释请求再次运行代码。

### 9.3 完整执行与研究版本封存

探索态文档与正式执行必须分开：当前 `ResearchDocument` 持续可编辑，用户点击“干净运行全文”后则创建一个
不可变 `ResearchExecution`。执行开始时冻结文档 `contentRevision`、标题、所有 Cell 的顺序/类型/源码/配置/
修订、AST 定义与引用、完整 DAG 和 runtime 版本，再从全新 Python 环境执行这份快照。运行期间用户可继续修改草稿，
但草稿的新修订不得混入本次执行，快照输出也不得覆盖已变化 Cell 的当前输出。

完整执行的 `running / success / error / cancelled` 状态、已执行 Cell、不可变 Cell execution、artifact 和聚合环境指纹一并
持久化。只有全文从干净环境运行的记录才是 `ResearchExecution`；单 Cell、受影响分支与 Agent 受控尝试仍是探索记录。

每次完整运行都进入当前文档的“运行历史”；历史详情以只读方式展示冻结源码和当次输出。用户可将任一成功执行
显式“封存为研究版本”，再编辑版本名、标签和备注。封存是对已有执行的筛选和命名，不再运行代码，也不改写源码、
DAG、输出与指纹。首版只在当前文档内查看运行历史；全局封存档案、跨快照自动比较、底层数据副本与 LLM 摘要
等待真实需求再进入 backlog，不作为执行成功、封存或 M3 收工的前置条件。

## 10. 分阶段实现

### M0：运行时 PoC 与架构门

- 用一个真实时间序列问题验证独立 research runner、共享状态、中断、重启、超时和资源回收；
- 同时做一次限时 marimo 嵌入 PoC，验证数据桥、Agent 操作、输出提取、同源代理和沙箱，不把 PoC 当正式依赖；
- 根据证据在“完整采用 marimo”与“jixie-native DAG/runtime”之间做最终工程选择。

### M1：研究文档框架

- `ResearchDocument` / `ResearchCell` CRUD 与文档级 timer 自动保存、修订冲突保护；
- Markdown / Python Cell、AST DAG、重复定义、循环依赖、stale 状态；
- 单 Cell、受影响 Cell、重启和中断；
- 文本、异常、DataFrame preview、Matplotlib PNG。

### M2：平台数据与交互图

- 只读数据桥、语义目录插入、PIT/revision 和数据指纹；
- 静态 Research SDK Contract、生成/check、Monaco 参数与直接返回列补全；
- `charts.line/scatter/histogram/boxplot/heatmap/event_path`；
- ECharts 富交互、表格分页/虚拟化和 artifact 上限（第二阶段已完成图片产物懒加载、1 MiB 表格预览预算与 2 MiB 内联输出上限）；
- Agent 增删改、执行和解释 Cell：第一阶段已完成受审计批量提案、Monaco Diff、显式
  应用/拒绝与修订冲突保护；第二阶段已完成独立用户授权、`ResearchCellChangeAttempt` 审计、精确结果解释与
  源码/输出/状态/环境的简版尝试比较；第三阶段采用开放变更会话、Cell 内联可编辑 Diff、连续 Agent step 聚合、
  最终 Accept 与原子 Undo，删除仍保留显式应用。

### M3：完整执行、快照与封存（首版完成）

- 干净环境完整执行已经形成 `ResearchExecution`，并覆盖输出 artifact、环境指纹、文档内运行历史、只读快照与显式封存；
- 快照只冻结 Markdown / Python 源码、DAG、当次输出和环境，不增加隐藏计算或专用报告；
- 用户通过重新完整运行产生新快照。全局档案、数据请求指纹和新旧运行自动归因比较不进入首版完成定义。

### M4：Factor / Strategy / Backtest 闭环

- **已完成（第 1 项）**：只允许成功且已封存的 `ResearchExecution` 提取 Factor 草稿。LLM 先判断快照是否含有
  一个可由现有 Factor SDK 表达的时点信号，再重写为 `cross_sectional / time_series / panel` 定义；生成代码必须
  通过现有 Factor 编译器与最多两轮修复。描述性研究、指数间回归、未来信息、数据能力缺口或输出语义不清时明确
  拒绝，不创建空壳。每个快照只生成一个草稿，重复操作直接打开原草稿；Factor 保留来源快照、来源 revision/hash、
  LLM 摘要和未解决项，并可精确回跳只读快照。快照中明确且受支持的股票池、日期、频率、过滤条件、标的与事前
  方向形成版本化 FactorReport 建议参数；Factor 代码保持与评估范围解耦，工作台只在草稿尚无报告时预填建议并
  要求用户确认，不能表达的范围进入未解决项。交接不会自动运行 FactorReport、揭示 Holdout、发布 Factor 或复制研究数据；
- **已完成（第 2 项）**：只允许成功且已封存的 `ResearchExecution` 生成唯一、私有的 Strategy 草稿。LLM
  先判断研究是否已经明确资产范围、信号方向、调仓/进出场规则与仓位动作；需先固化信号的研究引导用户生成
  Factor，描述性研究或当前 Python Strategy runtime 无法表达的品种/频率明确拒绝。通过门禁后生成的草稿默认使用
  Python `py-v1`，必须通过现有编译与受限运行时校验，并保留来源快照、revision/hash、摘要、待验证项和精确回链；
  交接不会自动运行回测，用户仍需在 Strategy Lab 中确认参数、显式回测并审查交易与结果；
- **已完成（第 3 项）**：Factor 增加 Python SDK、静态类型、受限运行时和 `py-v1` 代码快照，依次覆盖
  `cross_sectional`、`time_series`、`panel`、FactorReport、发布和 Strategy 消费链路；现有 TypeScript Factor
  保持兼容，新的 Factor 以及 Research → Factor 草稿默认使用 Python。四个实现切片已经完成：契约/持久化/
  stubs，横截面运行时，时序与 Panel 下游闭环，Monaco/Pyright/模板/Research 交接与 E2E；
- 已发布 Factor 和冻结回测不可被研究文档反向修改。

M4 backlog：Research 后续可通过独立的 `results` SDK 读取用户权限内的不可变 FactorReport，或显式读取
Strategy 的最新回测结果用于二次分析；它们是派生结果而不是 `data` 通用市场数据，也不和 Research 建关系表。
当前 Strategy 只保存可覆盖的 `lastResult`，若需要精确复盘某一次历史回测，应先增加不可变 `BacktestReport`
（含配置/代码/结果 hash、完成时间、净值与成交快照）再允许按 report id 读取。完整持仓历史必须由回测引擎真实
产出后再暴露，不能从成交记录临时猜测。

### M5：Research 多资产数据集

目的不是在 Research 重做 IC、分层或回归报告，而是补齐 Python 自由研究缺失的数据维度：`data.series()`
继续读取“单个对象 × 一段时间”，M5 让 Python Cell 可以读取“某日 × 多只股票”的截面，以及“多个历史截面”
组成的长表 Panel。用户或 Agent 可以在普通 pandas / statsmodels 代码里检查分布、缺失、异常值和横截面关系；
当想法形成正式因子后，仍交给 FactorReport 统一计算 IC、分层、衰减和换手，不在 Research 复制另一套口径。

- **已完成（M5.1 `data.cross_section()`）**：按指定日期读取全 A 股或某指数的 PIT 成分，返回固定公开 Schema
  的股票截面；单次最多 6000 行，超限时要求缩窄股票池；
- **已完成（M5.2 `data.panel()`）**：按完整月末重复同一 PIT 规则，返回 `date × code` 长表；单次最多 120 个
  月末、10 万行，完整月末缺少精确数据快照时失败，不静默向前填充；
- 两者复用 `UniverseSpec` 的历史指数成分、上市天数、停牌和风险警示规则，公开列来自版本化研究语义目录，
  不暴露 Prisma 表名、字段名、任意 JOIN 或 SQL；
- SDK Contract 是参数、固定返回列、Monaco/Pyright 与 Python runtime 的唯一真相源；执行结果同时披露实际数据日、
  成分股快照日、数据 revision 和诊断，并写入 DataFrame 的 `attrs["jixie"]`，避免把请求日、自然月末或今天的
  成分误当成历史事实；
- 首个切片只覆盖中国 A 股日频截面和月末 Panel。财务报表 vintage、事件数据、任意频率与跨市场股票池继续由
  真实研究问题触发，不提前扩展。

M5 明确不增加统计 helper、固定报告、Validation Cell 或专用 UI；也不读取 FactorReport / BacktestReport。
Research 中临时计算任何统计量都只是文档内探索代码，正式因子证据仍以不可变 FactorReport 为准。

## 11. 方法与模板 backlog

先搭建框架，不用统计学目录阻塞 M0–M3。以下能力按真实研究问题、方法审计和数据准备逐项进入可复用 Markdown / Python 模板或经过测试的 helper：

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
6. 在干净环境完整执行并固化当次代码、输出、环境、图表和正式结果；
7. 将合格候选显式送往 Factor 或 Strategy，而不是复制粘贴且不丢失血缘。

### 2026-08-20 封板验收

首版以“沪深 300 低 PB 与次月收益”为真实问题贯通了上述路径：Markdown 预设问题和限制，Python 通过 PIT
Panel 完成数据整理、统计计算与静态/交互图，Agent 查询 SDK 后提出可编辑 Cell 变更，用户审核并重新运行，
随后干净运行全文、封存不可变 `ResearchExecution`，再生成保留来源和 FactorReport 建议范围的 Python Factor
草稿。此前单独完成的 Strategy 交接使用同一快照门禁、编译校验和来源回链。

第一次真实验收暴露并完成了四组整改：Agent 提案与审核状态持久化；由 Research SDK Contract 生成并供 Agent
查询的准确 API Catalog；Research 股票池、区间、频率、过滤条件和方向向 FactorReport 建议参数传递；Agent
阶段状态的流式/刷新恢复，以及本地 Web、API、sandboxd 一键启动和缺失提示。整改分别经过集成测试、类型检查、
生产构建和针对性浏览器验证，不再重新制造一套重复的大型验收流程。

### 2026-08-24 Agent 语义确认校正

本次校正收口第 5、6 项中“Agent 修改同一文档”和“代码可执行后再固化”的前置语义门：

- Agent prompt 直接获得精简但完整的版本化 Concept Manifest，只能从受控 Concept id 中解释用户原话，并且只能
  提取该 Concept 声明的 `instrumentForm`、市场、计价货币和期限等维度；关键词检索不再承担用户意图到 Concept
  的主映射。
- `searchResearchCatalog` 仍是 Concept 到 Binding 的唯一事实源，同时明确区分“数据库存在”与“公开 Research
  Python SDK 可执行”。只有 `sdkAccess.status=ready` 的 Binding 才能进入 Python 或成为代理选项；例如收益率数据
  已落库但尚无公开 Python loader 时，必须显示 `not_exposed`，不能臆造 `data.series` 调用。
- 当精确口径不存在但存在可执行代理，Agent 必须生成持久化选择卡，展示代理差异、`不使用代理` 和可选自定义
  回答。卡片与独立 `ResearchClarification` 记录原子保存；待确认期间暂停自由输入和 Cell Diff，用户回答后以精确
  Concept/Binding reference 开启新 Agent turn，刷新仍可恢复待确认或已确认状态。
- 后端不只依赖 prompt：同一 turn 内确认卡优先于 Cell Diff，未回答确认会拒绝新提案；Agent 提交的
  `data.series` 由 Python AST 提取品种类型、identifier 和 measure，并在 Diff 展示前与 Research SDK Catalog
  精确核对。动态或不存在的品种身份、未查询的 SDK Contract 和不兼容 measure 均会被拒绝。

浏览器验收已覆盖“待确认卡 → 选择沪金代理 → 回答落库 → 刷新后仍为已确认”，并验证待确认期间普通 Agent
输入被禁用。该次语义校正本身没有扩大数据覆盖面；新的收益率、宏观或外汇 Python loader 仍按数据语义目录
单独建设。

### 2026-08-24 美国国债收益率 Python 切片

为执行“黄金代理与美债收益率关系”这一真实研究，首个收益率公开 loader 已按第 2、5、6 项的边界落地：

- `data.yield_curve(curve, *, tenor, start, end, frequency, transform, partial_period)` 只接受静态 Contract 中的
  美国国债名义/实际曲线和期限；返回固定 `date / value` DataFrame，不暴露 Prisma、表名或任意 SQL；
- 曲线与期限组合仍由 `ResearchConceptBindingRegistry` 审计。Catalog 只有在本地存在数据且组合存在精确 Binding
  时才返回 `sdkAccess.status=ready`，名义、实际和期限不得静默互换；
- 水平单位为百分比，首版变换只开放 `level / difference`；`difference` 是百分点变化，不冒充债券收益率；
- 同一 SDK Contract 生成 Agent Catalog、Monaco/Pyright Stub 与 Runtime 请求校验；Python AST 在 Diff 展示前
  提取 literal `curve / tenor`，动态值或未登记组合直接拒绝；
- 美国收盘数据用于中国市场时不会自动猜测对齐方式，研究代码必须显式滞后或披露时区口径。

该切片只把已经落库、已有数据契约的美国主权收益率开放给自由研究；宏观和外汇 loader 仍待真实问题触发。

至此本节第 1–7 项均已闭环。方法模板、FactorReport / BacktestReport 回流、全局快照搜索、底层数据副本和自动
运行差异归因继续留在 backlog，不属于首版完成条件。

首版成功不以覆盖全部统计方法为条件；成功标准是自由探索、完整运行快照和下游产品之间的边界清楚、运行可信、
历史结果可回看。
