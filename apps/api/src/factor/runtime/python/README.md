# Python 因子适配与静态验证

本目录实现 py-v1 的宿主协议和验证，以及沙箱侧业务运行器。公开字段真相源为 [python.ts](../../../../../../packages/shared/src/sdk/factor/python.ts)，底层连接由 Infra PythonSession 提供；不从 Prisma 推导 Python API。

| 文件 / 入口 | 用途与调用方 |
| --- | --- |
| [validator.ts](validator.ts) `validatePythonFactorDefinition` | 草稿校验：检查 Factor 工厂、compute 装饰器等形状，运行 Pyright；不执行用户 Python |
| 同文件 `pythonFactorTargetAssetClasses` | runtime/inspect-definition 读取字面量 target_asset_classes；不启动 Python 会话 |
| [python-cross-sectional-factor-runtime.ts](python-cross-sectional-factor-runtime.ts) `PythonCrossSectionalFactorRuntime` | 横截面序列、Strategy 准备、Engine Python 因子宿主；源码 → 批量计算对象 |
| [python-asset-factor-runtime.ts](python-asset-factor-runtime.ts) `PythonAssetFactorRuntime` | 共享评估、发布、Strategy 准备及 Engine 宿主；源码 → 资产序列计算对象 |
| [../protocol.ts](../protocol.ts) | startup／execution 帧校验；拒绝错类型或畸形响应 |
| [runner.py](runner.py) `run_factor` | 在沙箱进程内加载用户源码、注入 `jixie`、验证元数据并批量执行；公开类来自 [Python SDK](../../sdk/python.py)，由 sandboxd 公共启动器分派 |

SDK 与 runner 按业务目录结构进入 Python 镜像。移动它们须同时更新 Dockerfile、`.dockerignore`、部署影响清单和测试；
[packaging.test.ts](packaging.test.ts) 用 Dockerfile 的实际 COPY 输入在隔离目录覆盖三种分析类型的启动与求值，不依赖仓库外的 Python 模块。

业务消费者统一调用 `FactorRuntime.start({ language: 'python', analysisKind, code, onUserLog? })`。具体类经公共启动流程连接会话，发送 factor_start 并等待 metadata；execute 接收 `{ items }` 或 `{ fields, indexes }`，将宿主字段显式映射为 Python 字段。返回值数量必须匹配请求，异常长度会 abort；初始化异常关闭连接，成功实例的 close 由调用方负责。计算日志按协议转发，不把因子错误伪造为成功报告。

validator 的临时目录在 finally 删除，Pyright 从 API 依赖解析；这与真正的 Python 沙箱执行是两条路径。`pythonFactorTargetAssetClasses` 只接受非空、唯一、支持类型的字面量列表，不能据此声称执行过源码。

修改验证看 [validator.test.ts](validator.test.ts)；协议看 [../protocol.test.ts](../protocol.test.ts)；实际适配看 [python-cross-sectional-factor-runtime.test.ts](python-cross-sectional-factor-runtime.test.ts)、[python-asset-factor-runtime.test.ts](python-asset-factor-runtime.test.ts)。运行资源定位见 [清单](../../../../../../docs/backend-runtime-entries.md)，上层选择见 [runtime](../README.md)。

[返回 Factor 总览](../../README.md)

具体类直接继承公共 SandboxRuntime，使用 startSandboxRuntime 负责启动失败清理。start 和 execute 均调用公共 exchange，close 同步幂等。FactorHost、评估和 Strategy 因子准备拥有最终释放责任；预备输入与 SDK 本地 history 不变。
