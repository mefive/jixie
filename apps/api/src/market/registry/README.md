# 共享市场身份与清单

本目录只维护静态身份、分组和校验，不导入数据库、供应商或同步实现。消费者应直接导入所需文件，导入不会注册落库。

| 文件 / 入口 | 消费者与用途 |
| --- | --- |
| [etf-research-registry.ts](etf-research-registry.ts) `ETF_RESEARCH_REGISTRY`、`ETF_RESEARCH_CODES`、`etfResearchMembership`、`validateEtfResearchRegistry` | ETF 同步／审计、Research、Factor、Signals；研究产品分类、选择依据与成员校验 |
| [etf-presets.ts](etf-presets.ts) `MAJOR_ETF_CODES` | 既有主要 ETF 预设，不与研究清单混用 |
| [index-presets.ts](index-presets.ts) `DAILY_MAINTAINED_INDEX_CODES`、`MAJOR_INDEX_DAILY_BASIC_CODES` 及天气分组 | 指数同步、估值、市场状态；维护／展示各自的指数集合 |
| [cross-market-benchmarks.ts](cross-market-benchmarks.ts) `CROSS_MARKET_BENCHMARKS`、`CROSS_MARKET_BENCHMARK_BY_ID` | 固定 CN/HK/US 基准定义和币种身份；实际注册由 cross-market/benchmark-sync 执行 |
| [yield-curves.ts](yield-curves.ts) `CHINA_TREASURY_*`、`US_NOMINAL_CURVE_*`、`US_REAL_CURVE_*`、`US_TREASURY_CURVE_TYPE` | 国债与美债曲线 source/code/name/type 及中国期限，供同步、Research、Factor、审计和 Signals 读取 |
| [fx.ts](fx.ts) `USD_CNH_CODE`、`USD_HKD_CODE`、`FXCM_EXCHANGE`、`EXTERNAL_FX_CODES` | FX 同步、研究与基准换算的统一身份 |

共享身份不包含供应商字段映射、响应解析、availableDate 计算或持久化。曲线规则见 [rates](../rates/README.md)，美债／FX 联合同步和人民币换算见 [cross-market](../cross-market/README.md)。Research 的概念绑定保留在自身 catalog，不反向塞入 registry。

改清单先看 [etf-research-registry.test.ts](etf-research-registry.test.ts)、[index-presets.test.ts](index-presets.test.ts) 及相应同步／消费者测试；身份调整的设计取舍见 [核心服务边界设计](../../../../../docs/design/core-business-service-boundaries.md)。

[返回 Market 总览](../README.md)
