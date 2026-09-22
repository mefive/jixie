# Research SDK 与运行时优化讨论计划

> 2026-09-22：整体方案已通过最终代码 review 和行为验证，统一宿主入口、TS transport、Factor 批量日志与 Strategy JSON 修复一并交付；最终实测结果见新方案文末。本文旧类名／适配器说明为历史讨论，实际接口见新方案及各目录 README。
> 最新状态：用户要求将三业务的历史入口、命名和调用方式整体规划。新的统一方案见 [Factor / Strategy / Research 运行时统一方案](sandbox-runtime-architecture.md)。
> 本文 R2 保留为问题讨论与前两版实现记录；后续目标结构、公共入口和迁移范围以新方案为准。前两版没有独立提交，已纳入最终统一方案，以下阶段状态均保留为历史记录。
> 2026-09-21：用户认为只统一薄基类仍难以阅读，批准收拢启动与执行消息循环；Factor 数据交互由实现者判断，保留预备输入。
> 遵循 review-gated-development：静态检查后交付 review，通过后再做行为验证和提交。R1 未纳入本次批准范围。

## 背景与目标

本轮沿 Research 作者 SDK、Python runtime、宿主数据交互理解当前实现。保持 Factor 的预备输入、Strategy 的动态请求与 Research 的批量探索各自的业务边界；统一宿主 runtime 的公共生命周期和调用结构，不改变三者的作者 SDK 契约。

当前优化目标是让 Research 宿主代码更直接表达业务职责，首先讨论 SDK response 的来源选择。后续发现继续补充到本文，经讨论确认范围后再进入开发；不把阅读中发现的所有问题自动纳入实现。

相关背景：[Research 工作台设计](reactive-quant-research-workbench.md)、[嵌入式分析设计](embedded-python-analysis.md)、[Research 阅读地图](../../apps/api/src/research/README.md)。

## 当前实现与业务含义

`data.*`、`results.*` 的 Python 作者接口调用注入的 `ResearchHost.request`，由 Python bridge 发出请求帧。API 进程中的会话管理器接收请求，交给宿主分派；`valuation.*` 和 `charts.*` 不经过宿主取数请求。

阅读入口：

- [Python SDK](../../apps/api/src/research/sdk/README.md)：作者接口、参数组装和 DataFrame 转换。
- [业务 runtime](../../apps/api/src/research/runtime/research-runtime.ts)：提供命令和业务结果解释；[公共 exchange](../../apps/api/src/infra/runtime/exchange.ts) 接收并分派消息；[会话管理](../../apps/api/src/research/runtime/pool.ts) 负责池和排队。
- [宿主分派](../../apps/api/src/research/runtime/host/dispatch.ts)：请求校验、observer、response 获取；发送归公共 exchange。
- [输入回放](../../apps/api/src/research/runtime/host/input-replay.ts)：读取来源、选择模式、授权和校验历史响应。
- [接续文档](../../apps/api/src/research/embedded/continuation.ts)：从成功嵌入分析创建普通 Research 文档。

`embeddedSource` 表示普通 Research 文档从哪次 Factor/Strategy 对话内嵌入式分析接续而来，不表示该文档将被嵌入其他业务。其 analysisId、versionId、runId 指向原分析及运行，inputMode 决定是否沿用原输入。

| 文档情况 | 当前行为 |
| --- | --- |
| 无 embeddedSource | 回放函数返回 undefined，进入当前数据服务 |
| 有来源，inputMode 为 current | 回放函数返回 undefined，进入当前数据服务 |
| 有来源，inputMode 为 retained | 根据方法和参数匹配原运行留存响应，验证后返回 |
| retained 来源不可用、请求不匹配、有歧义或校验失败 | 返回错误响应或抛异常，不回退当前数据 |

当前分派使用：

```typescript
const response =
  (await replayResearchInput(documentId, frame)) ??
  (await answerResearchRequest(documentId, request));
```

这里不是缓存未命中回源。`undefined` 表示应使用当前数据，retained 匹配失败并不返回 undefined。回放也会查询数据库中的执行和输入记录，只是不查询当前市场数据。

## 讨论项 R1：统一 response 获取入口

### 问题

分派调用方仍知道“先回放、再当前查询”的组合细节，而 `??` 容易被读成缓存回退。回放函数同时负责读取文档来源、判断模式、查找输入和校验响应，名称未完整表达其职责。

曾讨论把 inputMode 判断直接移到调用方。这样分支更明确，但会让协议分派层承担输入来源选择。当前倾向是由统一 response 获取入口封装来源选择，在该入口内部显式表达业务分支。

### 拟议职责（尚未实现）

```text
dispatchResearchRequest
  请求校验、observer 留痕、返回响应（公共 exchange 负责发送）
    ↓
resolveResearchResponse（暂定名称）
  读取并校验文档输入来源、选择 retained/current 路径
    ↓
历史响应回放 / 当前数据查询
```

调用方只表达“取得本次请求的响应”，不判断 embeddedSource 或 inputMode。来源读取集中在一处；回放函数消费已解析来源，避免为拆分职责重复查询文档。

保留 raw frame 与 parsed request 的区别：当前回放按原请求参数匹配历史留存，当前数据服务使用经过解析的参数。不能在重构时无意改成另一套参数哈希语义。

### 必须保持的约束

- retained 必须严格回放，失败不能静默查询当前数据。
- 原运行须成功，来源运行、版本、分析及用户归属校验不弱化。
- 相同方法和参数匹配多条记录时，响应哈希不同仍拒绝歧义；响应内容须通过 SHA-256 校验。
- 请求校验、observer.beforeRequest、observer.captureResponse 和 session.send 的顺序保持；响应持久化失败不得先发送给 Python。
- 区分可返回 Python 的业务错误响应与必须中止执行的技术／证据错误，不用统一 catch 掩盖边界。
- Python 作者 API、通信帧、数据列、PIT 与当前查询计算口径不因职责整理而变化。

### 待确认决策

- 统一入口的最终名称、签名、文件归属，以及与现有 dispatch 的依赖方向。
- raw frame 和 parsed request 如何显式传递，既保持回放匹配兼容，也避免参数职责模糊。
- 持久化 embeddedSource 的运行时校验方式。现有实现使用类型断言，并用“有来源且不是 current”进入回放；缺失或非法 inputMode 的拒绝属于需要明确确认的行为收紧，不作为无行为变化的重构悄悄加入。
- 文档不存在时的错误语义。当前可选读取会将其视为无来源；是否改变该行为须结合入口授权单独确认。

### 预计影响面

主要涉及 `research/runtime/host/dispatch.ts`、`input-replay.ts`、可能新增的 response 获取模块、对应测试及 host README。`runtime/pool.ts` 原则上继续调用宿主分派。

当前不计划更改 Python SDK Contract、生成 stub、Prisma schema、HTTP API、前端或部署组件。不涉及 Worker 迁移、数据缓存建设、全文 DAG 调度或 Python 会话重置语义。若后续发现必须改变上述边界，先更新并讨论计划。

## 讨论项 R2：统一 Python runtime 生命周期与调用结构

### 用户要求与设计判断

用户明确指出：业务流程可以不同，但共性流程不应使用不同的方法名和调用逻辑，导致跨模块对照困难；要求将薄基类方案写入开发计划，交由另一个会话执行。

目标是打开 Research、Strategy 或 Factor 任一 Python runtime 时，都能直接定位启动、执行、关闭；共同资源管理只实现一次。不是把所有业务强制改成相同的 Python compute 接口，也不是只改几个名字而保留隐藏的启动链路。

当前三者已共用 `infra/runtime/pool.ts` 的 PythonSession、sandboxd 和 `jixie_runner.py`。需要整理的是其上的宿主业务 runtime，不另造一套通信、容器管理或 Python 公共启动器。

### 重构前的代码入口（问题背景）

| 模块 | 现有入口 | 现有职责 |
| --- | --- | --- |
| 公共传输 | `apps/api/src/infra/runtime/pool.ts` | connect、帧编码、send/readValidated、abort/close |
| Research | `apps/api/src/research/runtime/pool.ts` | 文档会话池、获取队列、操作队列、启动握手、分析／执行／reset／interrupt |
| Strategy | `apps/api/src/strategy/runtime/strategy-runtime.ts` | createPythonStrategyRuntime 内连接、发 start，返回 strategy 和 close |
| Strategy 协议 | `apps/api/src/strategy/runtime/bridge.ts` | 等待 ready、逐 bar 交互；TS/Python 共用 |
| Factor 横截面 | `apps/api/src/factor/runtime/python/python-cross-sectional-factor-runtime.ts` | compilePythonCrossSectionalFactor 内启动，返回 computeBatch 和 dispose |
| Factor 资产类 | `apps/api/src/factor/runtime/python/python-asset-factor-runtime.ts` | time_series/panel 共用编译启动，返回 computeSeries 和 dispose |

重构前 Research 的 `execute → withEntry → acquireEntry → getOrCreate → connect/start/ready` 把启动动作藏在管理细节中。Strategy 和 Factor 生命周期较简单，不能照搬其短函数而删除 Research 必需的复用与并发控制。

### 目标结构

```text
业务所有者：Research 文档管理器 / Factor 计算宿主 / Strategy 任务执行器
    ↓
Research / Strategy / Factor 业务 runtime：start / execute / close
    ↓
公共 exchangeSandboxCommand：send → log / request-response → terminal result
    ↓
公共 PythonSession：连接和分帧；Strategy TS 使用独立 transport

PythonRuntime：只提供共同资源释放；startPythonRuntime：连接与启动失败清理

Research 文档会话管理器位于业务 runtime 外层：
    按 documentId 复用、容量淘汰、获取协调及操作排队
```

生命周期命名统一采用 `start / execute / close`。以下为目标调用形态，类名和类型参数由执行会话结合现有类型确定，不应将示意代码当作已存在接口：

```typescript
const runtime = await ResearchPythonRuntime.start(options);
try {
  await runtime.execute(input);
} finally {
  await runtime.close();
}
```

Strategy、Factor 使用相同的创建／执行／关闭结构，但输入、输出保留各自强类型。上述 finally 表示实例所有者的最终资源释放，不表示 Research 每运行一个 Cell 都关闭会话；普通 Research 仍由文档会话管理器跨 Cell 保留 runtime。

### 基类与业务边界

- 基类放在公共 Python runtime 基础设施中，只依赖通用传输和注入的类型／能力，不反向导入 Research、Strategy、Factor。
- 共同连接、启动失败清理和最终关闭由基类或其配套启动辅助统一拥有，close 统一同步、幂等释放 transport，abort(error) 立即中止并保留原因。既有协议没有关闭确认，不再保留“通知后立即关闭”和“等待通知后关闭”两套分支；正常关闭不承诺 Python finally 执行。业务启动入口显式可见地表达 connect → send startup → await ready，不能再隐藏在名为 getOrCreate 的长函数中。
- 业务提供启动帧及 ready 校验／元数据解释，保留现有 research_start、start、factor_start 及 runtime_version。统一宿主方法名不要求迁移通信协议。
- 启动和执行统一调用 `exchangeSandboxCommand`，各业务不再维护重复的读帧循环。公共入口只接收 command/schema/operation/onLog/onRequest/result，处理通用 log/request/error/fatal；取数请求的业务处理、日志预算、结果数量检查及 Research 执行错误仍归业务。
- `onBar`、`computeBatch`、`computeSeries`、`dispose` 等现有 Engine／Factor 消费接口可作为窄适配器保留，转调统一 runtime；不强制修改作者 SDK 或 TS Factor/Strategy 实现。
- Strategy 现有 bridge 同时服务 TS/Python，不能为了 Python 基类把 TS transport 耦合到 PythonSession，或复制一份逐 bar 协议。ready 等待的归属须在实现前明确，避免重复握手。
- Research 会话池与单个 runtime 分离。管理器保留获取协调和容量策略；操作排队只由一层拥有，避免 manager 和基类重复排队或死锁。单次操作读写期间的互斥必须保持。
- 保留各异步阶段必要的取消检查及中止监听。整理命名不是删除检查点；排队取消、启动取消、执行中断的连接清理和 pendingOperations 收尾都需要覆盖。

### 必须保持的行为

1. Research 文档间会话隔离、同文档 namespace 复用、4 个活动会话上限及仅淘汰空闲实例的规则不变。
2. Research analyze 仍可能按需启动会话；reset 仍清 namespace，不改成每次重启容器；普通 Python 执行错误与协议错误的保留／关闭策略不混同。
3. 嵌入分析每次独立执行，显式参数能力协商、环境捕获、输入 observer 的先保存后发送，以及结束关闭保持。
4. Factor 继续接收预备输入，Strategy 继续通过共享 bridge 与 Engine 交互，Research 继续动态请求 datasets；不统一三者的数据模型。
5. 启动中途失败必须释放连接；close、异常、取消的重复收尾不得泄漏会话或误关替代实例。
6. 现有返回结果、业务错误边界、日志上限、输出上限、超时与资源限制不变。Strategy 发送 response 失败直接传播，不再进入数据错误 catch 后二次发送；关闭统一同步释放，属于本轮明确的生命周期调整。

### 影响面与实施前需明确的事项

预计涉及公共 `infra/runtime/python`、三业务 Python runtime 及调用适配、Research 会话管理器、对应测试和 README。先检查全部调用方，尤其 FactorHost、Strategy 回测／扫描／Signals 的资源所有权，不能只调整文件内调用。

实现前明确基类 API、各业务实例 API、排队归属、关闭的同步／异步契约及 Strategy bridge 的 ready 消费位置。允许保留必要业务扩展方法（如 Research analyze/reset），不要为表面一致制造空方法。

本项默认不改 Prisma、HTTP API、Python SDK Contract、Python wire protocol、会话时限或 Worker 部署。若确需移动／增加 Python 镜像输入或改变跨包构建依赖，依根 CLAUDE.md 同步 Docker、部署影响清单及相应验证，并先说明扩展范围。

### R2 验收与交接要求

- 可读性：三个业务入口使用一致生命周期命名和顺序；Research 管理器不内嵌长启动握手；主要执行流程可顺序阅读，无大量抽象钩子跳转。
- 静态阶段：类型检查、相关 lint、生成契约一致性及后端边界静态扫描；先检查脚本，确保审查前不夹带行为测试。
- 用户代码 review 通过后：验证三业务握手成功／失败清理、业务执行和最终关闭；覆盖 Factor 横截面及 time_series/panel，验证 Strategy 共享 bridge 的 TS/Python 兼容。
- Research 回归：同文档排队、跨 Cell 变量、容量淘汰、reset、启动及执行取消、普通错误保留与协议错误关闭；嵌入参数协商、observer、独立运行及资源收尾。
- 优先使用现有 runtime/session/bridge 测试及有针对性的生命周期测试；仅在资源路径或打包变动时扩大容器验证。临时服务和进程验证后必须清理。
- 不将本次整理标记为修复全文拓扑执行、随机状态清理或页面会话失效提示；这些不在本项范围。

R2 本轮实现前已向用户明确的提交信息：

```text
refactor(runtime): unify sandbox command exchanges
```

## 后续 review 记录方式

新增讨论项分别记录：真实代码入口、业务问题、已讨论方向、待确认决策、兼容约束及验证方式。当前包含 R1、R2；此前阅读中涉及的其他实现限制不自动成为开发任务。用户本次交接直接针对 R2，不自动视为批准 R1 的待确认行为变更。

| 日期 | 讨论项 | 进展 |
| --- | --- | --- |
| 2026-09-21 | R1 | 明确 retained 不是缓存回退；倾向让分派只调用统一 response 获取入口，来源选择封装在内部。尚未批准实现。 |
| 2026-09-21 | R2 | 用户要求记录统一 runtime 生命周期与薄基类方向，由另一个会话承接执行；当前会话仅更新交接计划。 |

## 开发与验收安排（R2 已批准，R1 待批准）

采用 review-gated-development：当前会话已接手用户批准的 R2 扩展实现，先静态检查再交付 review；不重复索取已给予的范围授权。R1 与 R2 不必捆绑，R2 涉及三业务的完整一致范围不应任意拆成仅改 Research 的半成品。

R1 提交信息候选（未定稿，不作为提交授权）：

```text
refactor(research): encapsulate SDK response source selection
```

产品代码实现后，先完成静态检查并交给用户 review；review 通过后再执行行为验证。静态检查计划包括 diff 检查、相关 lint/typecheck 及后端依赖边界静态扫描；运行前检查组合命令，避免提前执行测试或业务流程。

R1 行为验证计划：

1. 普通文档和 current 接续文档进入当前 loader，不读取原运行输入。
2. retained 匹配成功返回原响应，当前 loader 不被调用。
3. 原运行不可用、用户或版本不匹配、参数不匹配、响应歧义及哈希损坏均不能回退。
4. 相同参数且相同响应的重复输入仍可回放；保留已有参数匹配规则。
5. observer 与发送顺序保持，输入留存失败不能被 Python try/except 转成成功。
6. 如果批准增加来源校验，覆盖非法 inputMode、损坏来源及不存在文档的明确行为。

优先扩展现有宿主分派测试，并按实际改动选择嵌入输入留存／接续集成测试。不为纯职责重排默认扩大为前端 E2E 或生产数据库验证。提交遵循仓库规则与届时明确授权，不自动 push。

## 最初计划交付记录（历史）

- 本文已补充 R2 开发交接方案；产品代码未修改。
- 未运行行为测试、构建、服务或数据库操作。
- 未提交；后续继续讨论并维护草案。


## R2 第一版执行记录（历史，2026-09-21）

- 用户已批准 Gate 1，准确提交信息：`refactor(runtime): unify Python runtime lifecycle`。
- 已实现公共 `infra/runtime/sandbox-runtime.ts` 薄基类和启动辅助；Research、Strategy、Factor 三业务都有明确 start/execute/close，现有消费者接口继续适配。
- Research `runtime/research-runtime.ts` 拥有单实例协议；`session.ts` 保留唯一操作队列、获取协调和四会话池。日志超限关闭实例后按身份移除；interrupt 保持立即关闭，不等待通知。
- Strategy ready 仍由共享 bridge 唯一消费，execute 委托既有逐 bar 协议；close 等待通知后关闭且复用关闭 Promise。Factor dispose 保持同步释放。
- 已核对 FactorHost、Strategy runtime/run、输入准备、Agent 校验和嵌入分析的释放责任，保留现有调用适配与 finally 收尾。
- 新增公共资源生命周期、Factor 三类型适配、Research 排队/取消/错误保留/日志超限替换测试；现有真实 Python 与 bridge 测试继续作为行为验收。
- 公开 SDK、HTTP、Prisma、Python 镜像输入与跨包构建依赖未变；不需迁移、部署清单变更或用户帮助/双语文案调整。
- 行为验证、构建和提交尚未执行；等待 Gate 2 人工代码 review。R1 仍未实现。

审查后验证范围：公共 session/runtime，Factor 横截面与资产类型，Strategy adapter/runtime 及共享 bridge/TS runtime，Research session/capabilities/lifecycle/host dispatch，以及嵌入分析 lifecycle/python 集成；执行 API 构建及后端边界自测。集成验证使用隔离测试数据库并清理进程，不操作生产数据。

静态检查结果：`pnpm typecheck` 全部 workspace 通过（包含生成契约一致性及后端边界静态扫描：794 个文件、0 违规）；本次 9 个 TypeScript 文件的 ESLint、Prettier check 及 `git diff --check` 均通过。新增文件仍未暂存，全部改动未提交。

## R2 第二版：统一命令交互（当前，2026-09-21）

用户批准当前会话接手。原薄基类版本只统一资源管理，execute 仍是抽象方法，三个业务仍各自读帧；本轮将验收目标改为“读懂一个公共循环后，业务只需理解输入、请求处理和输出”。

### 决策与可读入口

1. `infra/runtime/exchange.ts` 提供唯一 `exchangeSandboxCommand`。先发 command，消费 log，调用 onRequest 并发送其返回的 response，终止帧交给 result。schema 继续由各业务定义；generic error/fatal 直接抛错。
2. Factor 横截面与资产类、Research start/analyze/execute/reset、Strategy 共享 bridge 的 start/bar 都调用该入口。Strategy Python 的启动帧由 bridge 的 exchange 发送；TS transport 已 bootstrap 并排入 ready，只在该适配处省略启动 command。
3. Factor 仍使用预备输入，history 不改成跨桥取数。用户将“都发”的具体选择交给实现者后，选择统一计算命令发送与结果接收，不凭空增加宿主往返。
4. Research dispatch 现在返回完整 response，公共 exchange 负责发送；observer.beforeRequest → 参数解析 → retained/current 获取 → captureResponse 的顺序保留。R1 的 retained/current 来源选择仍原样，不借此改写输入回放规则。
5. 单 transport 同时只能有一个 exchange，重叠调用明确拒绝；公共层不新建队列，Research 队列保留在管理器。取消监听和资源中止仍归现有 owner，exchange 在异步边界检查 signal，避免取消后发送响应。
6. 三种 Python runtime 直接继承同一同步 close；abort(error) 立即中止并保留原因。删除两种通知关闭分支，Strategy 的旧 await close 调用仍合法。没有关闭 ACK，不宣称执行 Python finally 或等待 Python 进程退出。
7. Strategy shared bridge 继续同时服务 TS/Python，业务结果 commands 仍重放到 Engine；发送 response 的传输错误不再被当作数据错误重发。

示例（接口形态，实际业务帧见相应 runtime）：

```typescript
const value = await exchangeSandboxCommand(session, {
  command: { type: 'factor_compute_batch', items },
  schema: factorExecutionFrameSchema,
  operation: 'computing a cross-sectional Python Factor',
  onLog: (frame) => onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
  result: (frame) => frame.values,
});
```

### 影响与验证

- 改动限宿主公共运行设施、三业务 runtime、Research dispatch 返回边界、相关测试和阅读文档。Python SDK / runner / wire 帧、Prisma、HTTP、前端、镜像和跨 workspace 构建依赖不变，无数据库迁移或部署清单改动。
- 需重点 review：统一关闭语义；共享交换循环与 Strategy TS 的兼容；Research captureResponse 失败不能发送给 Python；公共并发保护不能引入第二层排队。
- 新增公共 exchange 测试：预备输入、日志、请求回复顺序、留痕失败、response 发送失败、取消、重复执行和并发拒绝；保留原 Factor 三类型、Research 生命周期与真实 Python、Strategy shared bridge 的回归测试。
- 修改 dispatch 测试直接覆盖真实 exchange + dispatch 组合，验证留痕先于 response 发送及留痕失败无响应；嵌入生命周期测试同步新的返回边界，不弱化输入证据断言。
- 静态检查：全仓 typecheck（含生成物一致性和边界静态扫描）、涉及 TS 文件的 ESLint/Prettier、git diff --check。
- 人工 review 后才运行已有验证范围中的单元／集成／真实 Python 和 TS isolate 测试、API 构建与边界自测；需要数据库时仅使用隔离测试库，验证后清理进程。
- 当前尚未运行行为测试、构建或提交。此前第一版的静态结果不能代替本版验收。

### 本版静态检查结果

- `pnpm typecheck` 全部 workspace 通过；包含生成 Contract 一致性、脚本类型检查和后端依赖边界静态扫描（796 个文件、0 违规）。
- 全部改动 TypeScript 文件的 ESLint 与 Prettier check 通过；测试 fixture 的泛型 mock 类型问题已修正并重新通过 typecheck 与 ESLint。
- `git diff --check` 通过；三业务 runtime 与 Strategy bridge 中已无独立的 `send/readValidated/while(true)` 消息循环。
- 改动均未提交；行为测试、构建、数据库及真实运行验证未执行，等待本版人工 review。
