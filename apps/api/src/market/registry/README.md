# 共享市场身份与清单

本目录只维护静态身份、分组和校验，不导入数据库、供应商或同步实现。消费者应直接导入所需文件，导入不会注册落库。

| 文件 / 入口 | 消费者与用途 |
| --- | --- |
| [etf-research-registry.ts](etf-research-registry.ts) `ETF_RESEARCH_REGISTRY`、`ETF_RESEARCH_CODES`、`etfResearchMembership`、`validateEtfResearchRegistry` | ETF 同步／审计、Research、Factor；研究产品分类、选择依据与成员校验 |
| [etf-presets.ts](etf-presets.ts) `MAJOR_ETF_CODES` | 既有主要 ETF 预设，不与研究清单混用 |
| [index-presets.ts](index-presets.ts) `DAILY_MAINTAINED_INDEX_CODES`、`MAJOR_INDEX_DAILY_BASIC_CODES` 及历史成分／原始行业范围 | 指数同步、官方估值与历史股票池 |

共享身份不包含供应商字段映射、响应解析、availableDate 计算或持久化。宏观、曲线、FX 和跨市场基准身份已退役。Research 的概念绑定保留在自身 catalog，不反向塞入 registry。

改清单先看 [etf-research-registry.test.ts](etf-research-registry.test.ts)、[index-presets.test.ts](index-presets.test.ts) 及相应同步／消费者测试；身份调整的设计取舍见 [核心服务边界设计](../../../../../docs/design/core-business-service-boundaries.md)。

[返回 Market 总览](../README.md)
