# 分析:Python 支持与沙箱升级(决策文档)

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
  - **Phase A(当日完成)**:因子 compute + analyzeData 迁入 isolated-vm(`lib/isolate-run.ts`)。
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
