# 业务 SDK 与运行时统一组织计划

状态：整体计划及三个提交的范围已获用户确认。提交 1 已获产品代码审查批准并通过约定验证，随本提交交付；
提交 2、3 尚未实施。范围确认不替代各提交的产品代码审查与行为验收。

## 目标与判断

统一 Strategy、Factor、Research 中 SDK、公开契约、语言运行时和沙箱基础设施的含义。
用户应能从任意业务模块找到脚本可用接口及其实现，维护者应能追踪契约如何进入编辑器、Agent、运行器和部署镜像。

技术上可以一次提交，但不建议：三个业务的运行模型和验收重点不同，合成大提交会增加审查与回归定位成本。
按三个可独立验证、可独立部署的业务闭环提交；每个提交同时交付实现、消费者迁移、生成物、打包、部署规则、测试及文档，
不拆成“先搬文件、以后修消费者”的不完整阶段。整个需求完成以三项全部验收为准。

## 当前状态与已有工作

| 业务 | 现状 | 本轮需解决的问题 |
| --- | --- | --- |
| Strategy | 已将 TS/Python SDK 放入 `apps/api/src/strategy/sdk`；Python runner 放入业务 runtime；TS 契约移入 shared/sdk/strategy | 已完成静态检查、修订版人工审查及本提交行为验证，随本提交交付 |
| Factor | TS SDK 位于 `factor/runtime/typescript/sdk.ts`；Python 公开类与执行循环混在 `apps/sandboxd/python/jixie_factor_runtime.py` | 分离 SDK 与 runtime；TS 编辑器声明仍在 `factor-editor.tsx` 手写，需要明确唯一来源 |
| Research | `research/sdk` 实际主要承担宿主协议、校验、分派和输入回放；Python 用户 API、AST 分析、Cell 执行及输出处理混在 sandboxd 文件 | SDK 目录恢复用户接口含义；业务 Python 归属 Research；会话与执行协议归 runtime |

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
   isolate 内的工厂注入仍由 runtime 负责，其签名/行为由契约与编译回归约束。
2. 从 `jixie_factor_runtime.py` 拆出 Factor 工厂、公开 Context、FactorBar 及相关 SDK 实现到 `factor/sdk/python.py`；
   源码加载、`jixie` 注入、消息循环及返回校验归 `factor/runtime/python/runner.py`。
3. Python 契约迁到 shared 对应目录，更新生成器和全部引用，生成的 `.pyi` 内容应保持一致。
4. 同步通用 runner 分派、Dockerfile、`.dockerignore`、部署影响清单和部署计划测试。
   所有新增 Factor Python 运行源文件同时影响 API 与 sandboxd；不得漏掉 SDK 辅助模块。
5. 同步模块 README、CLAUDE、架构和运行入口文档；移除旧 Python 业务文件与失效源码引用。

兼容边界：用户源码的 `defineFactor`、`defineFactorV2`、`from jixie import Factor` 等入口不变；
不改变窗口、字段口径、PIT、缺值、因子方向、结果长度校验、分析准入或错误传播。
不通过移动所有 Factor 存储/报告类型来制造 SDK 契约；仅收拢实际脚本公开表面。

审查前：全仓 typecheck/生成物一致性、边界静态扫描、相关 lint/format、Python AST 与路径/diff 检查。
审查后：TS 两类编译器、Python validator/Pyright、横截面及资产因子协议与执行回归、Strategy 因子输入/Engine 隔离回归；
验证 shared 声明与编辑器一致、原用户示例仍可用；部署计划和从镜像 COPY 清单组装的隔离 Python 打包测试；
相关构建与 Factor 编辑器/执行 E2E。现有测试覆盖不足时只补充本次边界和迁移风险所需用例。

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
