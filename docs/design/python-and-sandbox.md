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

## 决策清单

- [ ] 问题一:采纳「TS 唯一编写语言 + Python 研究 sidecar(3.7 时落地)」?还是坚持要 Python 写因子(→ 排期评估 Pyodide 因子专用路线)?
- [ ] 问题二:本期只做 worker resourceLimits 加固?(isolated-vm 留给 4.5 多用户触发)
