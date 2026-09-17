# Python 因子适配与静态验证

本目录实现 py-v1 的宿主协议和验证。公开字段真相源为 [factor-python-sdk.ts](../../../../../../packages/shared/src/factor-python-sdk.ts)，底层连接由 Infra PythonSession 提供；不从 Prisma 推导 Python API。

| 文件 / 入口 | 用途与调用方 |
| --- | --- |
| [validator.ts](validator.ts) `validatePythonFactorDefinition` | 草稿校验：检查 Factor 工厂、compute 装饰器等形状，运行 Pyright；不执行用户 Python |
| 同文件 `pythonFactorTargetAssetClasses` | runtime/inspect-definition 读取字面量 target_asset_classes；不启动 Python 会话 |
| [cross-sectional.ts](cross-sectional.ts) `compilePythonCrossSectionalFactor` | 横截面序列、Strategy 准备、Engine Python 因子宿主；源码 → 批量计算对象 |
| [asset-factor.ts](asset-factor.ts) `compilePythonTimeSeriesFactor`、`compilePythonPanelFactor` | 共享评估、发布、Strategy 准备及 Engine 宿主；源码 → 资产序列计算对象 |
| [protocol.ts](protocol.ts) | startup／execution 帧校验；拒绝错类型或畸形响应 |

编译入口连接会话、发送 factor_start 并等待元数据；computeBatch / computeSeries 发送对应请求，将宿主字段显式映射为 Python 字段。返回值数量必须匹配请求，异常长度会 abort；初始化异常关闭连接，成功对象的 dispose 由调用方负责。计算日志按协议转发，不把因子错误伪造为成功报告。

validator 的临时目录在 finally 删除，Pyright 从 API 依赖解析；这与真正的 Python 沙箱执行是两条路径。`pythonFactorTargetAssetClasses` 只接受非空、唯一、支持类型的字面量列表，不能据此声称执行过源码。

修改验证看 [validator.test.ts](validator.test.ts)；协议看 [protocol.test.ts](protocol.test.ts)；实际适配看 [cross-sectional.test.ts](cross-sectional.test.ts)、[asset-factor.test.ts](asset-factor.test.ts)。运行资源定位见 [清单](../../../../../../docs/backend-runtime-entries.md)，上层选择见 [runtime](../README.md)。

[返回 Factor 总览](../../README.md)
