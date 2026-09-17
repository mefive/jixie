# 来源解析、快照与指纹

来源将某次分析使用的定义固定下来，供正式评估、发布、天气及消费者复查。需要查库的解析与纯快照入口分开导入。

| 文件 / 入口 | 输入输出与使用方 |
| --- | --- |
| [resolve.ts](resolve.ts) `resolveFactorSource`、`resolveCustomTimeSeriesFactorSource` | 评估提交传 userId 与 factor 标识；查询可读定义／组合并返回来源或 null，包含权限判断 |
| 同文件 `factorAnalysisSourceDataRequirements`、`factorCodeDataRequirements` | 评估截止日准备解析所需数据；它们与查库解析同文件，不能仅凭函数纯度把整个模块当成纯依赖 |
| [snapshot.ts](snapshot.ts) `factorAnalysisSourceSnapshot`、`parseFactorAnalysisSourceSnapshot`、`parseAssetFactorAnalysisSourceSnapshot` | 正式评估冻结、holdout／发布及 Strategy 解码来源；处理各来源形状和历史快照 |
| 同文件 `factorAnalysisSourceLanguage`、`factorAnalysisSourceHash` | 语言默认值和语言相关哈希；语言缺省仍按 TypeScript，不能在文档中承诺自动识别 Python |
| [fingerprint.ts](fingerprint.ts) `canonicalJson`、`sha256` | 通用规范化 JSON 和内容指纹；纯入口，无数据库或任务生命周期依赖 |

Panel 定义／组件解析在 [composition/panel-source.ts](../composition/panel-source.ts)，模板源码在 [definitions/templates](../definitions/templates/README.md)。纯消费者直接导入 snapshot/fingerprint，不通过 resolve 或 Job 转导出。

改快照或哈希先看 [fingerprint.test.ts](fingerprint.test.ts)、[评估身份测试](../evaluations/identity.test.ts)、[发布测试](../publication/factor.test.ts) 和 [Strategy 准备测试](../../strategy/factor-inputs/prepare.test.ts)，核对旧快照、语言和冻结组合都能按当前规则读取。

[返回 Factor 总览](../README.md)
