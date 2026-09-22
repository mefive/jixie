# Factor / Strategy / Research 运行时统一方案

> 状态：2026-09-22 用户已通过最终代码 review。统一宿主入口、TS transport、Factor 批量日志及 Strategy JSON 修复均完成验证：979 项回归、11 项 Python 通信、8 项编译 Worker、2 项 Strategy 性能用例，以及 API 构建和源码／编译资源验证通过。最终结果见文末；以下分轮记录中的“待 review／未验证”描述的是当时状态。
> 追加 review 修正已通过：StrategyRuntime.start 统一返回 StrategyRuntimeInstance，需要 metrics 的测试直接创建 TS 实例。补充验证 61 项运行时／隔离测试、2 项性能用例及 API 构建通过，详见文末。
> 2026-09-21：用户要求从历史演进形成的不同入口、名称和调用方式出发，统一规划三业务运行时。
> 同轮补充：TS 与 Python 一起纳入，采用语言无关的 SandboxRuntime 基类和共同启动流程；基类、协议循环、底层执行资源分别承担不同职责。
> 最新决定：移除 TS Factor 绕过公共 exchange 的直接执行路径，TS Factor / Strategy 共用 Infra TypeScriptTransport；替代前版“保留 TS Factor 直接调用”的方案。
> 本文取代 `research-runtime-review-plan.md` 中 R2 的局部生命周期整理方案；R1 的输入来源封装仍独立待讨论。
> 工作区原 R2 改动已纳入本轮整体迁移，按 `refactor(runtime): unify runtime contracts and entry points` 一并提交；实际验证与修复记录见文末。

## 先从使用处看目标

业务调用方只需识别同一组生命周期动词：**start → execute → close**。三业务的输入与结果保持各自的类型。

```typescript
// Internal host API; the author SDK remains unchanged.
const runtime = await FactorRuntime.start({
  language: 'python',
  analysisKind: 'cross_sectional',
  code,
  onUserLog,
});
try {
  const values = await runtime.execute({ items });
} finally {
  runtime.close();
}
```

Strategy 和 Research 的运行时也使用 `StrategyRuntime.start(options)` / `ResearchRuntime.start(options)`，以及实例的 `execute(input)` / `close()`。真实业务仍叫运行回测、评估因子、执行 Cell；运行时边界使用统一名称，不再通过 compile/create 等历史名称间接进入 start。

**统一实例契约、调用层次和启动/执行的命令交互流程。** Factor 的数值、Strategy 的引擎命令、Research 的文档输出不是同一种结果；文档会话池与一次任务持有的实例也不能用相同寿命管理。

## 迁移前的问题证据（历史快照）

| 当前入口 / 路径 | 当前问题 | 目标 |
| --- | --- | --- |
| `factor/runtime/python/cross-sectional.ts` 的 `compilePythonCrossSectionalFactor → CrossSectionalPythonRuntime.start` | compile 名称掩盖进程启动，又包装出 computeBatch/dispose | 调用方直接使用统一 FactorRuntime.start，返回 execute/close |
| `factor/runtime/python/asset-factor.ts` 的 time_series/panel 编译工厂 | 重复工厂与种类分支，返回接口与 Python 类不一致 | analysisKind 是启动选项，返回对应强类型实例 |
| `factor/runtime/typescript/compile-factor.ts`、`compile-asset-factor.ts` | CompiledFactor 等实际上是可执行的有资源对象；两种语言共用的宿主类型放在 TS 目录 | 公共宿主契约移到业务 runtime/contract.ts；TS 实现同样暴露生命周期 |
| `strategy/runtime/python/runtime.ts` 的 `createPythonStrategyRuntime → StrategyPythonRuntime.start` | 工厂仅转发；业务仍通过旧名启动 | 统一 StrategyRuntime.start 选择语言 |
| `runtime.strategy.onBar → runtime.execute → bridge.onBar → runStrategyBar` | Engine 接口混入 runtime / bridge，往返适配加重阅读负担 | Engine.onBar → runtime.execute → 共享策略协议执行 |
| `research/runtime/python/session.ts` | 文件名是 session，实际是文档会话池和排队；其他业务的 session 指低层连接 | 移到 research/runtime/pool.ts，显式命名 ResearchRuntimePool |
| 各业务消费者自行选择 Python/TS 工厂 | 语言与启动细节在评估、Engine、Agent、发布等处重复出现 | 每个业务一个公共启动入口拥有语言分派 |

下表记录规划时的旧结构，不能作为现有入口使用。本轮已迁移的生产调用方包括：Factor 评估、observations、publication、validate/inspect；Engine FactorHost；Strategy factor-inputs、runtime/run；Agent strategy profile；Research documents、dependencies、document-runs、embedded。

### 通信现状：不能把跨沙箱调用都当作同一种消息桥

| 实现 | 当前实际执行路径 | 可统一的部分 |
| --- | --- | --- |
| Python Factor | PythonSession 收发启动/计算帧，公共 exchange 等待终止帧；计算输入预先传入 | 生命周期、命令交互循环 |
| TS Factor | `IsolatedModule.callJson('meta' / 'computeBatch' / 'computeSeries', ...)` 直接跨 isolate 调用，返回 JSON；不经过公共 exchange | 本轮移除该业务执行路径，迁入公共生命周期和命令交互循环 |
| Python Strategy | PythonSession + 共享 Strategy bridge + exchange；done 后重放命令 | 生命周期、策略协议和命令交互循环 |
| TS Strategy | isolate transport + 同一 Strategy bridge + exchange，另有同步 `__hostAccess` 通道 | 生命周期和异步策略协议；保留同步调用语义 |
| Research | 当前仅 Python，PythonSession + exchange；执行期间处理 SDK request | 生命周期、命令交互循环；文档池管理复用 |

迁移前的 TS Factor 工厂可从基线提交 `4464a616` 查看；旧 Python 基类来自未提交的 R2 草案。现有实现入口为 [TS Factor runtime](../../apps/api/src/factor/runtime/typescript/typescript-factor-runtime.ts)、[TS transport](../../apps/api/src/infra/runtime/typescript/transport.ts)、[公共生命周期](../../apps/api/src/infra/runtime/sandbox-runtime.ts) 和 [公共 exchange](../../apps/api/src/infra/runtime/exchange.ts)。Infra README 已同步实际范围。

所有实现都具有“建立隔离环境 → 初始化 → 多次执行 → 释放”的共同流程。此次连同 TS Factor 的命令交互统一，批量计算命令本身可以经过公共 exchange，不必把批内每个 item 拆成一次通信。TS 的 isolate 和 Python 的 socket 是底层传输差异，不在业务 runtime 层保留另一套直接调用入口。Strategy TS 的同步上下文访问有作者 SDK 语义依据，仍作为受限通道保留；把它改成 async 会改变作者代码的调用处异常和取数时机。

## 分层与调用方向

```text
业务编排 / 资源所有者
  Factor 评估任务 / Engine FactorHost
  Strategy 回测任务
  Research 文档会话池 / 嵌入运行
         ↓
业务公共 runtime 入口与契约
  FactorRuntime.start / StrategyRuntime.start / ResearchRuntime.start
  instance.metadata / execute / close
         ↓
语言实现与业务协议
  Python 因子横截面 / 资产类实现，TS 因子实现
  Python / TS 策略实现，共享策略协议
  Python Research 实现
         ↓
公共运行设施
  SandboxRuntime：实例状态、执行入口、资源关闭
  startSandboxRuntime：启动过程与失败清理
  exchange：一条命令的消息交互
  PythonSession：连接与分帧
  TypeScriptTransport：isolate 命令收发与隔离，供 Factor / Strategy 共用
```

公共入口实际拥有语言/分析种类选择，返回语言实现的实例。它不额外创建只转发所有方法的 runtime 包装对象。语言实现按公共契约返回同形实例，不在工厂中先制造旧 Compiled 对象再包一层新实例。

内部语言实现统一采用“语言 + 业务 + Runtime”的命名顺序，例如 PythonStrategyRuntime / TypeScriptStrategyRuntime；Factor 两种计算形态分别为 PythonCrossSectionalFactorRuntime / PythonAssetFactorRuntime（TS 对应同形命名）。业务消费者只导入 FactorRuntime / StrategyRuntime 公共入口。Research 当前只有 Python，在公共 research-runtime.ts 直接实现宿主实例，不再保留一个只转发的 ResearchRuntime → ResearchPythonRuntime 包装层。

所有具体宿主运行时直接继承同一个 `SandboxRuntime`，包括 Python / TS Factor、Python / TS Strategy 和 ResearchRuntime。公共 FactorRuntime / StrategyRuntime 入口是选择实现的启动门面，不额外持有一份生命周期状态；ResearchRuntime 自身就是具体实现。

用这个语言无关基类替代当前 `PythonRuntime`，不建立 `SandboxRuntime → PythonRuntime → 业务 Runtime` 的继承链。Python 连接和 TS transport 通过组合使用；基类不依赖 PythonSession。启动/执行命令均经公共 exchange，TS Strategy 的同步上下文访问作为 transport 的受限扩展能力，由策略实现绑定和解除。

### 基类真正共享什么

| 位置 / 名称 | 统一职责 | 具体实现提供什么 |
| --- | --- | --- |
| `infra/runtime/sandbox-runtime.ts` 的 `SandboxRuntime` | 保存 metadata、管理关闭状态、实现公共 execute 与幂等 close；execute 首先检查实例可用，再调用统一的受保护方法 | `executeInSandbox(input, options?)` 和资源释放能力 |
| 同文件 `startSandboxRuntime` | 固定“创建资源 → 初始化 → 返回实例”；初始化失败清理已取得的资源 | `createResource`、`initialize` 两个具名操作 |
| `infra/runtime/exchange.ts` 的 `exchangeSandboxCommand` | 发命令、收日志、应答宿主请求、读取终止结果 | 消息 transport、schema、日志/请求处理、结果映射 |
| 业务具体 Runtime | 编码业务输入，调用 exchange，解释业务结果；保留具体错误语义 | Factor 数组、Strategy context、Research Cell 的对应处理 |
| 资源所有者 / ResearchRuntimePool | 决定实例寿命、复用和现有排队 | 任务 finally 或文档池策略 |

`SandboxRuntime.execute` 是有实现的方法，不是只把三个同名 abstract 方法放在空基类里。子类只实现 `executeInSandbox`，不再各自重写公共 execute/close。Research 的 analyze/reset 等扩展操作也通过基类的可用状态检查；interrupt 使实例进入同一关闭状态，并通过 Python 资源能力保留中止原因。基类不把每次用户代码异常都转换为关闭，避免破坏 Research 出错后继续使用 namespace 的行为。

`start` 是创建实例前的动作，不能仅靠实例基类中的 abstract 方法保证统一。因此每个具体实现的 `static start(options)` 都走同一个 `startSandboxRuntime`，且只声明创建资源和初始化两段职责。资源创建函数在成功返回前拥有半初始化资源并负责自身失败清理；返回后由公共启动函数接管，初始化成功才把所有权交给实例。取消监听继续由实际支持取消的资源适配负责，启动取消必须覆盖资源取得前后，不能只在最后检查 signal 而泄漏资源。

不再保留仅转发的 `startPythonRuntime`。公共启动函数与实例基类放在同一文件，阅读生命周期无需在多个 helper 文件之间跳转。资源创建只准备传输和受信任的沙箱入口；具体业务初始化均在 exchange 中发送启动命令、等待 ready 并校验 metadata。TS Strategy 也将目前 transport.start 里隐含的用户代码加载移到显式启动命令，不再先排入 ready 后省略 exchange.command。

目标调用形状如下，业务消费者无须进入语言目录才能理解生命周期：

```text
FactorRuntime.start / StrategyRuntime.start / ResearchRuntime.start
  → 选择具体实现（Research 无语言分派）
  → 具体实现.start → startSandboxRuntime
      → createResource → initialize → 返回继承 SandboxRuntime 的实例

runtime.execute(input)
  → SandboxRuntime.execute：检查可用
  → executeInSandbox：业务输入/协议/结果
      → exchangeSandboxCommand
          → PythonSession / TypeScriptTransport

runtime.close()
  → SandboxRuntime.close：标记关闭，只释放一次资源
```

## 公共生命周期契约

公共基类的签名如下，实际实现位于 `infra/runtime/sandbox-runtime.ts`；业务的 Input / Output / Metadata / Options 留在各自 `runtime/contract.ts`。以下是签名示意，不额外创建只重复基类的 interface 层。

```typescript
declare abstract class SandboxRuntime<Input, Output, Metadata, Options = undefined> {
  readonly metadata: Metadata;
  execute(input: Input, options?: Options): Promise<Output>;
  close(): void;

  protected assertOpen(): void;
  protected abstract executeInSandbox(input: Input, options?: Options): Promise<Output>;
}
```

- `start(options)`：唯一的对外实例创建入口。解析内部启动选项、选择实现、建立运行环境并完成初始化；收到 ready 且 metadata 校验通过后返回。失败时清理半初始化资源，不把半成品实例交给业务。
- `execute(input, options?)`：完成一次业务计算单元。内部可以有任意多次日志和宿主请求；收到本次终止帧后返回。普通执行错误与协议故障仍按各业务规则处理。
- `metadata`：显式区分启动元数据与可执行方法；Factor name/window/inputs、Strategy params/watch/factors、Research environment/capabilities 从这里访问，不散落到实例顶层。
- `close()`：同步发起资源释放并使实例不可再用，幂等；Python 断开连接或终止本地 runner，TS 释放 isolate。返回不保证远端进程退出或用户 finally 执行。既有协议无 shutdown ACK，不新增虚假的 graceful close 保证。
- 关闭后 execute 应明确拒绝；不能因为底层还有缓冲帧而返回旧结果。故障清理与重复 close 不得掩盖原异常。
- `abort(error)` 属于可中止资源能力：现有 Python / Research 取消路径继续立即中止并保留原因，不因表面一致向所有业务添加未实现的取消参数。
- 公共 start/execute 采用具名对象参数；参数字段按业务定义，不要求每个业务接收无用的 code、documentId 或 observer。
- 这次不新建通用任务调度器。公共 exchange 拒绝重叠读写，持有者负责现有串行顺序；Research 操作队列只保留一份。

## 三业务的明确契约

### Factor

对外一个 `FactorRuntime.start({ language, analysisKind, code, onUserLog? })`。使用重载或泛型映射保证 analysisKind 与 metadata / execute 入参相关联，不退化为 unknown、any 或一组随意可选字段。

| analysisKind | execute 入参 | 返回 | metadata |
| --- | --- | --- | --- |
| cross_sectional | `{ items: FactorBatchItem[] }` | `(number \| null)[]` | name、analysisKind、window、minCoverage |
| time_series / panel | `{ fields, indexes }` | `(number \| null)[]` | version、name、analysisKind、inputs、targetAssetClasses、window、outputScope、frequency |

横截面与资产类的内部计算实现保持分开：输入布局和校验不同，拆分有业务根据。公共入口统一语言选择和调用形态；外部不用记忆三组 Python 工厂与三组 TS 工厂。

FactorBatchItem、宿主 metadata 和 runtime 返回类型从 `runtime/typescript` 移到 `runtime/contract.ts`，不让 Python 实现依赖 TS 实现目录。作者 SDK Contract 仍是现有 shared 文件，不把宿主运行接口混入公开 SDK。

外部 `computeBatch(items)` 改为 `execute({ items })`，`computeSeries(fields, indexes)` 改为 `execute({ fields, indexes })`，`dispose()` 改为 `close()`。原 CompiledFactor/CompiledTimeSeriesFactor/CompiledPanelFactor 由对应 runtime 类型取代；迁移所有调用方和 fixture 后删除旧工厂、旧类型及别名。

预备输入、字段窗口、PIT、缺失值、批量顺序、结果长度校验和首次错误日志保持。history 不改成宿主查询，分析种类不改变每个 item / index 的计算语义。

### TS Factor 移除直接执行路径

两种语言采用同一组 Factor 命令/结果语义，公共协议归 `factor/runtime/protocol.ts`，不再只放在 python 目录：

```text
factor_start → factor_ready(metadata)
factor_compute_batch(items) → log* → factor_values(values, first_error)
factor_compute_series(fields, indexes) → log* → factor_values(values, first_error)
```

TS 在 `factor/runtime/typescript/sandbox-entry.ts` 加载作者定义、保留模块状态、分派上述命令并整批计算；通过 sandbox bundle 注入 SDK。Python 保留现有 runner。语言实现分别转换各自的作者字段格式和源码，不要求 TS 源码、Python 源码具有相同启动载荷，也不把 Python runtime_version 套到 TS 上。

从 Strategy 的 TypeScriptTransport 提取通用机制到 `infra/runtime/typescript/transport.ts`：创建 isolate、加载受信任入口、JSON 编解码、send/readValidated、接收队列、待处理读取、资源释放和诊断计数。Factor / Strategy 使用同一个实现，不复制一套 FactorTransport。业务命令分派归各自 sandbox-entry，Infra 不识别 factor_compute_batch、bar 或 EngineContext；资源限额和超时通过显式配置传入。

TypeScriptTransport 内部仍使用 isolated-vm 的调用原语，把启动/执行命令交给沙箱入口并接收帧；这是底层传输实现。业务 runtime 不再调用 `IsolatedModule.callJson('computeBatch' / 'computeSeries')`，也不能保留旧 Compiled 对象再在外面合成终止帧。所有终止结果、日志和失败均进入同一消息消费路径。

TS Strategy 的 response 发送必须能够在执行命令等待宿主数据时进入沙箱；send 不能等待整次执行结束，也不能把 response 排到阻塞中的执行之后。其同步访问能力仍经过已有 schema 和当前 context 绑定，Factor 不获得这个能力。startup/execute 都已有显式 command 后，移除 exchange.command 的可选启动特例。

迁移必须明确保留以下语义，并在 review 后验证：

- 整批跨边界，一次请求仍对应 items 数组或 fields/indexes，绝不改成每个标的一次消息；history/value/lag 仍在沙箱本地读取预备数组。
- TS Factor 现有 256 MiB 内存限制、作者模块求值 5 秒、批计算 30 秒继续独立配置；不能套用 Strategy 的 1024 MiB 和回调运行预算。
- 单点异常和非有限返回值仍产生 null；首次计算错误去重；普通日志顺序、启动日志、初始化错误与整批失败分别核对。
- 公共帧形状与数值结果校验共用；语言元数据归一化保持原有语义。当前 TS 的 minCoverage 归一化与 Python 严格 schema 有差异，不能直接套用 Python 校验器偷偷收紧 TS 作者契约。
- 帧/队列限额需结合现有 Factor 批量规模验证，不能直接搬 Strategy 限额后把原本可执行的批次截断或拆成逐项请求。实际耗时、传输量、日志负载和峰值内存与迁移前基线比较，不预先承诺零开销。

`loadIsolatedModule/callJson` 另有真实消费者 `agent/tools/analyze-sandbox.ts`，用于历史图表代码转换。本轮从 Factor 彻底移除这条依赖；该独立 Agent 工具不属于三业务 runtime 统一范围，不因 Factor 迁移误删仍使用的底层工具。文档必须标明剩余用途，不能把它宣传为 Factor 的第二条可选执行路径。

### Strategy

对外 `StrategyRuntime.start({ language, code, paramOverrides?, locale?, onUserLog? })`，只保留一个签名和实现，统一返回 `Promise<StrategyRuntimeInstance>`，提供 `metadata`、`execute({ context }): Promise<void>`、`close()`；context 的类型仍为 EngineContext，具名输入与其他业务一致。

`runtime/run.ts` 是 Engine 适配边界，构造 EngineStrategy：

```typescript
const runtime = await StrategyRuntime.start(options);
try {
  return await runStrategy({
    ...engineConfig,
    strategy: {
      ...runtime.metadata,
      onBar: (context) => runtime.execute({ context }),
    },
  });
} finally {
  runtime.close();
}
```

只保留这一处 Engine onBar 适配。runtime 不再暴露 strategy 对象；共享策略 bridge 也不再返回 EngineStrategy，而提供启动元数据和 execute 协议能力。其日志预算、历史同步状态和请求处理仍由同一个 bridge 实例拥有，TS/Python 共用。

Python 的 done.commands 仍在共享协议层重放到 EngineContext；TS 现有同步读取/命令的调用处异常、因子首次读取、缓存与 history_updates 都保持。execute 返回 void 的含义是本次策略行为已交给 Engine，不是交易必然成交。

Agent 的 Python 声明校验、TS inspectStrategyMetadata/Parameters 和正式回测都从统一入口启动并关闭。inspect 函数可以保留其实际提取职责，但不再成为一种特殊资源创建机制。TS transport metrics 属于诊断扩展，保留现有测试能力，不放进公共作者 SDK 或 StrategyRuntimeInstance；需要 metrics 的隔离测试和性能工具直接通过 TypeScriptStrategyRuntime.start 创建实例，公共 start 不为诊断暴露具体语言类型。

### Research

对外 `ResearchRuntime.start({ documentId, signal? })`，当前仅支持 Python，不添加虚构的 language 分支。metadata 为 `{ environment, capabilities }`。

`execute({ cell, parameters? }, options?)` 返回 `{ outputs, definitions, references, environmentFingerprint }`。options 保留现有 signal、observer、captureEnvironment；parameters 是本次执行输入，与运行控制选项分开。另保留有真实用途的 analyze(cells)、reset()、interrupt() 和活动 Cell 标识。

普通文档通过 `researchRuntimePool.withRuntime(documentId, operation, options?)` 获取并串行使用实例：

```typescript
return researchRuntimePool.withRuntime(
  cell.documentId,
  (runtime) => runtime.execute({ cell }),
);
```

池中没有实例时，池显式调用 `ResearchRuntime.start({ documentId, signal })`，有实例时复用。将现在 session.ts 的持有者逻辑搬到 runtime/pool.ts；不再用名为 session 的文件同时表达公共传输和文档调度。

池是资源所有者，Cell 调用方只在回调内借用实例，不得保存实例或自行 close。四会话容量、仅淘汰空闲实例、同文档操作队列、pendingOperations、实例身份检查和 acquire 期间协调保留。reset 只作用于已有会话；interrupt 立即关闭活动实例；归档/删除等显式 close 仍清理池条目。

嵌入分析继续以自己的内部文档 ID 使用相同能力，每次运行的初始化与最终关闭责任仍在 embedded 执行编排中，不让新公共入口意外把两次嵌入运行连成同一个 namespace。

## 什么名字要统一，什么名字应保留

| 名称 | 规则 |
| --- | --- |
| Runtime.start / execute / close | 实例创建、一次计算、资源释放，三业务一致 |
| SandboxRuntime / startSandboxRuntime | 所有语言共用的宿主实例基类 / 启动流程；不保留另一套 PythonRuntime / startPythonRuntime |
| executeInSandbox | 具体实现唯一的执行实现方法，供基类 execute 调用；不再分别叫 computeBatch、runBar、executeCell |
| exchangeSandboxCommand | 一次完整的消息交互；不与资源生命周期或 SDK 请求分派混用 |
| TypeScriptTransport | Infra 统一的 isolate 消息传输，Factor / Strategy 共用；不各自拥有一份通用传输实现 |
| compile / transpile | 只用于真实源码转换；不能把“启动进程并返回可执行对象”隐藏在 compile 后面 |
| Pool | 跨调用持有与复用实例；Research 的缓存、容量和排队可见 |
| Session / Transport | 低层连接与收发；不查业务数据库、不拥有文档生命周期 |
| SDK | 作者可调用的对象与方法；不因宿主内部改名修改 compute/on_bar/history |
| runConfiguredBacktest / runResearchCell / computeFactorSeries | 完整业务动作，保留业务含义；内部只通过公共 runtime 入口使用资源 |
| EngineStrategy.onBar / FactorExecutionPort.compute | 引擎内部端口，保留；与 runtime 的适配放在宿主适配边界 |

实际转发宿主 SDK 请求的模块保留 bridge / dispatch 的语义；runtime 不是 bridge 的别名。PythonSession 和 TypeScriptTransport 都满足 exchange 所需的 send/readValidated，底层分别采用 socket/本地子进程和 isolate。共用基类管理实例，exchange 管命令，transport 管传输，不让业务 runtime 绕过消息路径。

宿主业务公共入口、内部语言实现、真正的低层编译和原作者 SDK 不混用一套命名空间。禁止为保留历史名称又添加转发 barrel、别名工厂或默认导出。

## 目标文件归属与迁移清单

以下是设计目标，不是声称文件已经存在；最终代码必须在 README 和运行入口清单同步实际位置。

| 归属 | 目标与迁移 |
| --- | --- |
| `factor/runtime/factor-runtime.ts`、`contract.ts` | 公共 FactorRuntime.start、语言/种类分派和宿主强类型契约 |
| `factor/runtime/python/*`、`typescript/*` | 语言专属实现，启动和实例 API 按宿主契约整理；移除旧 compile/create 对外包装 |
| `factor/runtime/protocol.ts`、`typescript/sandbox-entry.ts`、`sandbox-bundle.ts` | 提升公共 Factor 帧契约；新增 TS 沙箱命令入口及 bundle，替代旧 meta/computeBatch/computeSeries 直接调用入口；清理不再使用的旧 SDK bundle 包装 |
| `strategy/runtime/strategy-runtime.ts`、`contract.ts` | 公共 StrategyRuntime.start 和宿主实例契约；runtime/run.ts 仅做任务资源持有与 Engine 适配 |
| `strategy/runtime/bridge.ts` | 共享策略协议、metadata 与 execute，不再构造 EngineStrategy |
| `research/runtime/research-runtime.ts`、`contract.ts`、`pool.ts` | research-runtime.ts 直接拥有 Research 宿主实例和 start；contract.ts 放宿主契约，pool.ts 管文档池；Python 业务 runner / SDK 归属不变 |
| `infra/runtime/sandbox-runtime.ts` | 新的语言无关 SandboxRuntime 与 startSandboxRuntime，替代 python/runtime.ts 的基类/启动 helper；共同生命周期测试同步迁移 |
| `infra/runtime/exchange.ts`、`python/session.ts`、`typescript/transport.ts` | 统一命令循环，保留 Python 收发机制，从 Strategy 提取公共 TS transport；移除隐式 ready 启动特例，不导入三业务 |
| `infra/runtime/typescript/isolate-run.ts` | 源码转换和 Agent 历史图表工具所需的底层能力继续保留；移除 Factor 对 loadIsolatedModule/callJson 的依赖，并修正用途说明 |
| Factor 消费者 | execution/cross-sectional、execution/run、所有 observations、publication、validate/inspect 改用公共契约；正常释放与错误路径一起迁移 |
| 跨业务消费者 | engine/adapters/factor-host、strategy/factor-inputs、agent/profiles/strategy；移除对具体语言 runtime 创建函数与 TS 专属类型文件的依赖 |
| Research 消费者 | dependencies、document-runs、embedded、documents、continuation、routes 的资源清理和所有测试 fixture 改用池/公共契约 |
| 文档与边界 | 更新各 runtime README、根 CLAUDE.md 中 Research session.ts 的定位、backend-runtime-entries、实际受影响的后端边界规则；不为方便移动整体放宽依赖限制 |

清点动态 import、new URL(import.meta.url)、isolate SDK 打包路径、Worker 资源路径和测试 mock，不能只依赖 TypeScript 编译通过。Python 源码和打包输入本轮默认不移动；若实际需要改变镜像输入或跨包构建关系，再同步部署影响清单及部署规划测试。

## 实施边界与不能顺手改变的行为

- 本轮覆盖 TS/Python 的宿主运行接口和所有直接消费者，完整迁移后删除旧接口，不以“先保留兼容壳”结束。
- TS Factor 保留源码转换、isolate 隔离和批量计算；宿主直接调用机制改为公共消息交互，不保留兼容旁路。
- Python Factor 的静态验证仍是静态验证；不能让 validate/inspect 因统一 start 而意外开始执行不可信源码。当前需要执行声明取得元数据的路径保留其隔离与 finally 释放。
- Python Strategy 的现有产品准入、TS 同步上下文能力、各语言实际差异保持；不借内部接口统一扩展 Signals、扫描、期货等支持范围。
- Research retained/current 选择、observer 顺序、错误分类、PIT、数据截止日、stale/DAG、代码/输入/结果快照规则保持；R1 来源封装不捆绑。
- HTTP、Prisma、作者 SDK、已有 Python 线协议和 runtime_version 保持。TS Factor 新增内部命令帧，TS Strategy 显式化内部启动命令；这些是本轮明确的内部协议迁移。没有数据库迁移，也不默认改前端帮助/双语内容。
- 公共继承只有一层 SandboxRuntime；具体实现负责业务执行，资源通过组合使用。不把语言、业务、分析种类各做一层基类，不增加只有转发的包装对象。

## 验收标准

**阅读验收**：从业务资源所有者打开代码，即可看到 Runtime.start、runtime.execute、runtime.close，或显式 Research pool 借用；无需先解释 compile/create/dispose 与这些方法的映射。公共类型不落在某一语言实现目录。向下一层查阅，所有具体实例都走 SandboxRuntime.execute/close 和 startSandboxRuntime，而不是只有公共方法同名、内部仍重复生命周期。业务差异集中在输入、metadata、结果、协议适配和实例持有周期。

**静态验收（人工代码 review 前）**：全仓 typecheck、生成契约一致性、后端边界静态扫描、相关 ESLint/Prettier/diff 检查；搜索旧创建函数、Compiled 类型、computeBatch/computeSeries/dispose 的宿主消费残留，区分真正的 SDK compute 与第三方 dispose。Factor 中不得残留 loadIsolatedModule/callJson 调用，Factor / Strategy 不再各自实现一份通用 TS transport。查验默认值、语言/版本验证、类型推断和资源 finally，不能靠大范围类型断言消除错误。

**行为验收（人工代码 review 后）**：

1. 公共基类和启动流程：不同资源的创建/初始化失败清理、关闭后拒绝执行、重复 close；子类不绕过公共入口。各支持语言及 Factor 三种 analysisKind：重复计算、metadata、输入到结果的顺序、错误与日志。
2. Factor 评估、observations、发布校验、策略因子准备与 FactorHost：TS/Python 均保持计算口径与资源所有权；静态验证路径不意外执行用户源码。
3. Strategy TS/Python：唯一 Engine onBar 适配、metadata、共享 bridge、宿主请求、命令重放、缓存、TS 同步调用处错误/首次因子读取及任务最终释放。
4. Research：跨 Cell 变量、同文档排队、容量淘汰、reset、普通错误保留、协议错误关闭、启动/排队/执行取消、活动标识、替代实例不被旧操作关闭。
5. 嵌入分析：独立运行、参数与能力协商、environment 捕获、observer 持久化先于 response、retained 回放与最终清理。
6. 构建及真实资源路径：API 构建、必要的 Worker/Python/TS isolate 集成验证；数据库仅使用隔离测试库，验证后清理进程。
7. TS 消息迁移：Factor 启动/整批计算/日志/错误均经 exchange；大批输入、畸形帧、结果数量不符、队列上限、执行中 close、内存/超时保护；Strategy 在异步等待期间能接收 response，显式启动与同步访问语义不回退。与迁移前对比横截面、带窗口横截面、资产序列及日志负载的批量性能与传输量。

本轮是一次完整的宿主契约迁移，不拆成仅改名称或仅改 Python 的交付。实现顺序可以按契约、实现、消费者推进，提交验收必须覆盖全部直接影响范围。

## 实现记录与代码审查（2026-09-22）

用户已确认本方案，并要求遵循 review-gated-development。准确提交信息已确定：`refactor(runtime): unify runtime contracts and entry points`。当前全部变更未提交，等待人工代码 review；通过后才运行行为验证和构建，验证通过按该信息提交。

已完成：

- 三业务入口及宿主 contract：FactorRuntime.start、StrategyRuntime.start、ResearchRuntime.start；实例 metadata / execute / close。具体实例直接继承 SandboxRuntime，共用 startSandboxRuntime；所有启动显式发送 command。
- TS Factor 新 sandbox-entry/bundle 与公共 TypeScriptTransport，整批计算通过 exchange；旧 compile 工厂、Compiled 类型及 computeBatch/computeSeries/dispose 消费接口已删除。Agent 历史图表所用 IsolatedModule 工具保留，与 Factor 执行分离。
- Strategy transport 抽取到 infra，bridge 返回 metadata/execute；runtime/run 保留唯一生产 Engine onBar 适配。参数与元数据检查迁至 inspect-definition，继续隔离执行声明并关闭。
- ResearchRuntimePool 只管理文档实例、容量、队列和身份清理；ResearchRuntime 管握手与协议。reset 未使用文档不会创建实例。普通用户执行错误保留 namespace，协议／传输故障移除实例；observer 仍先保存输入再由 exchange 发送 response。
- Factor 评估、观察序列、发布／定义检查、Engine FactorHost、Strategy 因子准备、Agent、Research 执行／提案／嵌入／资源清理，以及相关测试消费者同步迁移。Python 静态校验仍走 validator。
- README、运行入口清单与根 CLAUDE 的宿主归属已同步。没有新增包或跨包构建关系，Python 镜像输入、SDK、线协议与 runtime_version 均未改变；部署影响清单仍适用，部署规划测试更新为真实宿主路径。后端依赖规则未放宽。

### 审查入口与实现取舍

先读 [公共生命周期](../../apps/api/src/infra/runtime/sandbox-runtime.ts) 和 [公共 exchange](../../apps/api/src/infra/runtime/exchange.ts)，再横向对照 factor-runtime.ts、strategy-runtime.ts、research-runtime.ts 的 start 与 execute。Research 的借用入口见 [pool.ts](../../apps/api/src/research/runtime/pool.ts)；语言资源统一见 [TypeScriptTransport](../../apps/api/src/infra/runtime/typescript/transport.ts) 与 PythonSession。

TS Factor 保留 256 MiB isolate、声明 5 秒、整批 30 秒预算；新帧及累计队列限额也取 256 MiB，没有使用 Strategy 的一万帧上限。初版普通日志逐条经消息帧传出，后经性能验证和用户确认改为文末的沙箱内批量缓冲。启动日志仍在 start 期间消费（迁移前延迟到首次计算 drain），首次计算错误由终止帧回报并去重。这里有真实传输开销变化，需要性能验收；类型检查不能证明时序和性能一致。

Factor history/value/lag 仍只读取预备数组。Strategy 同步宿主访问、历史缓存及增量更新保留。Research retained/current、PIT、依赖/stale、快照与持久化语义没有纳入本次重构。

### 静态检查

全仓 `pnpm typecheck` 已通过：包括 shared/API/Web/Docs/sandboxd、SDK 生成物一致性和后端边界扫描（806 文件、0 violations）。所有变更 TS/MJS 的 Prettier 检查与 ESLint 均通过；已跟踪文件 git diff --check、新文件空白检查及变更 Markdown 的相对链接存在性检查通过。没有运行测试、构建、业务脚本或启动服务；没有查询或修改数据库。

### 已准备、尚未运行的行为验证

- 公共 lifecycle/exchange/transport 测试：启动失败／取消、幂等关闭、执行中关闭、请求等待期间应答、畸形帧、超时、内存和队列／帧限额。
- Factor 两语言三种 analysisKind、SDK 窗口与输入、批量顺序／状态、数量不符、启动及计算日志；TS lifecycle 用例包含 10,000 项整批命令检查。评估、观察数据、发布校验及 FactorHost 的消费者测试随接口迁移。
- Strategy 共享 bridge、同步访问、缓存、参数检查、两语言回测和因子隔离；Research 跨 Cell 变量、reset、排队／取消、能力协商、保留普通错误后的会话及嵌入 observer／留存回放。
- TS Factor 性能 harness：`factor/runtime/typescript/runtime-benchmark.test-worker.mjs`，分别以 `before/shared` 与 `cross_sectional/windowed/asset_series/logs` 启动独立子进程。旧工厂固定读取 `4464a616`，测试内临时适配仅用于历史对照；比较结果哈希、日志数、启动／执行／关闭耗时、峰值内存及逻辑载荷字节，新 transport 另记录实际帧字节。TS Strategy 既有性能 harness 已迁移当前入口，历史版本对照保持。
- review 后运行相关集成测试、部署规划测试、API 构建及源码／编译资源路径验证；涉及数据库的用例使用隔离库，结束清理进程。

### 代码审查反馈：统一文件命名（2026-09-22）

用户要求从文件名直接辨认 runtime 的业务与语言，已按下列规则重命名，静态 start 工厂及执行逻辑保持：

- 公共基类：`infra/runtime/sandbox-runtime.ts`。
- 业务入口：`factor/runtime/factor-runtime.ts`、`strategy/runtime/strategy-runtime.ts`、`research/runtime/research-runtime.ts`。
- Python 实现：`python-cross-sectional-factor-runtime.ts`、`python-asset-factor-runtime.ts`、`python-strategy-runtime.ts`。
- TypeScript 实现：`typescript-factor-runtime.ts`、`typescript-strategy-runtime.ts`；Factor 现有两个具体类仍在同一文件。
- 对应测试文件同步采用具体 runtime 名；导入、测试 mock、README、运行入口清单和部署规划测试同步更新。历史性能基线仍按其原始提交路径读取。

引用审查同时修正了 Signals／Strategy 路由测试中元数据检查的旧 mock 目标，指向现有 `inspect-definition.ts`。本轮只改文件命名与引用，不新增兼容转发文件，不改变语言、业务协议、资源预算或数据语义。提交信息仍为 `refactor(runtime): unify runtime contracts and entry points`；行为验证、构建和提交仍等待代码 review。

本轮重命名静态验收：全仓 typecheck、SDK 生成物一致性、后端边界扫描（0 violations）、相关 Prettier／ESLint、diff 与 Markdown 链接检查通过；22 个产品 TS 文件的静态 token 对比确认仅模块路径变化。未运行行为测试或构建，全部改动仍未提交、等待人工代码 review。

### 首轮行为验证与补充修复（2026-09-22）

用户确认代码 review 后已开始验证，提交信息仍为 `refactor(runtime): unify runtime contracts and entry points`。以下是**修复前版本**的实际结果，不表示修正版已通过行为验收：

- shared 构建通过；部署规划与后端边界检查器自测共 39 项通过。
- 公共运行设施及三业务 runtime 首轮覆盖 37 个测试文件、192 项：170 项通过、22 项失败，并出现 1 次未处理拒绝。失败拆分为 TS Factor 协议拒绝断言 1 项、Strategy bundle 旧名称断言 1 项、Python socket 权限限制 11 项、Research 冷启动超时 9 项；未处理拒绝来自超时后的测试清理。
- Unix socket 测试在默认沙箱中因 `listen EPERM` 失败；获准放宽限制后重跑，11 项全部通过。
- Research 测试在默认缓存目录不可写时，每个 Python 进程重复初始化 matplotlib 字体缓存，超过 5 秒测试预算。设置 `MPLCONFIGDIR=/tmp/jixie-runtime-matplotlib` 与 60 秒测试预算后，pool 16 项全部通过，且无未处理拒绝。首次初始化约 7.9 秒，后续普通会话约 0.36–0.44 秒；4 会话容量用例约 1.54 秒。这是验证环境修正，没有更改产品超时或 Python 代码。

本次补充修复：

1. 产品改动仅在 [Factor sandbox-entry.ts](../../apps/api/src/factor/runtime/typescript/sandbox-entry.ts)：将两种定义函数同时注入，恢复为按启动 `analysis_kind` 注入对应函数。横截面仅注入 `defineFactor`，time_series/panel 仅注入 `defineFactorV2`。旧实现原本区分该边界；统一入口不能让横截面接受 V2 源码。
2. [Factor 定义校验测试](../../apps/api/src/factor/runtime/validate-definition.test.ts) 将同一用例中的串联断言拆成 6 个独立的交叉类型拒绝用例，覆盖三种分析类型之间的双向误配，避免第一个断言失败遮住后续回归。
3. [Strategy bundle 测试](../../apps/api/src/strategy/runtime/typescript/sandbox-bundle.test.ts) 改为检查已批准的统一 `__receiveCommand` 入口；SDK 依赖边界及禁止宿主导入的断言保留。

按 review-gated-development，产品修复后只执行静态检查，修正版行为测试尚未重跑。三业务消费者与嵌入集成、API 构建、源码／编译资源路径和性能比较仍待完成；不能据上述部分通过结果提交。首轮 Vitest 与 Python 测试进程已退出，无遗留临时服务。

补充修复静态验收已通过：全仓 typecheck、SDK 生成物一致性、后端边界扫描（806 文件、0 violations）、3 个修复 TS 文件的 Prettier／ESLint、git diff --check 与更新文档的相对链接检查。

验证日志：`/tmp/jixie-runtime-core-tests.log`、`/tmp/jixie-runtime-python-socket-tests.log`、`/tmp/jixie-runtime-research-pool-tests.log`、`/tmp/jixie-runtime-deploy-boundaries.log`。补充修复的静态检查记录于 `/tmp/jixie-runtime-repair-typecheck.log` 与 `/tmp/jixie-runtime-repair-eslint.log`。

### 第二轮验证与 Strategy JSON 修复（2026-09-22）

用户确认 Factor 补充修复后完成下列验证；本节数值均来自**去除重复 JSON 转换之前**，不能作为该修复的验收结果。

- 相关业务回归覆盖 Infra runtime、Factor、Strategy、Research、Engine、Signals、Agent profiles 和源码 Worker：159 个文件、965 项通过。账户账务的独立数据库流程测试需要 `ACCOUNTING_INTEGRATION=1`，本轮未启用（1 项跳过）；它不覆盖本次改动，Signals 路由与真实 Worker 已验证。上一轮的 11 项 Unix socket 测试不因这次 Factor 修复重复执行。
- 旧 API dist 已移至独立临时备份，`pnpm --filter api build` 从空目录生成产物并通过。编译模式真实回测 Worker、扫描 cell 子进程、Signals 子进程共 8 项通过，涵盖两语言策略／因子组合，并等待进程正常退出。
- 源码与编译模式各运行 7 组资源 smoke：Factor 两语言 × 三类分析；Research 在隔离 SQLite fixture 中实际经过 Cell → SDK → bridge → 宿主 loader → 数据库查询 → 图表输出，验证 observer 顺序、参数、跨 Cell 变量、普通错误后继续执行与 reset。临时数据库已断开并清理，未操作真实数据。
- 初版临时 smoke 缺少 SQLite 空文件初始化，且误用 Python Factor 未公开的 `bar.close`；按现有测试 fixture 和 SDK 改为初始化空文件、使用 `pe_ttm/peTtm` 后两种模式通过。只修测试工具，没有更改产品数据字段。
- Strategy 性能工具修复了旧 SDK 路径；旧 `before` 对照继续固定 `04f62a16` runtime/bridge，新增 `previous` 固定本次重构前的 `4464a616` runtime/bridge。两者的 sandbox-entry 固定为 `4464a616`，避免误加载已删除旧全局入口的当前 bundle。当前 SDK／Engine fixture 保持一致，属于受控架构对照，不是整个历史仓库的复现。两个性能用例的 NAV／成交哈希及传输量断言通过。

#### Factor 性能结果

每个变体独立进程，1 次冷启动、2 次预热、5 次测量；下表为 execute 中位数，普通场景每批 50,000 项，日志场景每批 10,000 项。每种场景的结果哈希及日志数量一致。

| 场景 | 重构前 | 统一消息入口 | 新 transport 记录的总传输量 |
| --- | ---: | ---: | ---: |
| 横截面 | 13.72 ms | 15.12 ms | 1,485,362 字节 |
| 带窗口横截面 | 52.28 ms | 54.66 ms | 8,616,826 字节 |
| 资产序列 | 14.85 ms | 16.37 ms | 1,671,830 字节 |
| 10,000 条日志 | 6.84 ms | 103.71 ms | 774,503 字节 |

普通批量计算增加约 1–2.4 ms；日志密集场景明显变慢，因为当时每条日志逐条跨桥，记录到 10,002 个接收帧（启动、结果各一个）。后续用户确认采用下节的批量日志方案，上述数字是优化前对照；没有改成逐个因子值跨桥。旧实现未记录等价 wire 指标，不能把逻辑载荷字节冒充旧传输量。

#### Strategy 性能发现与修复

`watch` 为 100 个标的、120 个时点，`dynamic` 为 300 个候选标的、252 个时点。测量运行总耗时中位数如下：

| 场景 | 重构前 `4464a616` | 修复前统一入口 | 耗时变化 | 两者传输字节 |
| --- | ---: | ---: | ---: | --- |
| watch | 100.72 ms | 132.92 ms | +32% | 9,815,279 → 9,818,414 |
| dynamic | 479.19 ms | 671.21 ms | +40% | 50,267,488 → 50,274,055 |

结果哈希一致、消息数量仅新增一个显式启动帧，但耗时明显增加。源码发现：`__receiveCommand` 已解析 frame，随后 start/bar 分支再次 stringify，内部函数又 parse；response 分支也重复 parse。这个转换不是统一协议所必需。

产品修复仅在 [Strategy sandbox-entry.ts](../../apps/api/src/strategy/runtime/typescript/sandbox-entry.ts)：`startStrategy`、`runStrategyBar`、`receiveResponse` 接收已解析对象，入口解析一次后直接分派。增加本地参数类型描述原有 snapshot/response 形状；不改变线格式、SDK、数据拷贝边界、缓存或交易行为。统一 `__receiveCommand`、公共 transport/exchange 继续保留。性能改善幅度须经补充 review 后实测，不以源码推断代替结果。

修复后遵循 review-gated-development，仅运行静态检查；等待补充 review 后复跑受影响的 Strategy／Engine 因子组合、源码 Worker、性能对照，重新构建并验证编译 Worker。已通过且未受这次修复影响的 Factor／Research 验证不必重复。提交信息保持 `refactor(runtime): unify runtime contracts and entry points`。

本次修复静态验收通过：全仓 typecheck、生成契约一致性、后端边界（0 violations）、受影响 TS/MJS 的 Prettier／ESLint 及 diff 检查。日志为 `/tmp/jixie-runtime-json-repair-typecheck.log`、`/tmp/jixie-runtime-json-repair-eslint.log`。已确认本轮 Vitest、Python 和性能子进程全部退出。

证据：`/tmp/jixie-runtime-verification-tests.log`、`/tmp/jixie-runtime-api-build.log`、`/tmp/jixie-runtime-compiled-worker-tests.log`、`/tmp/jixie-runtime-{source,compiled}-smoke.log`、`/tmp/jixie-runtime-benchmarks/`、`/tmp/jixie-runtime-strategy-benchmarks.log`。临时资源 smoke 脚本为 `/tmp/jixie-runtime-resource-smoke.mjs`。

### 用户确认的批量日志方案（2026-09-22）

用户确认在沙箱内攒一批日志后跨桥发送。本次纳入同一个完整运行时重构提交，提交信息仍为 `refactor(runtime): unify runtime contracts and entry points`。

实现：

- [infra/runtime/log-buffer.ts](../../apps/api/src/infra/runtime/log-buffer.ts) 提供纯 `SandboxLogBuffer`。console 调用时立即格式化为级别和文本并序列化单条记录，避免延迟读取可变对象；缓冲最多 256 条，或不超过 64 KiB 的实际 UTF-8 JSON 包（包括字段、逗号和包络），到达阈值即发送。没有计时器或新增异步执行机制。
- 使用 `{ type: 'log_batch', entries: [{ level, text }, ...] }` 公共日志帧。Infra protocol 定义形状和条数上限，公共 exchange 在 schema 校验之后逐条交给现有 onLog，等待回调、维持顺序并检查取消；回调异常仍直接传播，不吞掉。
- TS Factor 的三类 runtime 启动／执行 schema 接受 log_batch；SDK／命令／计算结果保持原形状。沙箱入口在正常返回结果前刷新尾部，普通命令异常时尽力刷新并保留原异常。逐点计算异常仍按原逻辑返回 null，日志先于结果中的首次计算错误；启动日志不留到首次 execute。
- 单条日志若超过批量阈值，先刷新前面的队列，再使用既有 log 帧单独发送；不拆行、不截断，继续受既有传输预算限制。没有把批量阈值变成新的单条长度限制，也没有套用 Strategy 的日志条数截断政策。
- 公共接收能力可供其他业务复用；本次发送端调整针对实际出现回归的 TS Factor。Strategy／Python 的日志发送方式、Python wire/runtime_version、SDK 签名、Prisma 与前端均未改变，无数据库迁移或生成契约更新。新增 TS 纯模块由 API tsc 构建，并进入 Factor 的 SDK bundle；不进入 Python 镜像，也没有 workspace／跨包构建关系变化。

取舍：日志显示可能延迟到阈值或命令结束。普通异常刷新是 best-effort；强制终止、超时、内存限制和传输故障可能丢失尚未交付的尾部日志，不能承诺用户 finally 一定执行。缓冲发生在跨桥之前，宿主已有的传输队列不承担这一优化职责。

已准备的行为验证（尚未运行）：缓冲数量／UTF-8 字节上限（中文、emoji、转义与孤立 surrogate）、大单条与前后日志顺序、空刷新／失败不重复发送；公共循环混合 log/log_batch、回调失败与取消；Factor 10,000 条日志应形成 40 批且无丢失／跨命令重复，启动异常和逐点错误日志；源码／编译 bundle 的纯依赖边界。复测 Factor 四种性能场景与 Strategy 两场景，记录新旧结果哈希、日志数、传输量和耗时，重新构建并验证 Worker／资源路径。共同 exchange 改动需带上 Python／Research 的相关回归。

当前实现未经本轮行为测试或构建，不把预计的 40 次批量跨桥或性能改善当作已测结果。按 review-gated-development，完成静态检查后交付补充代码 review，再统一运行上述验证；全部通过后提交。

静态验收已通过：全仓 typecheck、生成物一致性、后端边界（808 文件、0 violations）、受影响文件的 Prettier／ESLint、diff／新文件空白检查与更新文档的链接检查。记录在 `/tmp/jixie-runtime-log-batch-typecheck.log`、`/tmp/jixie-runtime-log-batch-eslint.log`、`/tmp/jixie-runtime-log-batch-format.log`。全部改动仍未提交，等待人工代码 review。

### 最终 review 后验证（2026-09-22）

用户确认补充代码 review 后，执行完整约定验证，无需再改产品代码或测试代码。

- 新增日志与相关 TS 运行时用例先通过 66 项，随后完整回归通过 160 个文件、979 项测试，覆盖三业务、Engine、Signals、Agent 及源码 Worker。另有 1 项既有账户对账集成用例因未启用 `ACCOUNTING_INTEGRATION=1` 跳过；本次没有修改账户对账，不将该用例列为已通过。
- Python 临时 Unix socket 通信用例 11 项通过；该组使用沙箱外本地 socket 权限运行。Matplotlib 使用可写临时缓存，避免首次字体缓存建设触发默认超时。
- API 重新构建通过；编译后的回测 Worker、扫描 cell 和 Signals 子进程用例 8 项通过。源码与编译资源 smoke 各通过 7 组：Factor 两语言 × 三种计算形态，以及 Research 真实临时 SQLite 查询 → observer → 图表、跨 Cell 状态、普通错误后复用和 reset。所有数据库验证使用独立临时 fixture。
- 日志验证确认一万条日志形成 40 个 `log_batch`，加启动与结果共 42 个接收帧；日志数量、顺序、级别及结果保持一致，没有跨命令重复。UTF-8 字节阈值、超大单条、空刷新、回调失败、取消、启动错误和逐点错误均有通过的用例。
- Strategy 两个性能用例通过，各历史变体及本轮实现的 NAV／成交哈希一致；既有动态历史增量传输断言继续通过。

#### Factor 最终性能

沿用上文固定旧提交、独立进程、1 次冷启动、2 次预热、5 次测量；以下为本轮 execute 中位数。各场景所有样本的计算结果哈希及日志数量一致。

| 场景 | 旧实现 `4464a616` | 最终统一入口 | 最终接收帧数 | 最终总传输字节 |
| --- | ---: | ---: | ---: | ---: |
| 横截面 | 13.82 ms | 14.92 ms | 2 | 1,485,362 |
| 带窗口横截面 | 57.40 ms | 52.84 ms | 2 | 8,616,826 |
| 资产序列 | 15.04 ms | 17.02 ms | 2 | 1,671,830 |
| 10,000 条日志 | 6.89 ms | 12.91 ms | 42 | 655,783 |

上一轮逐条跨桥的日志场景为 103.71 ms、10,002 个接收帧、774,503 字节；批量后降至 12.91 ms、42 帧、655,783 字节。它消除了主要回退，但仍比本轮旧批量 drain 路径慢约 6 ms，不能宣称没有任何架构开销。缓冲序列化、统一帧校验与逐条宿主回调仍存在。各轮时钟结果会受运行环境影响，不把单次窗口场景更快解释为稳定收益。

#### Strategy 最终性能

同一轮重新测量重构前 `previous` 与最终 `shared`；watch 采用 10 个测量样本，dynamic 采用 5 个，均另有冷启动和预热。下表为含创建、执行、关闭的总耗时中位数，与上文 Strategy 表口径一致。

| 场景 | 旧实现 `4464a616` | 最终统一入口 | 总传输字节（旧 → 新） |
| --- | ---: | ---: | --- |
| watch | 104.82 ms | 104.63 ms | 9,815,279 → 9,818,414 |
| dynamic | 521.64 ms | 492.97 ms | 50,267,488 → 50,274,055 |

去除重复 JSON 转换后，本轮没有重现此前约 32%／40% 的明显回退；不将 dynamic 的小幅领先承诺为稳定加速。新增显式启动帧仍解释传输字节和发送帧数的微增，SDK 数据、缓存及交易语义不变。

本轮证据：`/tmp/jixie-runtime-batching-focused-tests.log`、`/tmp/jixie-runtime-final-regressions.log`、`/tmp/jixie-runtime-final-python-session.log`、`/tmp/jixie-runtime-final-api-build.log`、`/tmp/jixie-runtime-final-compiled-workers.log`、`/tmp/jixie-runtime-final-{source,compiled}-smoke.log`、`/tmp/jixie-runtime-final-strategy-benchmarks.log`；逐样本原始数据在 `/tmp/jixie-runtime-final-benchmarks/`。提交范围包含统一架构、已审查修复、测试和本记录；R1 retained/current response 来源封装继续留在讨论计划中，不纳入本次。

最终差异空白检查及更新文档的相对链接检查通过；临时 benchmark 目录已清理，进程检查确认没有本轮 Vitest、Python runner、性能 worker 或资源 smoke 遗留。未启动持久测试服务。此次提交不包含数据库、临时验证产物或环境配置。

### 追加 review：收敛 Strategy 公共返回类型

用户明确要求将此修改并入当前 runtime 统一任务，提交信息保持 `refactor(runtime): unify runtime contracts and entry points`。已提交版本为 `70c124d7`；本节记录其后的 review 修正，不另立重构任务。

- StrategyRuntime.start 删除仅为 TypeScript metrics 暴露具体类的重载，只留下 `start(options: StrategyStartOptions): Promise<StrategyRuntimeInstance>` 的实现签名；语言分派表达式保持不变。
- `typescript/isolation.test.ts` 中读取 metrics 的 execute helper，以及 `typescript/runtime-benchmark.test-worker.mjs` 的当前实现变体直接使用 TypeScriptStrategyRuntime.start。保留 metrics 实现、全部统计断言与历史对照。隔离测试中不读取 metrics 的关闭用例仍使用公共入口。
- 生产业务继续使用 StrategyRuntime.start；不增加类型断言、兼容包装或 Python metrics。公共宿主类型收敛，不改变启动、执行、关闭、作者 SDK、通信协议、数据库或部署依赖关系。
- 同步 Strategy runtime README、TS runtime README 和本方案，明确业务公共入口与实现专属诊断的边界。静态验收后交付补充 review，批准后复跑 Strategy 运行时／隔离回归、两种性能场景并构建 API；此次类型整理不重复运行未受影响的 Factor／Research 全量验证。

静态验收通过：全仓 typecheck（含生成物一致性、808 文件的后端边界扫描，0 violations）、三个修改代码文件的 ESLint／Prettier、git diff --check 及更新文档相对链接检查。类型检查日志为 `/tmp/jixie-strategy-runtime-return-typecheck.log`。

用户确认补充 review 后，Strategy runtime 的 12 个测试文件、61 项测试全部通过，包含两语言运行、共享 bridge、隔离、缓存／通信统计、声明检查与关闭行为。watch／dynamic 两个性能用例通过，所有历史变体与当前实现的结果哈希一致，动态历史增量的传输量断言仍通过；API 构建通过。本轮没有追加产品或测试修复。

当前实现的总耗时中位数为 watch 102.52 ms、dynamic 492.01 ms；传输量分别仍为 9,818,414 和 50,274,055 字节，帧数及同步调用统计与上轮一致。更换诊断测试的创建入口后，统计能力保持完整；时钟样本不用于宣称此次类型整理带来加速。日志为 `/tmp/jixie-strategy-runtime-return-tests.log`、`/tmp/jixie-strategy-runtime-return-benchmarks.log`、`/tmp/jixie-strategy-runtime-return-build.log`。
