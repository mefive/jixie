# 业务 SDK 与运行时统一组织计划

状态：整体计划及三个提交的范围已获用户确认。提交 1 已完成（`11abd9df`）；提交 2 已完成（`46e4c585`）。
提交 3 已通过人工代码审查、静态检查与行为验收，随本记录提交。三个业务的整理与真实镜像验收均已完成。

## 目标与判断

统一 Strategy、Factor、Research 中 SDK、公开契约、语言运行时和沙箱基础设施的含义。
用户应能从任意业务模块找到脚本可用接口及其实现，维护者应能追踪契约如何进入编辑器、Agent、运行器和部署镜像。

技术上可以一次提交，但不建议：三个业务的运行模型和验收重点不同，合成大提交会增加审查与回归定位成本。
按三个可独立验证、可独立部署的业务闭环提交；每个提交同时交付实现、消费者迁移、生成物、打包、部署规则、测试及文档，
不拆成“先搬文件、以后修消费者”的不完整阶段。整个需求完成以三项全部验收为准。

## 当前状态与已有工作

| 业务 | 现状 | 本轮需解决的问题 |
| --- | --- | --- |
| Strategy | 已将 TS/Python SDK 放入 `apps/api/src/strategy/sdk`；Python runner 放入业务 runtime；TS 契约移入 shared/sdk/strategy | 已完成静态检查、人工审查和验证，提交 `11abd9df` |
| Factor | TS/Python SDK 已归 `factor/sdk`；Python runner 归业务 runtime；TS 编辑器与编译类型共用 shared/sdk/factor 声明来源 | 已完成修订版审查及全部本轮验收，提交 `46e4c585` |
| Research | 作者 API 归 sdk/python；宿主适配归 runtime/host；Cell 执行与会话归 runtime/python；shared 契约归 sdk/research | 已通过人工审查、静态检查、运行回归、构建、E2E 及真实三业务镜像验收 |

Strategy 的已有设计与静态结果见 [strategy-sdk-boundaries.md](strategy-sdk-boundaries.md)。
该文档中“Factor / Research 保持原样”仅是第一个提交的边界，不是本整体计划的最终状态。
已有工作不回退、不重做；提交 1 已按既有审查流程完成验证。本文随第一个提交纳入，不新增单独的计划提交。

## 统一职责与依赖方向

| 位置 | 职责 | 主要消费者 |
| --- | --- | --- |
| `packages/shared/src/sdk/<business>/` | 公开契约、语言声明渲染、文档与 Agent 参考；不依赖 API、Prisma 或沙箱进程 | SDK 实现、编辑器、Agent、静态验证、生成脚本 |
| `apps/api/src/<business>/sdk/` | 用户脚本可调用的对象、函数与辅助实现；依赖注入宿主能力 | 该业务语言运行器、脚本作者经运行器使用 |
| `apps/api/src/<business>/runtime/` | 源码加载、语言适配、协议、宿主能力适配、执行状态与资源生命周期 | 各业务执行流程、沙箱业务入口 |
| `apps/api/src/infra/runtime/` | 共用连接、隔离执行及日志设施 | 各业务 runtime |
| `apps/sandboxd/` | 沙箱进程/容器管理、公共 Python 启动器、帧通信与通用执行限制 | API 的沙箱客户端及部署系统 |

依赖原则：业务 runtime 组合 SDK 和宿主能力；SDK 通过窄接口或回调请求宿主，不反向导入运行器。
Strategy 的 EngineContext 到公开 SDK 的适配保留显式边界，公开契约不继承 Engine 内部类型。
Engine 继续负责模拟时间、PIT 数据、因子结果消费、撮合和账户，不承接 Research Cell 或 Factor 源码执行。
业务数据查询、权限、证据留存和报告生命周期继续留在所属业务能力中，不因 SDK 整理集中到 runtime。

目录统一不等于接口统一：保留 TS camelCase、Python snake_case，以及不同业务的回调/交互方式。
Research 不增加不存在的 TS 用户 SDK。Strategy 的两种语言暂不追求功能对等，不引入跨语言通用 DSL。
不为了目录对称而复制类型、增加空文件或制造统一基类。

## 目标目录与生成流程

```text
packages/shared/src/sdk/
  strategy/                 # 已有 reference.ts 与生成 contract.ts
  factor/                   # TS 公开契约/声明；Python 公开契约及 stub 渲染
  research/                 # contract、Python signature/stub、Agent catalog

apps/api/src/
  strategy/
    sdk/typescript.ts
    sdk/python.py
    runtime/typescript/      # TS 源码加载与宿主桥接
    runtime/python/          # Python 宿主适配与 runner.py
  factor/
    sdk/typescript.ts
    sdk/python.py
    runtime/typescript/
    runtime/python/          # 含从 sandboxd 迁入的 runner.py
  research/
    sdk/python/              # data.py、results.py、valuation.py、charts.py 等实际实现
    runtime/host/            # 请求校验、分派与输入回放适配
    runtime/python/          # session.ts、runner.py、AST 分析与输出序列化等

apps/sandboxd/python/
  jixie_runner.py            # 三种业务的公共启动/分派入口
  jixie_factor_sdk.pyi       # 保留稳定生成物路径
  jixie_research_sdk.pyi     # 保留稳定生成物路径
  requirements-research-runtime.txt
```

Research Python 实现较大，使用语言子目录；Strategy / Factor 的较小 SDK 可以保持单文件。
这遵循同一职责规则，不要求文件树逐项相同。Research 的 Python 模块不得与 TS 宿主实现形成相互导入。

生成规则：

- 保留现有 `setup:sandbox` 写入及 `--check` 校验入口；契约搬迁同步修改生成器 import。
- 保留既有 shared 根级公开导出名称；仓库内部源码引用直接迁到新归属，不保留旧源文件转发层。
- Research 现有 contract、Python signature/stub、Agent catalog 一起迁入 `sdk/research`。
- Factor Python 的 `factor-python-sdk.ts` 迁入 `sdk/factor`，保持 stub 签名和公开字段；TS 声明的详细归并见提交 2。
- `.pyi` 保留现有产物名和位置，不将生成文件当成运行实现，也不手工编辑。Strategy TS 的 `contract.ts` 继续是生成物。
- Python 版本与第三方依赖的 `research-python-runtime.ts` 保持现有独立运行环境契约，不为目录整齐改变环境或安装流程。
- 生成声明可以来自既有不同形式的契约；本次不重写所有生成器为同一种元模型。

## 提交 1：完成 Strategy SDK / Engine 分离

提交信息：`refactor(strategy): separate SDK contracts from engine internals`

沿用已批准的范围与当前实现，不因新计划重新启动 Gate 1。交付内容与入口见现有 Strategy 设计文档。

交付包括：shared Strategy TS 契约、TS/Python SDK、Python 业务 runner、Engine 内部类型边界，以及
仓库根镜像构建上下文、显式 Python 文件打包、同一路径可影响多个部署组件的支持。
这些基础改动为后两个提交提供可用的打包方式，但镜像在此提交仅增加 Strategy 业务源文件。

审查前静态检查、修订版人工审查以及 SDK、Engine、TS/Python runtime、Worker、生成/部署脚本测试、构建、
打包执行回归及编辑器/Python Strategy E2E 已通过（2026-09-20）；详细结果见 Strategy 设计记录，按原信息提交。
静态检查通过不能替代镜像或运行时验证；实际镜像构建作为后续完整 Python 布局验收的一部分。

## 提交 2：统一 Factor SDK 归属与声明来源

提交信息：`refactor(factor): separate SDK definitions from runtime adapters`

交付：

1. 将 TS SDK 从 `runtime/typescript/sdk.ts` 移到 `sdk/typescript.ts`，更新 Engine、内置模板、编译器和测试消费者。
   将公开类型与编辑器声明来源收拢到 `shared/sdk/factor`，覆盖既有横截面及 V2 时间序列/面板公开入口。
   前端编辑器改为消费 shared 声明渲染，保留现有双语说明；API 公开签名以共享类型检查，不另手写同名副本。
   工厂及 `history/value/lag` 实现归 SDK；runtime 打包 SDK 后注入 isolate、传入准备好的数据，签名/行为由契约与编译回归约束。
2. 从 `jixie_factor_runtime.py` 拆出 Factor 工厂、公开 Context、FactorBar 及相关 SDK 实现到 `factor/sdk/python.py`；
   源码加载、`jixie` 注入、消息循环及返回校验归 `factor/runtime/python/runner.py`。
3. Python 契约迁到 shared 对应目录，更新生成器和全部引用，生成的 `.pyi` 内容应保持一致。
4. 同步通用 runner 分派、Dockerfile、`.dockerignore`、部署影响清单和部署计划测试。
   所有新增 Factor Python 运行源文件同时影响 API 与 sandboxd；不得漏掉 SDK 辅助模块。
5. 同步模块 README、CLAUDE、架构和运行入口文档；移除旧 Python 业务文件与失效源码引用。

兼容边界：用户源码的 `defineFactor`、`defineFactorV2`、`from jixie import Factor` 等入口不变；
不改变窗口、字段口径、PIT、缺值、因子方向、结果长度校验、分析准入或错误传播。
不通过移动所有 Factor 存储/报告类型来制造 SDK 契约；仅收拢实际脚本公开表面。

经 SDK 对照后的修订：TS 与 Python 均以 `CrossSectionalFactorContext`、`AssetFactorContext` 组织内部实现，
TS 类实现原有共享类型，runtime 直接实例化；不保留内部 `create*Context` 转发函数，不增加公开构造入口。
公开工厂、TS 类型名、字段名及各语言既有参数行为保持原样，不引入新旧 API 并存。
已知 `history` 非正窗口/未知字段处理与五个/七个资产字段差异保留并记录在 SDK README；本次不做公开 SDK 改版。

审查前：全仓 typecheck/生成物一致性、边界静态扫描、相关 lint/format、Python AST 与路径/diff 检查。
审查后：TS 两类编译器、Python validator/Pyright、横截面及资产因子协议与执行回归、Strategy 因子输入/Engine 隔离回归；
验证 shared 声明与编辑器一致、原用户示例仍可用；部署计划和从镜像 COPY 清单组装的隔离 Python 打包测试；
相关构建与 Factor 编辑器/执行 E2E。现有测试覆盖不足时只补充本次边界和迁移风险所需用例。

### 提交 2 实施与静态验收（2026-09-20）

- TS 编辑器原有完整声明模板与双语说明迁至 `shared/sdk/factor/reference.ts`，没有扩展签名。
  现有生成脚本新增 Factor `contract.ts`（共五份生成物）；工厂编写辅助和 runtime 元数据引用生成契约。
  `factor.ts` 中宿主用的可写 FactorBar 映射自公开 readonly Bar，保持既有根级导出与宿主组装方式。
- 根据人工审查反馈，TS 的两个工厂与 `history/value/lag` 实现完整迁入 `factor/sdk/typescript.ts`。
  `runtime/typescript/sdk-bundle.ts` 只打包该 SDK 并缓存源码；编译器在每个 isolate 内初始化 SDK，
  使用实际工厂与 Context 构造函数，不保留同名字符串实现。数据准备、元数据校验、批量调用、日志及资源释放仍归 runtime。
  开发读取 `.ts`、生产读取编译后的 `.js`；审查后须验证两种路径与 bundle 不含宿主依赖。
- TS Context 已修订为与 Python 同名的两个类；运行器直接实例化。方法绑定保留已有解构调用方式，
  历史数组和声明字段集合使用私有字段，生成契约测试同时检查类实现与原公开方法签名一致。
- Python 公开类及辅助类归 `factor/sdk/python.py`，源码加载、元数据/结果校验及批量循环归
  `factor/runtime/python/runner.py`。按 AST 比较迁移前后所有类/函数完全一致；变动仅为导入及源码归属。
- Python 契约迁为 `shared/sdk/factor/python.ts`，除相对类型 import 外源码一致，生成的原路径 `.pyi` 无 diff。
  TS 编辑器的声明模板与双语说明也已与迁移前原文逐项比较一致。
- sandboxd 分派、Dockerfile、`.dockerignore` 及部署影响清单同步；Factor 的两个 Python 文件同时触发 API/sandboxd。
  COPY 源文件及逐层父目录均已静态核对存在且允许进入构建上下文，尚未执行容器构建。
- `pnpm typecheck` 全部通过（shared/API/Web/Docs/sandboxd）；包含生成物一致性和后端静态边界扫描：
  修订后为 785 个文件、2942 条运行时边、697 条类型边、0 违规，沿用 3 条已登记例外，无新增循环例外。
- 所有改动 TS/TSX/MJS（含新增生成契约）的 ESLint、手工源码 Prettier、Python AST 语法检查和 diff 检查通过。
- 新增测试代码覆盖双语 TS 作者代码/错误诊断、公开与宿主类型兼容，以及从 Dockerfile 实际 COPY 输入组装的
  Python 横截面/时间序列/面板协议执行；扩展部署分类回归。补充 TS bundle 依赖边界、所有 history 字段/窗口/
  缺值与返回副本、无历史时的单点错误处理，以及 V2 lag 参数/缺值/范围访问回归。审查前未运行，审查后结果见下。
- 未改 HTTP、数据库 schema、公开调用方式、数值算法或业务准入。TS 编辑器五个 V2 字段与 Python 七个字段的
  既有范围差异明确保留；宿主的受控研究字段 registry 仍归 definitions，不把本次结构整理当作 TS 能力扩充。

### 提交 2 审查后验证（2026-09-20）

- 用户确认修订版后执行验证，产品代码未再修改。SDK/编译器、Python validator/Pyright、协议、三类 Python
  打包运行、横截面历史、资产观测、Strategy 因子准备及 Engine 隔离回归共 19 个测试文件、115 项通过。
  其中包含源码 Worker 的 TS/Python 策略与因子四种组合，以及 Factor 分析/相关性/Signals 执行入口。
- `pnpm build` 全仓通过，仅有 Web/Docs 既有大 chunk 提示。编译产物模式另跑 Worker 测试 8 项通过；
  直接加载 dist 的 SDK bundle 与三类 TS 编译器，确认只包含 `dist/src/factor/sdk/typescript.js`，
  `history/value/lag`（含解构调用）输出符合预期。
- setup/部署计划/bootstrap 测试 31 项通过；新增 `factor-sdk` E2E 命令后，E2E 运行器/清单测试 8 项通过。
- `python-factor.mjs` 完成真实页面创建、Pyright `pe_ttm` 补全与 Python 分析报告，保留语言/运行时/源码快照。
  使用临时 SQLite 和合成市场数据；报告完成并呈现图表，不涉及生产数据或投资有效性结论。
- 新增 `factor-sdk.mjs` 验证横截面、时间序列和面板三类 TS 编辑器：中英切换后签名/原有说明正常、
  Monaco 无语义错误、编辑器修改经自动保存和服务端定义校验持久化。V2 既有英文注释保持原文。
  首次运行发现测试导航方式不能切换第二个工作区，修正测试脚本后全部通过；没有借此修改产品代码。
- 八张截图已逐张视觉检查：`apps/web/acceptance/13a-python-factor-sdk.png`、`13b-python-factor-report.png`，
  以及 `factor-sdk-{cross_sectional,time_series,panel}-{zh,en}.png`。截图按仓库既有规则忽略，不纳入源码提交。
- 临时 API/Web 已关闭，3307/5277 端口释放；SQLite 无打开句柄，临时数据库目录已清理。
  无推送。真实 Docker 镜像构建与三业务容器验收仍按整体计划归提交 3，本轮 Python 打包测试不替代该验收。

## 提交 3：统一 Research SDK 与 Cell 运行时归属

提交信息：`refactor(research): separate SDK APIs from cell execution runtime`

交付：

1. 从 `jixie_research_runtime.py` 提取 `data`、`results`、`valuation`、`charts` 的实现及其纯辅助函数到
   `research/sdk/python/`。使用注入的宿主请求能力和第三方库对象，SDK 不承担帧收发、会话或 Cell 生命周期。
2. Python 主循环、AST 分析、namespace 初始化/reset、执行结果序列化、环境捕获归 `research/runtime/python/`；
   同目录的 TS session 继续由 API 进程执行，不打包进入 Python 镜像。
   charts 的公开结果对象归 SDK，转换为传输帧及通用展示输出的逻辑归 runtime，避免双方相互导入。
3. 将现有 `research/sdk` 的 protocol、request、validation、dispatch、input-replay 和分析投影类型按宿主职责迁入
   `runtime/host`；更新 document-runs、dependencies、embedded 等调用方。数据加载仍归 datasets，
   回放的权限和证据业务规则保持既有行为，不下沉到 Python SDK。
4. 迁移 shared 的 Research SDK 契约、Python signature/stub 和 Agent catalog；同步语言服务、Agent、
   生成脚本及内部引用。公开导出名、`.pyi` 和用户 Cell 全局对象保持兼容。
5. 同步 sandboxd 分派、镜像显式文件清单、部署影响和计划测试；移除 sandboxd 旧 Research 业务运行文件。
   更新文档并检查三个模块最终职责是否一致。

兼容边界：不改变数据列/单位/PIT、Cell 依赖判定、stale 传播、队列、取消、reset、参数协商、
输入留痕与回放、产物限制或固定运行环境。Research 的业务数学算法只迁移，输出必须保持回归一致。

审查前：与提交 2 相同的静态检查，另外检查所有 Python 辅助文件都被镜像包含，检查 Pyright 和生成脚本不依赖旧路径。
审查后：Research SDK/协议/分派/回放、Python 会话与 capability、AST 分析、Cell 执行/reset/取消、
图表/表格/估值输出、嵌入式执行和语言服务回归；相关构建和 Research 文档/嵌入分析 E2E。
执行真实 Python 镜像构建及三种业务的启动/代表性请求验收，确认镜像只包含显式列出的运行源文件，
并对三种业务的部署路径分类做最终检查。容器环境不可用时须记录阻塞，不以本地源目录运行替代镜像验收。

### 提交 3 实施与静态验收（2026-09-20）

- `research/sdk/python` 已提供实际 `data/results/valuation/charts` 实现，含 `ResearchHost` 窄请求接口与
  共享标量转换。宿主通信依赖注入；保留 pandas 对象注入与既有 NumPy/SciPy 数值实现。
  SDK 不导入 runtime，图表结果对象归 SDK，转为输出帧归 runtime。
- Python runtime 拆为 runner、analysis、bridge、environment、outputs 五个模块；TS 会话迁为
  `runtime/python/session.ts`。宿主协议、请求解析、校验、分派、输入回放及相关测试迁为 `runtime/host`。
  datasets、权限、证据、文档/嵌入生命周期的业务归属未改变。
- shared 的 contract、python-signature、python-stub、agent-catalog 迁到 `sdk/research`，根级导出名称保留；
  生成脚本已更新，语言服务/文档/Agent 继续使用原公开导出。生成的 `.pyi` 路径和内容无变化。
- 原 sandboxd Research 业务文件已移除，公共 runner 改为导入业务 runner；11 个 Research Python 输入
  逐项加入 Dockerfile、`.dockerignore` 和部署影响清单。静态核对全部 16 个 Python COPY 输入、父目录、
  相对 Python 导入与业务部署归类覆盖；TS session/host 只影响 API。
- 57 个迁移前 Python 类、函数与常量逐项 AST 对照一致，仅规范化两处 `_HostBridge` → `ResearchHost`
  的类型标注；没有遗漏、复制或改写算法。11 个新 Python 文件均通过 AST 语法和全局引用检查。
  18 个移动的 TS 实现/测试/共享契约，除模块路径字符串外与原文一致。
- `pnpm typecheck` 全部通过（shared/API/Web/Docs/sandboxd），含生成物一致性与后端边界扫描：
  787 个文件、2950 条运行时边、697 条类型边、0 违规；保留 3 条已有例外，没有新增循环或目录豁免。
  所有改动 TS/MJS 的 ESLint、Prettier 与 diff/路径静态检查通过。
- 新增独立 SDK 注入测试，验证 data/results/charts 的实际使用不加载 runtime；新增从 Docker COPY 清单
  组装隔离目录的 Research 请求/AST/图表/参数/reset 回归。部署测试改为逐项覆盖 Dockerfile 中的业务
  Python 输入，并检查 Research 的 TS 宿主变更不触发 sandboxd。现有会话、FCFF、嵌入/语言服务测试保留。
- 上述测试代码尚未运行；构建、Research/嵌入分析 E2E、真实 Docker 镜像构建及三业务容器请求验收均待
  人工代码审查通过后执行。静态清单与本地打包测试不替代真实镜像验收；本提交目前未提交到 Git。

### 提交 3 审查后验证（2026-09-20）

- 用户确认后运行 Research 全目录及 Strategy Python/Factor 打包相关测试，共 59 个文件、312 项。
  首轮 308 项通过，4 项因默认系统 Python 缺少 pandas/NumPy 失败；切换项目固定 Python 环境，
  配置可写 matplotlib 缓存、降低并发并给予第三方启动足够时间后，相关 runtime/SDK/嵌入及 Agent
  12 文件 68 项全部通过，覆盖上述失败用例与额外 14 项 Agent 回归。FCFF 数值/反解/证据模板、
  Pyright、请求校验/分派、权限/留痕/回放、AST/reset/取消及输出限制均已有通过结果。
- 新打包测试在完整第三方环境下收到初始化日志；修正测试按现有协议识别 log 帧，再断言业务帧序列，
  独立重跑通过。没有更改产品代码或放宽业务结果断言。
- `pnpm build` 全仓通过；Web/Docs 有既有 chunk 体积与静态/动态导入提示。生成/setup、部署/bootstrap、
  后端边界检查器、前端 Research SDK/目录相关测试共 82 项通过；sandboxd 生命周期 8 项通过。
  sandboxd 初次在受限环境下因 Unix socket EPERM 失败，授予本地监听权限后重跑通过。
- 普通 Research E2E 使用编译后的 API/Web、独立临时 SQLite 与合成指数数据：`research-executions`、
  `research-charts`、`research-table`、`research-matplotlib`、`research-interrupt` 五项全部通过，验证
  完整执行/冻结/封存/删除后证据、四类原生图表、表格截断/分页、私有图片授权和中断后 stale 保留。
- `embedded-analysis` 的中文、英文真实 Web/API/Python 流程全部通过：报告输入→表格/图片→参数新版→
  retained Research 接续→跨报告引用→Strategy 报告与历史图表。只替换外部模型、使用合成报告，未调用生产数据。
  已检查九张代表性截图，覆盖图表/表格、快照、中英嵌入卡片、版本/接续、matplotlib 与取消；产物位于
  `apps/web/acceptance/research-*.png`、`embedded-analysis-*.png`，按既有忽略规则不纳入源码提交。
- 启动已有 Colima，以仓库根目录真实构建 `apps/sandboxd/Dockerfile.python`，镜像 ID `755734ee5514`。
  镜像 `/opt/jixie` 仅含 Dockerfile 显式列出的 16 个 Python 文件，无 TS、旧业务 runtime 或挂载源码。
  UID 为 65532，Python 3.13.15；六个固定第三方包版本与生成 requirements 一致。
- 直接使用该镜像的默认 runner，通过已有打包测试发送真实长度前缀帧：Strategy on_bar、Factor
  横截面/时间序列/面板、Research data/AST/chart/参数/reset 共 5 项全部通过。
  容器采用禁网、只读根目录、非 root、cap-drop、no-new-privileges 与生产 CPU/内存/PID 限制；
  没有挂载本地实现。至此完成前两个提交延后的真实镜像验收。
- 临时 API/Web 已关闭，3307/5277 端口和数据库句柄已释放，临时数据库已删除；嵌入 E2E 自行清理。
  容器全部退出并删除，临时镜像已删除；Colima 恢复停止，Docker context 恢复 default。无推送。

## 每个提交的审查流程

遵循本会话已选定的 `review-gated-development`：

1. 实现前确认该提交范围、上述准确提交信息、交付及验证项目；已获批准的范围不重复索取批准。
2. 实现完整提交范围与测试代码；只运行静态检查，提供产品代码审查入口。
3. 人工代码审查批准后再运行测试、构建和 E2E；全部必要验证通过后提交，不增加重复的提交确认，不 push。
4. 若修复涉及产品代码，返回代码审查；仅测试修正按 skill 的授权规则处理。
5. 写入实际验证结果，交付 E2E 截图，清理临时进程和资源；继续前确认下一提交的范围与当时的事实一致。

## 完成标准与风险

- 三个业务的 SDK 都可从业务目录发现；runtime 与公共 sandboxd 的边界和文档一致。
- Python 镜像内不再从 sandboxd 路径承载 Factor / Research 的业务实现；运行仍受现有沙箱约束。
- shared 公开契约/渲染器位于对应业务 SDK 目录，现有消费者可正常解析；Factor TS 不再在前端维护另一套公开签名。
- 用户已有策略、因子源码和 Research Cell 不需要修改；HTTP、数据库和持久化代码快照不迁移。
- 生成物检查、类型检查、相关行为回归、构建、镜像打包/执行、部署影响规则和对应 E2E 全部通过。
- 风险重点是 Python import/namespace、镜像遗漏辅助文件、Research 提取后循环依赖/共享状态、
  TS 编辑器与执行签名漂移、编译后资源路径及后端边界规则；不得靠放宽隔离或整目录边界豁免解决。
- 如果发现必须改变公开 API、数值行为、数据语义、运行环境版本或安全边界，暂停相关实现，说明证据并修订计划；
  不把这些变化作为目录重构的隐含附带改动。
