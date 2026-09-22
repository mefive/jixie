# 因子定义检查与语言运行

这里服务草稿校验、详情检查、发布及计算消费者。底层通信／isolate 在 Infra，正式评估和状态在 [evaluations](../evaluations/README.md)。语言实现分别见 [TypeScript](typescript/README.md)、[Python](python/README.md)。

| 文件 / 入口 | 消费者及副作用 |
| --- | --- |
| [factor-runtime.ts](factor-runtime.ts) `FactorRuntime.start` | 所有计算消费者的唯一创建入口，按 language/analysisKind 选择具体实例；实例统一提供 metadata、execute、同步幂等 close，输入类型在 [contract.ts](contract.ts) |
| [validate-definition.ts](validate-definition.ts) `validateFactorDefinition` | 草稿写入等调用方传源码、不可混淆的 analysisKind 和 language；成功返回 void，失败抛错。TS 会 start 并 close 实例，Python 做静态验证 |
| [inspect-definition.ts](inspect-definition.ts) `customFactorTargetAssetClasses` | definitions/read 获取详情资产范围；横截面返回 equity，TS 资产因子 start 后读取 metadata，finally close，Python 只解析字面量声明 |
| [codegen-prompt.ts](codegen-prompt.ts) `buildFactorCodegenPrompt` | Agent profile／生成流程使用，按语言和分析类型构造提示词，不保存因子或报告 |

静态验证、检查元数据与执行因子不是同一操作。Python 验证虽不执行用户 Python，仍启动 Pyright 并创建临时文件；TS 定义检查也有 isolate 资源。纯目录消费者不要经 runtime 获取 definitions/views 中已有的语言映射。

可编辑 time_series / panel 的 TS 校验拒绝受控研究输入，Python 的实际校验按 validator 实现，不虚构两种语言完全一致的校验步骤。运行时字段契约以 shared Factor Python SDK 和各语言 SDK 为准，不在 README 复制字段表。

修改协议选择看 [validate-definition.test.ts](validate-definition.test.ts)，编译与检查再看对应语言测试。路径和资源归属见 [后端运行入口](../../../../../docs/backend-runtime-entries.md)。

[返回 Factor 总览](../README.md)
