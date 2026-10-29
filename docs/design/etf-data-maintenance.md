# ETF 下载、退市维护与旧目录清理

日期：2026-10-29。状态：产品代码已通过人工审阅；静态检查、相关回归、源码／编译 CLI 和构建验证全部通过，准备按既定消息提交。真实开发／生产库尚未执行清理或补数。

提交信息：`fix(market): skip pending ETFs and bound delisted downloads`。

## 已确认的业务流程

1. 同步全部已上市 L 与退市 D 基础资料，在字段映射和校验前跳过待上市 P。
2. 首次使用最近可用同日规模快照，在已上市产品中选择前 100。目录、快照与名单沿用现有原子提交规则；失败保留旧结果。
3. 日常沿用保存名单；只有显式 select-top 才重新排名，人工空名单不自动重置。
4. 已上市代码补近期与历史；退市代码只补到退市日。单代码边界不足时报告原因，其他代码继续。
5. 合法行情和复权按现有分区写入、核验覆盖并继续有限轮换；保留实际记录日期与 verifiedThrough 的区别。

这次不实施此前较宽的目录可空化、交易规则三态、事务拆分或 SDK 改造提案；不改数据库 schema 和现有回测交易规则。

## 故障依据

本次真实库的 ETF 最新行情日是 2026-09-11，当天有 82 个代码的记录；2026-09-15 未新增 ETF 行情。ETF 下载名单未初始化。

真实来源新增的 `158025.OF`、`515470.OF`、`158079.OF` 均为待上市 P，缺少分类补充，最后一条还缺交易所。原映射在分类不足时不生成 sameDayTurnover，写入要求该字段及交易所齐全，导致首次初始化回滚。筛掉 P 必须发生在映射和写入校验之前，不能只在规模排名阶段过滤。

开发库另有 60 条旧 P 目录。此前只读检查未发现它们具有行情、复权、规模、分区或下载名单引用；正式清理仍需重新检查完整保护条件，不能直接按这个旧数量删除。

来源参考：[ETF 基础信息](https://tushare.pro/document/2?doc_id=385)、[ETF 份额规模](https://tushare.pro/document/2?doc_id=408)。规模按其实际发布日期取得，不承诺所有产品同一时刻齐备；当前排名不表示历史各时点排名。

## 上市／退市边界

- `market/etfs/sync-partition.ts` 在映射前排除 P，只接纳 L 与 D；未知状态明确报错，不默认上市。退市目录和历史不删除。
- `market/etfs/download-range.ts` 为名单查询、调度和缺口汇总提供同一个纯生命周期判断。
- 退市日期缺失、非法或早于回补起点时，保留代码和数据，暂缓该代码下载并报告具体原因。未知目录及遗留 P 名单代码同样显式阻塞。
- 有效退市日期作为 endDate，与目标日及已完成日共同约束窗口；旧失败窗口若超过退市日，不得原样继续请求越界日期。
- 保持现有缺上市日期时的 2015 基线，本次不扩大为上市边界重设计。
- 退市不会自动移出保存名单；新规模选池仍只从 L 中选择。历史 Research、Factor 与回测的读取路径不因本修复新增限制。
- CLI list 增加生命周期和 download 范围／blockedReason；Maintenance 将阻塞列入 gaps，覆盖摘要不把阻塞对象当作已有完整资格。

## bootstrap 离线清理

顺序为：停服并持 M/P/R → 构建并完成 schema 迁移／旧分红恢复 → 清理预检 → 必要时备份 → 清理事务 → 标记升级数据就绪 → 启动 API → 正常有限 sync。

入口：`apps/api/src/market/cli/cleanup-pending-etfs.ts`；生产使用 `dist/src/market/cli/cleanup-pending-etfs.js`。

- 仅接受 `check|apply /absolute/path/database.db`，要求文件已存在。不读取默认开发库或 .env，不访问 Tushare；支持独立运行，并复用／验证 bootstrap 继承的真实锁描述符。
- check 的 stdout 仅返回可删数量；保护记录与原因写 stderr。预检无业务写入。
- apply 在短发布事务中重新检查，只有无保护依据的 P 目录可删；删除目录和推进 revision 在同一事务完成，失败回滚。
- 保护依据包括价格、复权、规模、旧 EtfSyncSlice、DatasetSyncState、DatasetSyncPartition、任何保存名单引用，以及 P 记录已有上市日期的矛盾状态。只删除目录，不改用户源码、报告或任何行情。
- bootstrap 有可删记录才备份和执行；使用备份根目录下独立 `pending-etf-cleanup/`，避免同秒备份覆盖迁移前快照。预检、备份、清理失败均保持 API 停止。
- 重复运行没有可删记录则不再备份、删除或推进 revision；受保护记录保留并报告，不将业务异常伪装成无条件删除。
- bootstrap 阶段不等待外部目录刷新。离线移除无依赖的旧 P 元数据；来源中后来成为 L 的产品由正常同步重新收录。

本次没有新包／workspace 或跨包构建依赖。新 CLI 位于 API 已有部署路径，bootstrap 已属于全量部署路径；不新增专门部署组件。

## 审阅入口与范围

- `market/etfs/{sync-partition,download-range,cleanup-pending}.ts`：筛选、边界与安全清理。
- `market/downloads/lists.ts`、`market/synchronization/scopes.ts`、`maintenance/{partitions,status}.ts`：名单、窗口、缺口的一致行为。
- `market/cli/cleanup-pending-etfs.ts`、`scripts/bootstrap.sh`：显式目标数据库、备份与失败停服。
- 根 CLAUDE、Market／Maintenance／命令索引及中英帮助：当前目录范围和退市维护口径。

不修改此前遗留的独立 `docs/reports/api-landscape-review.md`。

## 已通过的行为验证

1. 真实三条缺字段 P 夹具不阻断首次 100 只选池；L 与 D 目录都保留，D 不参与排名。
2. 价格与复权均受退市日封顶；旧越界失败分区不重新请求越界日期；缺退市日与遗留 P 仅阻塞自身，名单和历史保持。
3. 离线预检无业务写入；所有保护条件有效；只删除无依赖 P，L／D 不变；重复执行不再改变 revision。
4. 模拟 revision 写入失败，删除事务整体回滚。
5. 源码及编译 CLI 显式指定隔离库，不受错误默认 DATABASE_URL 或缺 Tushare 配置影响，参数非法不加载业务；进程、连接及锁正常退出。
6. bootstrap 在迁移／恢复后清理，有数据才额外备份；预检、非法数量、备份、清理失败均不自动启动 API；无数据与无关部署不执行删除。
7. 运行相关 Market／Maintenance／CLI 回归及部署脚本回归，完成 shared／API 构建和编译入口检查；如失败只修正原因，不放宽断言。

## 静态检查与交付状态

静态检查通过：五 workspace 类型检查、SDK 生成物一致性、后端依赖边界（679 文件，0 违规）、变更 TS／MJS 的 ESLint 与格式、bootstrap Bash 语法、部署测试文件 Node 语法、文档相对链接与 diff 空白检查。人工审阅通过后，Market／Maintenance／CLI 共 13 文件、68 项回归通过；市场协调 10 项通过；部署脚本 31 项和边界检查器自测 36 项通过。编译模式再跑清理文件 3 项全部通过，包含真实编译 CLI 对显式隔离库的预检／清理／重复执行。shared、API 和 Docs 构建通过；Docs 仅有既有大 bundle 提示。没有修改产品代码或放宽测试断言，测试数据库和子进程均由夹具回收，未启动常驻服务。按既定消息提交，不推送。清理实际生效于后续 bootstrap；未运行真实库清理、Tushare 下载或生产部署。
