# Tushare 通道与供应商适配

同步函数接收本目录的 client，通过 [api.ts](api.ts) 中的具名适配入口取得行对象；各领域负责覆盖校验、可得日和写库，provider 不决定整轮数据发布。

[client.ts](client.ts) 的 `TushareClient.call(apiName, params, fields)` 把列式 fields/items 映射成行对象。每个实例使用一条 Promise 队列，按最小间隔串行实际请求；失败不会破坏后续队列，但原调用仍收到错误。`TushareError` 表示供应商 code 非零，直接抛出不重试；其他 fetch、HTTP 非成功、解析或网络错误进入有界重试。每次请求的 timeout timer 在 finally 清理。不能把队列误写成跨 client 的全局限流。

[config.ts](config.ts) 的 `loadTushareConfig` 从环境取得配置并校验，不创建连接。api.ts 的 daily、fundDaily/fundAdj、futureDaily、incomeStatement 等入口维护各接口参数和字段转换，不复制领域持久化。具体请求字段以对应入口为准。

[capability-catalog.ts](capability-catalog.ts) 维护能力探测定义；[asset-allocation-probe.ts](asset-allocation-probe.ts) 的 `probeAssetAllocationData` 会发出真实供应商请求；[capability-probe-store.ts](capability-probe-store.ts) 的 `persistTushareCapabilityProbes` 写库，`latestTushareCapabilityProbes`／`tushareCapabilityProbesAreFresh` 读取结果。探测不是普通读取自动发生的步骤。

改字段适配看同目录 `*-api.test.ts`，如 [financial-statement-api.test.ts](financial-statement-api.test.ts)、[etf-api.test.ts](etf-api.test.ts)、[futures-api.test.ts](futures-api.test.ts)；探测看 [asset-allocation-probe.test.ts](asset-allocation-probe.test.ts)。调用方的范围替换／空数据规则仍须查看 [stocks](../../stocks/README.md)、[etfs](../../etfs/README.md) 等领域说明。

[返回 Market 总览](../../README.md)
