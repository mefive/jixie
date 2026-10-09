# Python 因子适配与静态验证

本目录准备 py-v1 的宿主启动配置、提供静态验证及沙箱侧业务运行器。宿主协议归共享 bridge。公开字段真相源为 [python.ts](../../../../../../packages/shared/src/sdk/factor/python.ts)，底层连接由 Infra PythonSession 提供；不从 Prisma 推导 Python API。

| 文件 / 入口 | 用途与调用方 |
| --- | --- |
| [validator.ts](validator.ts) `validatePythonFactorDefinition` | 草稿校验：检查 Factor 工厂、compute 装饰器等形状，运行 Pyright；不执行用户 Python |
| 同文件 `pythonFactorTargetAssetClasses` | runtime/inspect-definition 读取字面量 target_asset_classes；不启动 Python 会话 |
| [prepare.ts](prepare.ts) `preparePythonFactorRuntime` | 准备 PythonSession 工厂、factor_start 和 bridge 配置；统一 FactorRuntime 负责获取及释放会话 |
| [../bridge.ts](../bridge.ts) `createFactorBridge` | 三种分析类型共用的宿主协议、Python 字段映射、计算错误去重及结果检查 |
| [../protocol.ts](../protocol.ts) | startup／execution 帧校验；拒绝错类型或畸形响应 |
| [adapter.py](adapter.py) `FactorAdapter` | 本地历史/字段/索引访问及声明输入；SDK 只依赖能力协议 |
| [runner.py](runner.py) `run_factor` / `FactorRunner` | 在沙箱进程内加载用户源码、注入 `jixie`、验证元数据并批量执行；公开类来自 [Python SDK](../../sdk/python.py)，由 sandboxd 公共启动器分派 |

每个沙箱会话创建一个 FactorRunner，定义与回调状态由实例持有；方法按 handle、start、_execute、_load_factor、_metadata、_compute_values 排列，与 TS 的 FactorRunner 和 Python 的 StrategyRunner 对照。run_factor 只做“创建 → 启动 → 接入 handler”，阻塞读帧循环归 [sandboxd 通用入口](../../../../../sandboxd/python/jixie_runner.py)，Factor/Strategy 共用 _receive_commands；FactorAdapter 将本地预备数据绑定为 SDK Capabilities，Factor 无宿主查询，不注入 read_frame。

三种分析类型保留原 metadata 校验、批次超时标签和结果顺序；逐点异常保留第一条 traceback，布尔值、非数值及非有限值返回 null。资产声明输入继续在每批次的用户代码预算内创建集合，不改为跨批次固定缓存。计算错误的 traceback 栈会反映新类/方法位置，错误内容与协议字段保持。

SDK 与 runner 按业务目录结构进入 Python 镜像。移动它们须同时更新 Dockerfile、`.dockerignore`、部署影响清单和测试；
[packaging.test.ts](packaging.test.ts) 用 Dockerfile 的实际 COPY 输入在隔离目录覆盖三种分析类型的启动与求值，不依赖仓库外的 Python 模块。

业务消费者统一调用 `FactorRuntime.start({ language: 'python', analysisKind, code, onUserLog? })`。统一宿主实例经公共启动流程连接会话，发送 factor_start 并等待 metadata；execute 接收 `{ items }` 或 `{ fields, indexes }`，将宿主字段显式映射为 Python 字段。返回值数量必须匹配请求，异常长度会 abort；初始化异常关闭连接，成功实例的 close 由调用方负责。计算日志按协议转发，不把因子错误伪造为成功报告。

validator 的临时目录在 finally 删除，Pyright 从 API 依赖解析；这与真正的 Python 沙箱执行是两条路径。`pythonFactorTargetAssetClasses` 只接受非空、唯一、支持类型的字面量列表，不能据此声称执行过源码。

修改验证看 [validator.test.ts](validator.test.ts)；协议看 [../protocol.test.ts](../protocol.test.ts)；实际适配看 [cross-sectional-runtime.test.ts](cross-sectional-runtime.test.ts)、[asset-runtime.test.ts](asset-runtime.test.ts)。会话状态回归见 [session-state.test.ts](../session-state.test.ts)，打包回归覆盖单会话连续两批计算及 close。运行资源定位见 [清单](../../../../../../docs/backend-runtime-entries.md)，上层选择见 [runtime](../README.md)。

[返回 Factor 总览](../../README.md)

公共 FactorRuntime 直接继承 SandboxRuntime，start 创建实例并等待基类 initialize；createResource 连续准备配置和获取会话，initializeInSandbox 建立 bridge，基类负责启动失败/取消清理。start 和 execute 均调用公共 exchange，close 同步幂等。FactorHost、评估和 Strategy 因子准备拥有最终释放责任；预备输入与 SDK 本地 history 不变。

两个语言 Adapter 都按输入类型 → FactorAdapter.bind → BoundCrossSectionalFactorCapabilities → BoundAssetFactorCapabilities 排列。bind 使用可辨识输入与重载，横截面和资产输入分别对应其能力类型；每点绑定独立索引／历史，Adapter 在会话内复用。
