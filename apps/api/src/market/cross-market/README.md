# 跨市场基准、人民币换算与外部驱动

| 文件 / 入口 | 消费者与副作用 |
| --- | --- |
| [benchmark-sync.ts](benchmark-sync.ts) `seedCrossMarketBenchmarks`、`syncCrossMarketBenchmarks` | CLI／Maintenance；前者将静态注册表落库，后者按来源和日期分段同步基准；`parseCrossMarketBenchmarkRows` 负责响应校验 |
| [benchmark-conversion.ts](benchmark-conversion.ts) `deriveBenchmarkCnyCloses`、`deriveHkdCnhMidCloses` | Research datasets/series 的读取路径；纯函数，根据输入基准／FX 序列生成 CNY 序列与 HKD/CNH 中间价，不查库 |
| [external-drivers.ts](external-drivers.ts) `syncExternalMarketDrivers` | Maintenance 和 CLI；年度分段联合获取美债名义／实际收益率、FX 及日历，解析并持久化 |

基准身份在 [registry](../registry/README.md)，包括 USD/CNH、USD/HKD 和曲线 source/code；本目录拥有供应商字段、解析和换算，不反向把同步导入 registry。币种换算须保留原币及 FX 方向，不能把美元价格直接当人民币收益。

`assignExternalAvailableDates` 将外部观测映射到严格晚于观测日的下一 SSE 开市日。观测日与 availableDate 是不同字段；联合获取不代表原子联合发布：名义曲线、实际曲线、每个 FX 代码各自范围替换、分别提交。对应切片为空时保留原数据，不用空响应擦除历史。

改映射／空响应／解析看 [external-drivers.test.ts](external-drivers.test.ts)；改币种换算看 [benchmark-conversion.test.ts](benchmark-conversion.test.ts)，消费者的数据口径还需看 [Research 跨市场契约](../../research/datasets/cross-market-data-contracts.test.ts)。

[返回 Market 总览](../README.md)
