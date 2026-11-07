# Tushare 通道与供应商适配

同步函数接收本目录的 client，通过 [api.ts](api.ts) 中的具名适配入口取得行对象；各领域负责覆盖校验、可得日和写库，provider 不决定整轮数据发布。

[tushare-client.ts](tushare-client.ts) 的 `TushareClient.call(apiName, params, fields)` 解码供应商列式响应。[tushare-request-limiter.ts](tushare-request-limiter.ts) 统一请求发起间隔、滚动分钟／日预算、连接数与 429 冷却；分页及重试均计入实际 HTTP 次数。持久配额发送前 fsync，跨 Run 和重启保留，账号身份只存散列；同一配额目录内同 token 的发送进程互斥。`ready()` 在改动 Run 前检查账号所有权，`close()` 等待连接结束再释放锁。

网络／5xx 有界重试，429 优先读取 Retry-After；Tushare 业务拒绝不猜文案、不自动重试。所有等待支持取消，响应结束后释放连接。CLI 使用默认 4 路和全局 75 次／分钟，直接构造客户端默认 1 路；实际额度由配置显式指定。

[config.ts](config.ts) 的 `loadTushareConfig` 从环境取得配置并校验，不创建连接。api.ts 的 daily、fundDaily/fundAdj、incomeStatement 等入口维护各接口参数和字段转换，不复制领域持久化。具体请求字段以对应入口为准。

[capability-catalog.ts](capability-catalog.ts) 维护能力探测定义；[asset-allocation-probe.ts](asset-allocation-probe.ts) 的 `probeAssetAllocationData` 会发出真实供应商请求；[capability-probe-store.ts](capability-probe-store.ts) 的 `persistTushareCapabilityProbes` 写库，`latestTushareCapabilityProbes`／`tushareCapabilityProbesAreFresh` 读取结果。探测不是普通读取自动发生的步骤。

改字段适配看同目录 `*-api.test.ts`，如 [financial-statement-api.test.ts](financial-statement-api.test.ts)、[etf-api.test.ts](etf-api.test.ts)；探测看 [asset-allocation-probe.test.ts](asset-allocation-probe.test.ts)。调用方的范围替换／空数据规则仍须查看 [stocks](../../stocks/README.md)、[etfs](../../etfs/README.md) 等领域说明。

[返回 Market 总览](../../README.md)

维护入口使用 [request-contract.ts](request-contract.ts) 的允许参数及单响应／分页声明。快照接口不伪造 limit/offset；到达保守安全上限时拒绝宣称完整。分红按证券取完整响应，在领域内按报告期筛选，不能发送文档没有定义的 start_date/end_date。列式解码严格检查状态、fields/items、唯一字段、行宽、标量类型及请求字段；损坏的响应不能变成允许覆盖旧值的空集。业务单位保持来源定义：行情价格元、成交量手、成交额千元；股票／指数市值万元；报表金额元、total_share 股；分红 cash_div 税后、cash_div_tax 税前。

结构合法的 `fields: [], items: []` 可进入领域空响应规则；缺少数组或有行却缺请求字段仍拒绝。此区分兼容[官方 Python 客户端](https://github.com/waditu/tushare/blob/master/tushare/pro/client.py)的列式解码方式，不将空响应解释为所有业务均已完成。


股票日数据与 VIP 财务数据的分页大小由 request-contract.ts 分别声明；允许更小的测试／专用分页，但不超过声明大小。满页继续请求，重复页与有限分页截断仍不能视为完整。页面重复检测保存摘要，不保存所有页面的原始文本；该传输摘要不改变业务指纹或来源版本 hash。财报按公告日期连续区间采集，指标仍按季度 period；满页和分页边界由正式来源下载入口处理。


并发设计与恢复边界见 [采集并发设计](../../../../../../docs/design/ingestion-concurrency.md)。实际传输时段与限流等待通过独立异步上下文按批次记录，缓存回放不重复计费。数据接纳、版本选择与发布仍归领域及 Ingestion。
