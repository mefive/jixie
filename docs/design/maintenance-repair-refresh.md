# Repair 统一区间刷新

日期：2026-10-22。状态：审计修订已再次获用户确认；540 项相关回归、构建及真实 0910 repair 均已通过。

计划提交：`fix(maintenance): unify repair range refresh`。

## 问题与决定

原 repair 默认补缺，`--refresh` 才逐日调用 daily。两条路径准备的数据域不同，最后却接受同一综合审计。真实 `repair 20260910 20260910` 补齐股票和指数后，因商品 FutureDaily 仍只覆盖到 20260909 而失败。此前成功的 `repair 20260814 20260909 --refresh` 不能验证默认补缺路径。

用户确认取消该选项。repair 只有一种语义：重新获取指定区间的数据，重算受影响结果，通过审计后发布。无日期仍使用最近 20 个已完成交易日。

## 执行与范围

1. 在协调器执行发布后处理、清理或创建候选之前校验 repair 参数。只接受零个或两个日期；旧 `--refresh` 明确报错并提示移除，不静默保留另一种模式。
2. 一轮 repair 持有自己的记录和心跳；不再逐日创建 daily 记录。同步日历、股票身份与名称历史、目标区间指数成员，随后预取并保留各交易日的 ETF 候选。
3. 仓单、商品合约和行情、商品持仓、连续收益、外部市场驱动、跨市场基准、国债与信用曲线按区间准备。每个区间同步入口只调用一次。仓单支持显式起点，长区间不截成最后 20 天。
4. daily 与 repair 共用 `workflows/refresh-market-date.ts` 的单日原始刷新顺序：股票日行情及复权、资金流、龙虎榜、指数日行情及估值、申万行业行情、ETF 和部署依赖，然后进行原始质量校验。repair 已准备的国债曲线不再被信号数据准备逐日重复拉取。
5. 候选协调器统一计算派生、校验和审计，再事务发布。直接工作流调用保留末尾校验。repair 保留原日水位，发布按既有协议增加修订；失败和回收继续使用现有 staging 规则。

指定区间是主动刷新的业务范围，不因为原 daily 的 14/21/45 天刷新窗口而逐日重拉前置历史。计算读取本地已有历史；指数成员仍按现有规则补足必要前置锚点，连续收益同步保留其已有 21 个自然日前置映射窗口。必要历史缺失时仍必须显式失败，不能降低质量门槛或宣称所有历史依赖都已自动补齐。

已有不可变股指期货发布凭据仍受原有规则保护；统一刷新不代表允许重写已锁定的账户依赖。实际输入修订影响区间外派生时，仍由既有 impact 计算决定，不能承诺所有区间外数据都不变。

import 的末尾 repair 调用同样改用统一刷新语义，仍只处理原来的最近 20 个交易日，并保留其阶段断点。daily 自愈和初始化补缺、weekly、锁、清理规则不在本次重设计范围内。

## 改动与验证

- CLI/工作流：repair 参数解析、coordinator 早期校验、execute、repair、daily 的单日共用逻辑、import 调用。
- Market/Signals：仓单显式范围、复用已准备国债曲线的选项。
- 文档：维护 README、脚本入口表及本设计。无数据库 schema、migration、HTTP API 或 SDK 契约变化。
- 静态检查：修改文件 Prettier、ESLint、根级 typecheck（包含静态依赖边界及生成契约检查）、`git diff --check`。
- 人工审阅后：相关维护、Market、Signals 回归与构建；用迁移后的隔离 SQLite 验证已有错误价格被重拉修正、0909→0910 的商品行情/持仓依赖、整段准备一次、完整仓单范围、单次计算/发布和水位保持；旧参数在复制候选前失败。
- 真实验证：重新执行 `pnpm maintenance repair 20260910 20260910`，记录下载、计算、审计与发布结果；核对修订、水位、实际历史影响及 staging/owner 回收。若真实输入修订触发区间外变化，核对其真实依赖，不将全部历史指纹不变作为无条件要求。

用户以“YES GO AHEAD”确认本轮代码审阅及验证。全部必需验证通过后按计划提交，不推送。

## 静态检查记录

- 根级 `pnpm typecheck` 通过：shared、API、Docs、sandboxd、Web；生成契约一致，后端依赖扫描 0 违规。
- 修改的 TypeScript 文件 ESLint、Prettier 和 `git diff --check` 通过。
- 上述静态检查在代码审阅前执行；后续行为验证见下。

工作区原有 `maintenance-repair-scope-review.md` 和 `docs/reports/api-landscape-review.md` 保持原样，不纳入本次提交。

## 审阅后的验证记录

- 相关 API 回归：Maintenance、Market、Signals 共 102 个测试文件通过，536 项通过、1 项既有 benchmark 跳过。日志 `/tmp/jixie-repair-refresh-tests-retry.log`。
- 首轮沙箱禁止本地 HTTP 监听；改在允许监听的环境重跑。新参数检查测试原先把 SQLite 自动创建的 WAL/SHM 当成候选产物，已将断言限定到 maintenance/owner 产物，并保留正式控制记录和市场内容检查。测试修正后格式、lint、API 类型检查通过，无产品代码修订。首轮事务回滚用例出现临时库 I/O 错误，正常权限完整重跑通过。
- 全工作区 `pnpm build` 通过；Web/Docs 保留现有 chunk 大小提示。日志 `/tmp/jixie-repair-refresh-build.log`。
- 正式库执行前：dataRevision=8、dailyPublishedThrough=20260730，0910 股票原始及三类指标为空；staging 无候选目录，owner 文件为 0。三类历史指标指纹保存于 `/tmp/jixie-repair-refresh-before.json`。
- 已执行授权的 `pnpm maintenance repair 20260910 20260910`，日志 `/tmp/jixie-repair-refresh-real.log`；运行在综合审计阶段失败，未发布。

## 真实验证失败与修订审阅

运行 ID：`01M5HE8Z8YVBC20JQYCB19F06Z`。

- 快照 248246 ms，准备 84069 ms，原始差量 2416 ms，收尾 13645 ms。
- 候选生成 48 条商品期货行情、3 条持仓、4 条连续收益、4 条仓单；商品持仓和仓单审计通过。派生生成 1 个市场日、34 个指数日、31 个行业日，派生完整性通过。
- 唯一错误类别为商品连续收益：4 条收益均可复算、0 条无效，但四个品种的来源覆盖率都被算为 0%。原因是分母 `productMappings.length - 1` 只计区间内相邻映射，忽略首日可使用区间外前一交易日。单日分母为 0；多日则可能报告大于 100% 的覆盖率。
- 修订按目标交易日历计算预期收益区间，并查询审计起点前的一个交易日；首日存在产品有效历史时计入收益区间。缺失映射不缩小分母。收益公式、95%/99% 阈值、PIT 和账本一致性校验保持。
- 补充真实收益计算路径的单日、跨日、前日结算缺失、目标映射缺失回归；修订后的行为测试尚未执行。
- 正式库仍为修订 8，日水位仍为 20260730，0910 各目标表仍为 0；三类历史指标指纹均不变。失败候选按既有规则清理，回收 8239503510 字节，staging 无候选目录，owner 文件为 0。证据 `/tmp/jixie-repair-refresh-evidence.json`。

修订增加 `market/commodity/commodity-continuous-return-quality.ts` 及同名测试；属于单日 repair 验收所需的审计范围修正，提交信息仍为 `fix(maintenance): unify repair range refresh`。依 review-gated-development 要求，产品修订完成静态检查后回到人工审阅；通过后重跑受影响回归、构建及真实 0910 repair，全部通过才提交。

修订静态检查已通过：根级 typecheck（全部 workspace、生成物、依赖边界）、修订文件 ESLint/Prettier、diff 检查；日志 `/tmp/jixie-repair-refresh-audit-fix-typecheck.log`。真实测试进程 PID 75161 已退出。修订后尚未重跑行为验证。

## 修订审阅后的验证

用户再次“确认”后执行：

- Maintenance、Market、Signals：102 个测试文件通过，540 项通过，1 项既有 benchmark 跳过。日志 `/tmp/jixie-repair-audit-retest.log`。
- 修订后的 API 构建通过，日志 `/tmp/jixie-repair-audit-build.log`；此前其他工作区构建已通过，本次修订仅涉及 API。
- 真实 repair 重跑 ID `01M5HF028QNEB6GB5N6P1YNPDH`，日志 `/tmp/jixie-repair-audit-real.log`。开始前主库仍为修订 8、日水位 20260730；对照保存于 `/tmp/jixie-repair-audit-before.json`。

## 最终验证与交付

- 真实运行 `01M5HF028QNEB6GB5N6P1YNPDH` 正常退出，正式记录 `status=done`、`phase=done`、`stage=complete`，发布修订 **9**（之前为 8）；日水位按 repair 契约保持 **20260730**。
- 综合审计 **0 错误、4 类警告**。商品仓单、持仓、连续收益均通过，AU/CU/SC/M 单日连续收益来源覆盖率均为 **100%**。警告来自 ETF 来源、财报勾稽、宏观 PIT 和宏观轴就绪程度，没有为本次通过降低门槛。
- 正式库 0910：Daily=5549、DailyBasic=5549、AdjFactor=5561；市场指标=1、指数指标=34、行业指标=31；商品期货行情=48、持仓=3、连续收益=4、仓单=4。
- 0910 之前的 MarketIndicator、IndexIndicator、IndustryIndicator 行数及完整内容指纹与运行前一致。参考资料实际差量按发布清单保存。
- 快照 234176 ms、准备 153175 ms、原始差量 1992 ms、计算/审计 11693 ms、最终差量 517 ms、发布 1755 ms；整轮约 6 分 43 秒。
- 候选已按 published 凭据清理，回收 8239598248 字节；staging 仅保留既存 `.DS_Store`，owner 文件为 0。运行正常退出，未启动额外测试服务。
- 证据：`/tmp/jixie-repair-audit-real.log`、`/tmp/jixie-repair-audit-before.json`、`/tmp/jixie-repair-audit-after.json`、`/tmp/jixie-repair-audit-evidence.json`。

实现、回归及验证记录一并按约定信息提交。两份原有未跟踪复核报告不纳入，不推送。
