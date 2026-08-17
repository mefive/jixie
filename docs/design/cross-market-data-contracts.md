# 跨市场数据契约与数据源矩阵

> 状态：V1 已冻结（2026-08-15）
> 对应 ROADMAP 3.1；实现真相源为
> `apps/api/src/research/cross-market-data-contracts.ts`。

## 1. 为什么它不是一张普通的数据源清单

同名字段在不同市场并不天然可比。`close` 可能是原始成交价、复权价、基金净值代理、期货结算价或曲线点；
同一个 `20260814` 也可能表示上海交易日、纽约交易日、期货夜盘归属日或宏观统计期。只记录“供应商有这个 API”
无法阻止以下错误：

- 用当前仍上市证券重建历史股票池；
- 把可复用的美股 ticker 当成永久证券身份；
- 在中国收盘时读取尚未完成的美国当日数据；
- 把原始收盘价收益写成 total return；
- 把收益率曲线变化写成债券总回报；
- 把上游刷新后的复权因子或宏观最新值冒充当时可知数据；
- 把 API 访问权限误写成产品内再分发权。

V1 因而拆成三个相互引用、但职责不同的对象：

1. **DataContract**：一个序列在身份、时间、币种、公司行动、PIT 和修订上的计算语义；
2. **SourceDecision**：某个具体供应商/接口目前是已接入还是候选，以及许可、历史、限频、成本和审计边界；
3. **Fixture**：用真实代表对象证明字段能表达市场差异，不等于宣告该对象已经有本地数据。

Research Binding 只引用 DataContract 的版本化投影，不再自行复制一套频率、币种和可得日字符串。Research
Catalog 把紧凑契约与来源矩阵交给 Agent；Research Curator 也用同一注册表核验后续对话中出现的数据缺口。

## 2. V1 契约

每个 DataContract 必须同时回答：

| 维度 | 必填决策 |
|---|---|
| 身份 | 平台稳定身份、供应商别名、上市/退市保留、代码变更或期货换月的处理 |
| 时间 | 市场日历、IANA 时区、是否夏令时、交易日归属、跨市场可得顺序 |
| 币种 | 交易币种、报价币种、本币收益、基准币收益、FX 来源与换算时点 |
| 价格 | 原始价、复权因子、total-return 再投资约定，以及不适用的明确声明 |
| PIT | 财务公告时点、宏观 period/releaseDate/availableDate/vintageDate 和回填披露 |
| 修订 | 哪些字段可修订、修订如何进入 data fingerprint，而不是静默覆盖结论 |
| 来源 | 精确 SourceDecision id；`planned` 契约不能被 Agent 当成本地可执行能力 |

V1 已登记：

- 中国内地、香港、美国股票复权日线；
- 沪深 300、恒生和标普 500 跨市场价格指数基准；
- 中国 ETF 复权日线；
- 中国商品期货连续序列；
- 中美国债收益率曲线；
- 中美月度宏观 PIT 序列。

统一基准币收益的公式边界为：

```text
1 + R_base = (1 + R_local) × (1 + R_fx)
```

3.1 冻结公式边界；3.2 已把基准币固定为 CNY，并为跨市场指数同时保留 `R_local`、`R_fx` 和 `R_base`。
美元使用 USDCNH，港币使用 USDCNH/USDHKD，完整实现见
[`cross-market-benchmarks.md`](./cross-market-benchmarks.md)。

## 3. 代表性 Fixture

| Fixture | 供应商标识 | 市场差异被验证的字段 |
|---|---|---|
| 中国股票 | `000001.SZ` | `Asia/Shanghai`、无 DST、CNY、A 股代码继承与退市历史 |
| 香港股票 | `00001.HK` | `Asia/Hong_Kong`、无 DST、HKD、HKEX 日历、当前仅 planned |
| 美国股票 | `AAPL` | `America/New_York`、有 DST、USD、裸 ticker 不作为永久身份、当前仅 planned |
| 中国债券序列 | `chinabond_cgb_ytm\|10` | 曲线/类型/期限联合身份、百分比而非币种回报、下一 SSE 日可得 |
| 中国商品序列 | `AU.SHF` | 连续代码与实际合约分离、夜盘交易日归属、roll gap 与真实区间收益分离 |

这些 fixture 由注册表测试强制引用有效契约，并逐项核对市场、资产类别、时区、DST 和报价币种。香港、美国
fixture 的意义是验证 contract 能表达真实差异；它们在 SourceDecision 中仍是 `candidate`，不会伪装成已经落库。

## 4. 数据源决策矩阵

| 领域 | 当前决策 | 官方能力与历史 | 许可/成本 | PIT 与退市 | 主要限制 |
|---|---|---|---|---|---|
| A 股 | Tushare，`integrated` | 日线、复权、公司行动、财务披露与全历史目录 | 现有积分账号仅限个人非商业使用；商用/再分发须另行授权 | 退市已保留；PIT 部分 | 复权因子和参考历史可修订 |
| 港股 | Tushare，`candidate` | `hk_basic`、`hk_tradecal`、`hk_daily_adj`、`hk_adjfactor` | 正式日线权限单独付费并先 probe；商用/再分发须另行授权 | 官方基础表有生命周期字段，但完整退市/PIT 尚未验收 | 复权因子会刷新；本地 schema/质量审计尚无 |
| 美股 | Tushare，`candidate` | `us_basic`、`us_tradecal`、`us_daily_adj`、`us_adjfactor` | 正式权限先 probe；商用/再分发须另行授权 | `us_basic` 可查 L/D/P 和退市日，但代码复用/PIT 尚未验收 | 裸 ticker 不稳定；本地 schema/质量审计尚无 |
| 中国收益率曲线 | ChinaBond，`integrated` | 官方公开历史工作簿，历史深度由落库审计实测 | 公共端点；再分发权未核验 | 按下载日与 retrievedAt 审计，不涉及退市 | 端点偶发失败；曲线不是债券总回报 |
| 中国商品期货 | Tushare，`integrated` | 合约资料、日结算、主力连续映射；官方目录称日线始于 1996 | 仅限个人非商业使用；商用/再分发须另行授权 | 到期合约保留，映射具 PIT | 连续代码不可直接当可交易合约 |
| 中国 ETF | Tushare，`integrated` | 基础信息、日线与复权因子 | 仅限个人非商业使用；商用/再分发须另行授权 | 退市基金已保留；PIT 部分 | 基金费用、跟踪误差和复权因子修订不能忽略 |
| 中港美价格指数 | Tushare，`integrated` 固定样本 | `index_daily` / `index_global`；五年切片避免 4,000 行截断 | 仅限个人非商业使用；指数商权利与再分发须另审 | 源交易日与中国研究 availableDate 分开 | 只含价格收益；指数不可交易，ETF 代理另算 |
| 美国国债曲线 | Tushare，`integrated` | `us_tycr` / `us_trycr`，明确期限字段 | 仅限个人非商业使用；商用/再分发须另行授权 | source date → 后续 SSE availableDate | 收益率不能替代债券价格/总回报 |
| 中国宏观 | Tushare，`integrated` | 指标接口 + 发布日历 | 仅限个人非商业使用；商用/再分发须另行授权 | release/available/vintage 分开；历史回填明确标注 | 原始发布日期缺失时只能使用保守滞后 |
| 美国 CPI | BLS → OECD → FRED 官方同序列链，`integrated` | 精确 CPI-U All Items NSA；fallback 必须验证维度、基期、连续性和新鲜度 | 公共端点；再分发权未核验 | 后续修订捕获为 vintage；历史是 latest-value backfill | 序列响应无原始发布日期，使用保守滞后 |
| FX | Tushare / FXCM，`integrated` 数据源 | GMT 日线 bid/ask；已验证 USDCNH / USDHKD | Tushare 仅限个人非商业使用；FXCM 权利另审 | 通过 availableDate 防止读到未完成全球日线 | HKD/CNH 为显式交叉推导，不伪装直接报价 |

Tushare 现行数据服务协议明确授予的是个人、不可转让、非商业、可撤销且有期限的许可，仅供个人查看使用。
因此当前项目可继续个人本地研究；若未来对外提供原始数据、下载、商业产品或多用户数据服务，必须取得另行
授权，不能沿用当前 Token。ChinaBond、BLS、OECD、FRED 等来源仍分别保留“再分发权未核验”的 fail-closed
状态，公开可访问不自动等于可再分发。

## 5. 官方核验依据

2026-08-15 核验的主要官方页面：

- [Tushare 权限与历史目录](https://tushare.pro/document/1?doc_id=108)
- [Tushare 数据服务协议](https://tushare.pro/document/1?doc_id=405)
- [港股交易日历](https://tushare.pro/document/2?doc_id=250)
- [港股复权行情](https://tushare.pro/document/2?doc_id=339)
- [美股基础信息](https://tushare.pro/document/2?doc_id=252)
- [美股复权行情](https://tushare.pro/document/2?doc_id=338)
- [期货连续映射](https://tushare.pro/document/2?doc_id=189)
- [外汇日线](https://tushare.pro/document/2?doc_id=179)
- [国际主要指数日线](https://tushare.pro/document/2?doc_id=211)
- [美国实际国债收益率曲线](https://tushare.pro/document/2?doc_id=220)
- [BLS CPI 时间序列目录](https://download.bls.gov/pub/time.series/cu/cu.series)
- [ChinaBond 收益率曲线历史下载](https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyDown)

接口存在、可试用、正式可访问和允许产品再分发是四个不同结论。SourceDecision 的 `reviewedAt`、证据、
权限状态和限制必须随供应商变化更新；添加新市场、资产或来源时，新增契约/来源决策/fixture，并让注册表测试
先失败，再实现 connector。

## 6. 与后续里程碑的边界

3.1 完成的是防止语义债的地基，不包含港股/美股个股行情落库。3.2 已完成以下固定基准切片：

1. 选择中港美代表性基准和可交易代理；
2. 按本契约接入各自日历、时区、报价币种和复权语义；
3. 固定 FX 方向与换算时点，同时输出本币、FX 和基准币三段收益；
4. 用跨市场缺失日和收盘顺序 fixture 验收 Research Plan 与风险报告。

这些实现仍不放宽 3.3：国际宽基指数与中国 QDII 代理不能替代港美个股证券主数据、退市覆盖、公司行动和
财务 PIT。
