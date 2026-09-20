# Python 策略运行时与沙箱（决策文档）

## 2026-09-18：统一策略与因子执行边界（验证完成）

本轮按 review-gated-development 执行三个提交；每个提交先确认范围，实现后只做静态检查，
人工 review 通过再跑行为验证，全部通过后提交。此节取代下文历史的“TS 因子跟随 Engine 执行”决定；
三个提交均已完成实现与验证；第三提交将 Engine 移回宿主，并通过批量历史与增量传输消除初版的主要性能回退。

| 提交 | 信息 | 状态 |
| --- | --- | --- |
| 1 | `fix(sandbox): isolate custom factors across strategy languages` | 已提交 `a7671356`；人工 review、静态检查、测试、构建及 Worker 验证通过 |
| 2 | `refactor(strategy): extract a shared sandbox bridge` | 已提交 `f276bfbd`；人工 review、静态检查、测试、构建及 Worker 验证通过 |
| 3 | `refactor(strategy): run both language runtimes through the host engine` | 人工复审、静态检查、回归、构建、源码/编译 Worker、基准及五项 E2E 通过 |

### 第一提交：因子执行独立于策略语言

原问题：TS 策略的 TS 因子跟随 Engine 在 isolate 中运行；Python 策略的 TS 因子却跟随
Engine 在 Node Worker 中以 `new Function` 直接运行。模块通过编译检查不能替代实际计算隔离。

当前实现：

- `engine/factors/execution-port.ts` 定义独立的 `FactorExecutionPort`（描述与批量计算），不再将计算
  塞入 `EngineDataPort.pythonFactorCompute`。Engine 不加载或直接调用用户因子函数。
- `engine/adapters/factor-host.ts` 的 `FactorHost` 在一次运行内持有冻结依赖，复用 Factor 模块已有的
  TS isolate / Python runtime。沙箱请求只有因子标识、类型与数据，没有源码；宿主检查输入形状、
  已登记依赖、结果长度和数值。同一实例串行计算，初始化失败和运行结束释放运行时。
- TS 策略仍用墙内 Engine，但因子经独立宿主桥到各自的沙箱；Python 策略的宿主 Engine 使用
  同一 FactorHost。Panel 组件各自隔离，Engine 按原公式组合返回数值。
- `prepareStrategyFactors` 的现有权限、冻结和字面量依赖提取保持不变，包括 `factors` 声明和
  `ctx.factor(...)` 字面量调用；不新增扫描策略控制流来推测运行路径。

批量准备与缓存契约：

1. 每日回调前准备 watch、实际持仓及已加载历史的标的；截面加载和 `ensureBars` 返回前准备新增输入。
2. 横截面按缺失输入批量调用，资产序列通过现有 `computeSeries` 调用；不预计算全回测未来日期。
3. 缓存只保留当前决策日。已读取值保持当日首次读取语义；尚未读取的提前计算值在截面/历史可用性
   变化后重新计算，避免把缺少输入时的 null 锁死。缺少准备的同步读取明确失败，不能伪装为数据缺失。
4. 模块实例在回测内复用、回测之间隔离。批量准备会改变未读取因子的调用次数与时机；有副作用、
   依赖调用顺序的用户因子不承诺与原惰性路径逐次等价。指标输入、PIT 和数学公式保持不变。
5. 存储 schema、HTTP API、公开 Factor SDK 不变。合法结果中的 null 与协议/生命周期错误严格区分。

审查后的验证计划：现有 factor-semantics、Factor TS/Python runtime、墙内回测及 bundle 边界测试；
新增四种策略/因子语言组合、宿主隔离、输入拒绝、冻结依赖、初始化清理、缓存刷新、动态持仓和混合
Panel 组件测试；API/shared 构建与相关 Worker 启动验证。所有 Python 本地验证不代表生产容器隔离验收。

### 第一提交静态检查记录（2026-09-18）

- `pnpm typecheck` 通过：Shared、API、Docs、sandboxd、Web 均通过；生成物一致性检查通过。
- 后端静态扫描：770 个文件，2885 条运行时边、682 条类型边，0 违规；已移除不再需要的 Factor SDK 类型边例外。
- 本次新增/修改 TS 文件 ESLint、Prettier（包含 Engine data 目录）和 `git diff --check` 通过。
- 人工 review 通过后，Engine、Factor runtime、Strategy runtime / factor-inputs 共 31 个测试文件、178 项测试通过；边界检查器 28 项自测通过。
- Shared、API 构建通过；新增真实回测 Worker、扫描 cell、Signals 子进程验证，源码与编译产物各 8 项通过，覆盖四种策略/因子语言组合及因子观察值。测试等待进程退出，断开 Prisma 并删除独立临时数据库。
- Worker 测试夹具首次缺少空 SQLite 文件，随后缺少基准行情；仅修正测试夹具后重跑全部通过，未修改已 review 的产品代码。
- Python 使用本地 research-py-v1 环境验证；未进行生产容器隔离验收或性能基准测试，性能对比留在第三提交。
- 未修改 Prisma schema、公开 SDK、workspace 或跨包构建依赖，无数据库迁移或部署范围规则变更。

### 第二提交：共享 Strategy bridge（2026-09-18，验证通过）

- `strategy/runtime/bridge.ts` 的 `createStrategyBridge(transport, options)` 返回 Engine 使用的
  `Strategy`；接管元数据、限流日志、每日快照、截面/历史批量请求、命令校验后的顺序重放。
- `StrategyTransport` 只要求发送帧与按 schema 读取校验帧；协议拒绝时适配器必须终止会话。
  PythonSession 已满足该契约；Python runtime 保留 connect、start（含参数覆盖）、失败清理和 close。
- `strategy/runtime/protocol.ts` 是两种语言后续共用的业务协议；保留既有 snake_case 字段、输入限制、
  请求错误响应、整批命令先校验后重放，以及 Python 原有诊断文案。本次不更改 runner 通信格式。
- 通用字段与日志/错误 schema 提到 `infra/runtime/protocol.ts`；Factor、Research 只更新导入路径，
  Python 帧包络与分帧大小限制仍在 `infra/runtime/python/protocol.ts`。
- TS 尚未接入共享 bridge；Engine 迁移仍属于第三提交。无数据库、HTTP、公开 SDK 或构建依赖变更。
- 人工 review 后完成 Strategy runtime、因子隔离、Factor/Research 协议、PythonSession 与源码 Worker
  回归：17 个文件、97 项测试通过；其中 7 项共享 bridge 测试和 5 项 Python 适配器生命周期测试。
- 编译产物的真实回测 Worker、扫描 cell、Signals 子进程 8 项测试通过；Shared/API 构建、边界检查器
  28 项自测通过。Worker 测试等待进程退出并清理独立临时数据库；PythonSession 测试关闭连接和 socket。
- PythonSession 首次因执行环境禁止 Unix socket 监听而出现 11 项 EPERM 失败；获准后原样重跑全部通过，
  未修改产品或测试代码。Python 使用本地运行时验证，结果不代表生产容器隔离验收。

第二提交静态检查：`pnpm typecheck` 全部通过，生成物一致性通过；后端扫描 774 个文件、
2893 条运行时边、688 条类型边，0 违规。变更 TS 的 ESLint、Prettier 与 `git diff --check` 通过。
源码文本对比确认快照、查询、命令重放和日志映射仅更改名称及传输接口类型。无未完成的必需验证。

### 第三提交：宿主 Engine 与双语言沙箱（2026-09-20，验证通过）

- `strategy/runtime/run.ts` 统一两种策略语言的回测和信号捕获，复用宿主 Engine 与 FactorHost，
  finally 关闭两个运行时。正式回测、扫描 cell 和 Signals 已迁入；后处理和业务准入不变。
- `typescript/runtime.ts` 只编译 TS 为 CJS，在 isolate 加载 `sandbox-entry.ts` + SDK bundle；
  元数据检查、参数检查及 Agent 编译校验也在 isolate 完成，不再在宿主求值用户源码。
  原 `walled-run.ts`、`wall-entry.ts`、`wall-bundle.ts` 删除；可信 fixture 编译器移入 testing，
  由已有后端边界规则禁止生产导入。
- TS/Python 共用 `bridge.ts`、`protocol.ts` 和 `commands.ts`。TS 的同步 API 需要保留调用处
  `try/catch`、条件单取价时点，以及自定义因子的实际首次读取/Signals 观察值；因此 TS 使用
  schema 限定的 `context-access.ts` 同步通道，Python 仍在 done 后批量重放。这里统一业务规则，
  不将两种语言传输强制改成相同的同步机制。
- TS 截面整批传输；watch/持仓历史首次批量传输当前日期可见数据，后续按日期增量更新。
  `ensureBars` 返回所请求标的的完整可见历史并注册后续更新；本地窗口返回副本，指标在 isolate
  中计算。其他同步查询按回调缓存，截面/历史加载后清除查询缓存。Python 传输保持原状。
  不在生成截面时提前读取因子。同步通道不暴露存储端口或任意宿主方法，且仅在当前 onBar 绑定。
  保存 context 后在回调外继续调用不受支持。共享协议的字段/数量上限也应用于 TS。
- 每次运行独立 isolate，模块状态跨 bar 保留；初始化/协议失败和关闭释放 isolate。帧大小与
  队列总字节上限均为 64 MiB，队列最多 10,000 帧；声明求值 5 秒，策略回调沿用一小时预算。
  没有数据库、HTTP、公开 SDK、workspace 或跨包构建依赖变更。
- 新增隔离与兼容性测试，保留原生 fixture 对照的净值、成交、条件单、期货、指标与信号断言；
  bundle 测试改为断言不含 Engine。源码/编译的四种策略与因子语言组合 Worker 测试继续使用。
- 性能测试 `runtime-benchmark.test.ts` 需显式设置 `JIXIE_TEST_RUNTIME_BENCHMARK=1`。分别启动
  独立进程运行 `f276bfbd` 中原墙内 Engine 和新宿主 Engine，固定 100 标的、120 日期，
  每组一次冷启动、两次预热、十次正式采样，保留各自进程内 bundle 缓存，
  比较 NAV/成交哈希，记录冷/热耗时、进程最大 RSS 和各自跨边界调用计数；不预先宣称性能无损。
- Review 后运行相关运行时、Engine、因子、API 入口回归，Shared/API 构建、源码/编译 Worker 验证，
  以及 `strategy`、`strategy-python`、`strategy-scan`、`strategy-factor-dependency`、`signals` 浏览器 E2E。
  E2E 使用隔离测试数据与现有脚本，关闭测试服务并交付截图。五项 E2E 均已通过，验收截图位于 `apps/web/acceptance/`。

第三提交静态检查：`pnpm typecheck` 全部通过，生成物一致性通过；后端扫描 780 个文件、
2919 条运行时边、690 条类型边，0 违规。10 处非字面量导入已有运行入口清单记录。
变更 TS/MJS 的 ESLint、Prettier 及 `git diff --check` 通过。运行时旧入口只在固定版本性能
基线中保留引用；所有生产调用方已迁移。性能修订后的 typecheck、边界扫描和相关 ESLint/Prettier 再次通过。

首轮行为验证（历史传输修订前）：

- 运行时、Engine、因子与源码 Worker 合计 179 项通过、1 项失败、1 项跳过。失败为新测试误把
  缺少指数成分数据当成成功路径；随后改为断言拒绝，并在修订版回归中通过。Shared/API 构建通过。
- 独立进程基准六次 NAV/成交哈希一致。旧实现三次耗时 155.5 / 134.1 / 221.5 ms，
  新实现 478.9 / 331.2 / 322.2 ms；每轮新实现同步跨界 12,120 次，传输 9,348,431 字节。
  最大 RSS 分别为 194,688 / 189,072 KiB。此小夹具显示约两倍耗时，不能宣称性能无损。
- 根据该结果，将逐标的指标窗口跨界改为上述首次历史批量传输与日期增量更新。新增本地窗口
  零同步调用、动态 ensureBars 后续更新及停牌日不重复追加三个用例。
  初版新增测试误以为 Engine 支持回测开始前日线；复审后验证发现该测试预期错误，已仅修正测试，
  明确保持 Engine 的 `[start, end]` 数据范围，未改变行情加载语义。
- 产品代码发生修订，按工作流返回 Gate 2；用户已确认复审后继续验证。

修订后的验证结果：

- Runtime、Engine、Factor 输入、Strategy/Signals API 与源码 Worker 共 231 项通过；基准为显式开关，另行运行。
  编译 Worker 8 项通过，边界检查器自测 28 项通过，Shared/API 构建通过。
- 基准 26 次净值/成交哈希一致。正式采样总耗时中位数旧版 103.08 ms、新版 105.56 ms（+2.4%）；
  执行阶段中位数 96.01 / 100.01 ms（+4.2%）。冷启动总耗时 149.83 / 176.24 ms。
  新版每轮同步调用 120 次（修订前 12,120 次），发送/接收帧 240 / 241，传输 9,815,209 字节。
- 基准是固定夹具的架构对照，并非两个完整版本快照：旧入口固定 `f276bfbd`，Engine/SDK 使用
  当前未改变行为的实现；旧 bundle 构建换为 stdin，原 bundlePromise 缓存保留。计时排除进程
  启动与 fixture 创建；执行阶段旧版包含用户声明和结果跨界，新版声明计入初始化，所以阶段数据
  仅用于定位，不能称为严格等价的纯 Engine 时间。总耗时包括初始化、执行和释放；单进程顺序
  采样且单一策略，不外推真实数据库或大规模任务性能。最大 RSS 是整进程峰值。
- 浏览器 E2E 五项通过：`strategy`、`strategy-python`、`strategy-scan`、`strategy-factor-dependency`、
  `signals`。真实 API、SQLite、Worker 与 Web 使用临时隔离环境和合成行情；命名模型用本地夹具，
  无外部模型调用。TS 回测 3 笔成交，Python 1 笔；扫描完成 4 个参数组合、3 种仓位方案、3 个资金规模；
  因子真实分析/发布后策略成交 23 笔，依赖冻结/链接/补全通过；信号生成、次日结算、条件单、执行回填通过。
- E2E 首轮仅修正测试/环境：旧并发断言改为现行 409/CONFLICT，测试策略用短延迟确保任务重叠；
  参数扫描等待初始化并按本次 reportId 匹配完成响应，避免依赖瞬时进度条或读到旧报告；
  Python 截图等待图表加载。本地 Python API 工作目录改为 apps/api。没有为这些失败修改产品代码。
- 已查看 Python 回测、因子依赖、扫描与信号截图，主流程结果可见。截图为合成数据验收，不代表投资表现；
  本地 Python 验证不替代生产容器隔离验收。测试服务已关闭，43191/43192/43193 无监听，临时数据库已删除。

---

> 2026-09-09 目录重整更新（Commit 8，验证通过）：配置执行入口归 `strategy/execution/run-configured.ts`，TS 的宿主/墙内入口归 `strategy/runtime/typescript/`；模拟核心显式接收 `engine/data/data-port.ts` 的必填端口，Prisma 适配器归 `engine/adapters/`，移除了打包时的 Prisma 替身。下文保留早期决策记录；现行职责见 [Engine 阅读地图](../../apps/api/src/engine/README.md)。

> **2026-08-05 决策更新：下文 2026-07-07 的“不支持 Python 策略”结论已被新需求取代。**
> 当前采用“单一 TypeScript Engine + Python 策略进程 + 独立 `jixie-sandboxd` + rootless
> Podman”，不复制一份 Python Engine。旧分析保留在后半部分，作为决策演进记录。

## 2026-08-05 定稿：保留一套 Engine，增加 Python 语言适配层

### 核心边界

```text
API backtest worker
  └─ TypeScript Engine（撮合、账户、A 股规则、指标数据缓存，唯一真相）
       ⇅ 粗粒度 framed JSON RPC（截面 / K 线块 / 交易意图）
     jixie-sandboxd（Unix socket、并发与生命周期控制）
       └─ rootless Podman container（每次运行一个 Python 进程）
            └─ py-v1 SDK + 用户策略
```

不重写 Python Engine。若做两套 Engine，T+1、涨跌停、停牌、整手、复权、成本、期货逐日
盯市等规则都会产生两个实现和两个结果；长期校准成本远大于语言适配成本。Python 只负责表达
“今天读什么、下什么意图”，最终撮合始终回到现有 Engine。

通信也不是让每个 `ctx.*` 都跨进程：

- `universe()` 一次请求当天截面及已声明因子；`where/rank/top` 在 Python 内完成；
- `ensure_bars()` / 首次窗口指标一次请求一批代码的历史 K 线，随后保留进程内缓存；
- 每个交易日只推账户快照和 watch/持仓代码的增量 bar；
- Python 一次 `on_bar` 完成后批量返回交易指令，由 Engine 依次重放。

这保留了动态数据访问语义，同时把 IPC 从“函数调用次数”收敛为“数据块加载次数”。协议使用
4-byte big-endian 长度头 + JSON，不能依赖换行，因为用户 `print()` 也要作为日志回传。

### 语言与版本

策略配置新增向后兼容字段：

- `language: "typescript" | "python"`，旧配置缺失时视为 `typescript`；
- `runtimeVersion: "ts-v1" | "py-v1"`，旧配置缺失时视为 `ts-v1`；
- language/runtime 必须匹配，运行 key 也包含两者，避免跨运行时错误复用结果。

`py-v1` 的源码形态是一个持久模块：

```python
from jixie import Strategy

strategy = Strategy(name="示例", params={"lookback": 20}, watch=["510300.SH"])

@strategy.on_bar
def handle_bar(ctx):
    if ctx.sma("510300.SH", ctx.params.lookback):
        ctx.order_target_percent("510300.SH", 1.0)
```

模块变量在整次回测中保留。当前覆盖股票/ETF、选股链、日线窗口指标、预置因子、目标仓位/
股数订单和条件单；暂不开放期货、自定义 TypeScript 因子、参数扫描与每日信号部署。前端在 Python
模式隐藏未支持入口，后端仍须把不匹配的直接请求视为不支持，而不是按 TypeScript 误解析。

### 生产沙箱

生产 API 不直接启动 Python，也不拥有 Podman 控制权，只连接 `/var/lib/jixie/sandboxd.sock`。
`jixie-sandboxd` 为每个会话执行一个无挂载容器，并固定：

- rootless Podman、非 root 容器用户；
- `--network=none`、只读根文件系统、64MB `noexec` tmpfs；
- drop all capabilities、`no-new-privileges`、默认 seccomp；
- 768MB 内存、1GB memory+swap 总上限、1 CPU、64 PID（宿主必须使用 cgroups v2）；
- 最多 4 个并发会话、单会话最多 1 小时；
- 策略模块初始化和每次 `on_bar` 最多连续执行 10 秒，等待 Engine 数据的时间不计入。

每个容器都有独立名称、`--cidfile` 和 sandboxd 实例归属标签。正常关闭或客户端断连时，sandboxd 先关闭
runner 的标准输入并等待 500ms；容器仍存在时，再执行 `kill` 和 `rm --force`。清理命令会检查退出状态、失败
重试，并通过 `inspect` 确认容器已经不存在；无法确认时记录 cleanup failure，不再静默视为成功。并发名额只在
这套清理结束后释放。sandboxd 启动时先按归属标签回收同一 Unix socket 实例因崩溃或断电留下的容器，再开始
接受连接。收到 `SIGINT` / `SIGTERM` 时会停止接收连接、关闭所有客户端，等待活动容器完成同一套清理，再
删除 Unix socket 并退出。Docker 验证 backend 与生产 Podman backend 共用该生命周期实现。

镜像基础层固定为 CPython 3.13.15 slim-bookworm 的多架构 digest，只含 py-v1 runner，以及由统一
`research-py-v1` Contract 生成并精确锁定版本的 NumPy、pandas、
SciPy、statsmodels、Matplotlib 和 scikit-learn，不挂载代码库、数据库、宿主目录或密钥。Docker requirements、
Agent 能力目录、提案导入白名单与本地运行时均从同一 Contract 派生。开发者先运行
`pnpm setup:sandbox` 建立工作区虚拟环境；`pnpm dev` 在启动服务前验证 CPython 3.13 和每个包的精确
版本，不再静默使用能力残缺的系统 Python。本地测试仍可显式使用 `JIXIE_PYTHON_LOCAL=1`，但 production 会拒绝
该逃生口。

### macOS 验证路径

macOS 本身没有 Linux namespaces/cgroups，因此不假装在宿主上验证生产隔离，而是使用 Colima 的
Linux VM。`sandboxd` 提供仅非 production 可启用的 `docker` backend；它和 Podman backend 使用
相同镜像、Unix socket 协议、用户、网络、只读文件系统、capability、PID/CPU/内存限制。推荐步骤：

```bash
colima start
docker build -t jixie-python-runtime:py-v1 \
  -f apps/sandboxd/Dockerfile.python apps/sandboxd
pnpm --filter sandboxd build

JIXIE_SANDBOX_SOCKET=/tmp/jixie-sandboxd.sock \
JIXIE_SANDBOXD_MODE=docker NODE_ENV=test \
node apps/sandboxd/dist/src/index.js

JIXIE_SANDBOX_SOCKET=/tmp/jixie-sandboxd.sock \
pnpm --filter api exec vitest run src/strategy/runtime/python/runtime.test.ts
```

这能验收镜像、依赖、协议和绝大多数容器限制；不能替代 VPS 上的 rootless Podman、systemd unit、
subuid/subgid 和 cgroups v2 验收。最终上线前仍应在目标 Linux 主机运行 bootstrap 和一次 Python
fixture 回测。

### 当前验收护栏

- 同一 fixture 上 Python 与原生 TS 策略的每日 NAV、成交逐笔完全一致；
- Python traceback 保留 `strategy.py` 行号；
- 初始化死循环被中断；
- 同一用例既直连 runner 验证，也经 Unix socket 的 sandboxd relay 验证；
- 容器镜像仍需在有 Podman/Docker daemon 的 Linux 环境完成实际构建与启动验收。

## 历史分析（2026-07-07，已被上述决定取代）

> 2026-07-07 应用户要求分析,**未实施**——本文是给用户拍板用的 trade-off 分析。两个独立问题:
> ① 策略/因子是否支持用 Python 编写;② 现有 `new Function` 沙箱(`compileStrategy`/`compileFactor`)是否/何时升级硬隔离(ROADMAP 4.5)。

## 问题一:策略 / 因子支持 Python 编写

### 为什么会想要它

- Python 是量化的通用语言:学习资料(聚宽/Qlib/backtrader 社区)、论文复现代码、招聘市场全是 Python;
- 生态不可替代的部分是真实的:pandas/numpy 向量化、statsmodels(中性化回归)、**LightGBM(ROADMAP 3.7 ML 合成,Node 生态无成熟 GBDT 训练库)**;
- 用户个人的学习路径可能以 Python 材料为主,TS 写策略有翻译成本。

### 三种实现形态与代价

| 形态 | 做法 | 致命伤 |
|---|---|---|
| A. Python sidecar 进程 | 引擎留 TS,`onBar` 经 stdin/stdout JSON-RPC 调 Python | `ctx.*`(bars/factor/sma…)每次调用都跨进程,一次回测数万次 IPC;要么 ctx 全量快照序列化(大),要么 API 阉割。工程量大、慢、调试地狱 |
| B. 平行 Python 引擎 | 用 backtrader/Qlib 或自写 Python 引擎 | **两套引擎两个真相**:A 股规则(T+1/涨跌停/整手/费率)要实现两遍、对齐两遍;违背 code-first「代码即唯一真相」的立身之本 |
| C. Pyodide(CPython-WASM)进 Node | Python 代码在 WASM 里跑,与 TS 引擎同进程 | 启动 ~2-5s、内存 200MB+、纯计算慢 3-10 倍;numpy 有 wasm 版但生态残缺(LightGBM 没有);等于为语法糖付重税 |

共同的隐性成本:**SDK 表面积 × 2**。现在 TS SDK 已是"运行时 / Monaco dts / codegen prompt"三镜像(ROADMAP 4.4 待统一),加 Python 变六份;agent 代码生成、编译校验、修复回灌、研究面板日志全部要双语言化。每个新指标/新 ctx 能力的边际成本翻倍。

### 建议(供拍板)

**策略/因子编写语言不加 Python,Python 以「研究 sidecar」身份进来**——生态不可替代的地方用它,且边界收窄成数据进数据出:

1. **ML 合成(3.7)按原设计走 Python sidecar**:单脚本、stdin/stdout JSON,特征(因子暴露)进、打分出,「模型输出=一个因子」塞回现有检验管道。这是 Python 真正无可替代的位置,且不触碰引擎。
2. **重统计分析同理**(如未来 3.4 扩展需要 statsmodels 级别的回归诊断):独立脚本按需调,不进对话热路径。
3. 用户的 Python 学习材料 → 翻译成 TS 因子/策略正是 agent 的强项(「把这段聚宽代码翻成 defineFactor」),平台已为此付过成本。

一句话:**语言统一在 TS(引擎与真相所在),Python 只做无状态计算外包。**若未来实在要 Python 写因子,C(Pyodide)是唯一不裂开真相的路线,届时限定在因子 compute(纯函数、好序列化),不碰策略 onBar。

## 问题二:沙箱升级(ROADMAP 4.5)

### 现状与真实威胁面

- 边界:`compileStrategy` / `compileFactor` —— esbuild 剥类型 + `new Function` 注入白名单标识符 + `require` 封死。
- `new Function` **不是安全边界**:原型链逃逸可拿到宿主对象;死循环/大内存分配可拖垮线程。
- 但威胁模型要摆正:单用户平台,代码 = 用户自己写或 agent 生成。风险主要是**事故**(死循环、误操作)不是恶意;且计算已经在 worker 线程里跑(factor-worker / backtest-worker),死循环杀的是 worker 不是服务。

### 候选方案

| 方案 | 隔离强度 | 性能 | 成本 |
|---|---|---|---|
| worker + `resourceLimits`(增量加固) | 中(V8 同进程,但内存上限 + terminate 硬超时) | 零损耗 | 极低:现有 worker 加一行配置 |
| isolated-vm | 强(独立 V8 isolate,内存/CPU 限额) | 跨界有拷贝成本;**因子 65 万次/跑 compute 逐次跨界会崩**,需改成「整个截面批量进沙箱」 | 原生依赖 + API 改造 |
| QuickJS-WASM(quickjs-emscripten) | 强(WASM 天然隔离) | 纯计算慢 5-20 倍:ep 全历史 6s → 半分钟到 2 分钟 | 无原生依赖,但性能税常驻 |
| node:vm | 无(官方明说不是安全边界) | — | 不考虑 |

### 建议(供拍板)

- **现在(单用户)**:只做增量加固——给 factor/backtest worker 加 `resourceLimits`(如 `maxOldGenerationSizeMb: 512`)+ 确认所有沙箱执行路径都在可 terminate 的 worker 里(SQL worker 已按此模式落地)。事故防护到位,零性能税、零依赖。
- **多用户前(4.5 触发时)**:选 **isolated-vm**,同时把因子执行改成「按调仓日批量进沙箱」(一天一次跨界,不是一股一次)摊薄拷贝成本。QuickJS 的性能税对 65 万次 compute 的工作负载不可接受。
- 沙箱边界已收敛在 compile 两个函数上(当初设计如此),换实现不动别处——这个前提今天仍成立,含新增的统一因子路径(computeFactorSeries 只经 compileFactor)。

## 决策清单(2026-07-07 已全部拍定)

- [x] 问题一:**采纳「TS 唯一编写语言 + Python 研究 sidecar(3.7 时落地)」**。
- [x] 问题二:**用户拍板「现在就上 isolated-vm」**,分两阶段:
  - **Phase A(当日完成)**:因子 compute + analyzeData 迁入 isolated-vm(`infra/runtime/typescript/isolate-run.ts`)。
    要点:数据进出 = JSON 字符串;跨墙**批量化**(因子快路径一天一跨、窗口路径一股一跨,
    analyzeData 一次调用一跨);stats 库在墙内求值(调用不跨墙);isolate 自带内存上限(256MB)
    + CPU 超时;逃逸测试证明墙内 process/require 均为 undefined;ivm 在 worker_threads 内
    (factor-worker)实测干净退出。等价性:预置公式单测逐位一致 + 真库 ep 缓存基线复验。
  - **Phase B(设计当日收敛、当日实施完成)**:**引擎整个进墙 + DataPort 出墙**(用户提出,
    取代早先的「预取进墙」草图)。**实况**:B1+B2 一次做完——`engine/data-port.ts`(纯接口)/
    `prisma-port.ts`(直跑实现)/`fixture-port.ts` + 9 例 A 股规则单测;`wall-entry.ts`(墙内入口,
    esbuild bundle 进 isolate)+ `walled-run.ts`(宿主桥:__hostFetch applySyncPromise 数据、
    __hostLog 日志穿墙);backtest-worker(产品路径)切墙内车道;防漂移双跑测试常驻(净值/成交
    逐位断言 + 逃逸探针);真库金标准:EP 2020-2024 墙内与直跑**逐位一致**,性能税见 ROADMAP。
    compileStrategy(new Function)仅存于:验证路径(编译校验即弃)与直跑车道(git 来源代码)。

    ### Phase B 定稿:引擎进墙 + DataPort + 双车道

    ```
    isolate 墙内:引擎(run/portfolio/data 缓存/指标)+ SDK + 策略代码
          │  ↑ DataPort:窄数据接口(批量行数据,JSON,applySyncPromise 桥)
    墙外(backtest-worker):DataPort 实现 = Prisma
    ```

    **为什么赢过预取草图**:策略数据访问是动态的(买入新票才需要它的 bars),预取要求墙外
    「猜准」当天所需,总有边角;引擎进墙后**惰性加载语义原样保留**——跨墙次数 = 引擎的
    DB 查询次数,而引擎缓存设计本来就为压查询次数(十年月度 ≈ 120 截面 + 几百条个股序列 =
    几百次跨墙,每次一整块)。引擎代码几乎不改 → 等价性风险最小。墙内引擎 await 数据时用
    `applySyncPromise` 同步阻塞 isolate 自己的线程,宿主事件循环不受影响。

    **B1 · DataPort 抽取(独立有价值,先做)**:`engine/data.ts` 的直连 Prisma 抽成窄接口
    (八九个查询函数)。收益即刻兑现:引擎第一次可以喂**内存 fixture 跑单测**——A 股规则
    (T+1/涨跌停阻断/整手/费用)逐条确定性断言,不再依赖 6.5GB 真库;行为零变化,金标准
    双跑护航。~1.5 人日。

    **B2 · 进墙**:引擎 esbuild bundle 成单串注入 isolate(排除 Prisma,port 桥顶上);
    内存限额给到 512MB~1GB(引擎缓存住墙内);日志(系统 + 用户 console)批量出墙。~2 人日。

    **双车道(调试税的解法,用户提出)**:同一引擎源码、两种宿主——
    - 直跑车道(不进墙):DataPort 直连 Prisma / fixture。单测、金标准、研究脚本、引擎
      开发调试都走这条,debugger 齐活;
    - 进墙车道:产品路径(web 上跑用户/AI 策略)。

    两条护栏**定死**:
    1. **开关跟代码来源走,不跟调用方走**:代码从 DB 来(用户/AI 生成)→ 进墙;代码从
       git 来(checked-in、过 review)→ 可直跑。批量重放库里策略的脚本也算 DB 来源。
    2. **防漂移双跑测试常驻**(~0.5 人日):固定小策略 + fixture 数据,双车道各跑一遍断言
       净值逐日一致——bundle/序列化/桥坏了立刻红,不靠人肉发现。

    调试工作流:墙内出 bug → 直跑车道同码同数据复现(debugger 可用)→ 复现不了则问题锁死
    在桥/bundle 这几百行自有代码里,双跑测试可二分。验收 = 金标准双跑(同批策略新旧路径
    净值逐日一致)+ 防漂移测试进 CI。总估 ~4 人日。在此之前 compileStrategy 维持
    new Function + worker。
