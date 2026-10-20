# 维护写入逻辑复用与竞态审阅表

日期：2026-10-20。范围：现有 Maintenance 调用的 Market 写入链、相关后续任务及锁。本文区分现状与改造建议，仅作静态代码分析，不表示已完成并发实测。本次不修改业务代码或主设计文档。

结论：很多业务已有稳定的写入规则，可以复用其映射、校验和增删改语义；但多数函数绑定全局 Prisma、自行开启局部事务，并同时下载数据，不能原样作为第二阶段回填函数。商品等显式接收数据库的函数也常要求完整 Prisma Client 并开启事务，不等于已经可以接收外层 TransactionClient。

## 1 如何判断可复用

| 分类 | 含义 | 回填时要做什么 |
| --- | --- | --- |
| 规则可复用，需拆写入 | 范围和数据映射明确，但下载、校验、写库绑在一起 | 第一阶段保存规范化候选；抽出接收候选和外层事务的具名业务写入函数 |
| 已有候选分离，需适配事务 | 已把取数与候选写入分开 | 保留候选结构和校验；写入端改接外层事务，不再自行开正式事务 |
| 需专门处理 | 涉及全表删除、稳定身份、PIT 版本、跨表迁移或计算 SQL | 保留业务规则，显式设计发布范围、ID、删除和关联变更 |
| 发布后复用 | 写的是用户状态，不属于市场回填 | 在正式库独立执行、幂等恢复，不复制暂存结果 |

复用现有规则不代表第二阶段重新调用第三方接口、重新计算或重新生成时间戳／ID；第二阶段使用第一阶段已冻结、已审计的候选。

## 2 市场数据写入明细

### 行情与基础资料

| 业务与入口 | 当前写入方式及事务 | 可复用部分 | 必须单独处理的边界 |
| --- | --- | --- | --- |
| [日历 syncTradeCal](/Users/liucong/Projects/jixie/apps/api/src/market/calendar/sync.ts:12) | 按交易所＋请求日期区间 deleteMany，再 createMany；单事务 | 规则可复用，需拆写入：字段映射、范围替换 | 当前按请求范围删除，不限于返回日期；空／部分响应不能未经完整性判断直接发布 |
| [股票四表日更 syncStockDailyData](/Users/liucong/Projects/jixie/apps/api/src/market/stocks/daily-sync.ts:39) | 四类候选全部获取、规范化并校验后，按交易日替换 Daily、AdjFactor、DailyBasic、StkLimit；单事务 | 候选校验、代码归一和四表一致写入语义 | 映射／校验与下载仍在同函数；需冻结四表候选并接受外层事务，不能分别发布 |
| [股票历史／单表同步](/Users/liucong/Projects/jixie/apps/api/src/market/stocks/daily-sync.ts:204) | 按已有日期决定是否跳过；每个日期替换行情＋复权，basic／limit 有各自入口和事务 | 日期分块、映射与局部写入规则 | “某日有行”不是完整性证明；首次复制基线已有行会影响跳过逻辑，修复需明确补缺或刷新 |
| [资金流与龙虎榜](/Users/liucong/Projects/jixie/apps/api/src/market/stocks/flows-sync.ts:17) | 按交易日删除并写回；龙虎榜先按证券汇总；每日期一个事务 | 汇总、金额口径、日期切片写入 | 空结果可有业务意义；distinct 日期恢复不能证明覆盖完整，无行日期也没有完成证据 |
| [股票基础资料与历史名称](/Users/liucong/Projects/jixie/apps/api/src/market/stocks/basic-sync.ts:21) | StockBasic 汇总上市状态后全表替换；StockNameHistory 规范化并补当前名后全表替换；代码接续表按 oldTsCode upsert | 映射、名称区间处理、接续清单可复用 | 原规则是全表，不是仅追加；暂存复制范围必须足以表达删除。正式采用明确键差异，不能拿局部候选清空全表 |
| [ETF 基础资料与历史导入](/Users/liucong/Projects/jixie/apps/api/src/market/etfs/history-sync.ts:23) | 基础资料整表替换；历史按证券／区间替换日线和复权，同时 upsert EtfSyncSlice | 字段映射、历史分块、部分覆盖校验 | 基础资料需差异发布；历史完成标记不能单独证明实际覆盖，标记和真实候选必须对应 |
| [ETF 日更 prepare／publishPrepared](/Users/liucong/Projects/jixie/apps/api/src/market/etfs/sync.ts:223) | 已先生成 PreparedEtfMarketDate；写入端按 activeCodes＋日期，在单事务替换日线、复权及份额 | 最接近可直接复用：候选结构、覆盖检查和三表写入规则 | 当前 writer 仍绑定全局 Prisma 并自己开事务；需适配外层事务，保留 availableDate 和允许缺日线的名单 |
| [ETF 份额单独同步](/Users/liucong/Projects/jixie/apps/api/src/market/etfs/sync.ts:337) | activeCodes＋日期删除后写回；strictCoverage 可关闭 | 同日份额候选和可得日期规则 | 非严格模式可能用部分响应替换整组选定证券，不能当成补缺复用 |
| [ETF 历史补缺](/Users/liucong/Projects/jixie/apps/api/src/market/etfs/sync.ts:23) | 下载后在事务内再查缺键，只插缺失的日线、复权、份额 | 缺键重查与只插缺键规则可复用 | 回填时在正式事务内再次确认缺键；源缺失观察与真正完成分开，不因有断点就跳过实物校验 |
| [ETF 修订与恢复](/Users/liucong/Projects/jixie/apps/api/src/market/etfs/sync.ts:448) | 修订逐日调用日更替换，对比前后快照计算最早变化日；recovery 另协调历史补缺和断点 | 日更 writer、修订影响范围、恢复计划可复用 | 最早变化日不是逐键变更清单；还需记录实际增改删、失效的派生范围及候选身份 |
| [指数行情／估值／行业行情](/Users/liucong/Projects/jixie/apps/api/src/market/indices/sync.ts:187) | 指数按代码＋窗口、行业行情按选定行业代码＋区间删除重写；各切片独立事务 | 分块和字段映射、范围替换 | 删除范围可能大于实际响应日期；候选完整性与明确删除必须保留，不能只 upsert 返回行 |
| [指数权重及成员修订](/Users/liucong/Projects/jixie/apps/api/src/market/indices/sync.ts:25) | 权重按指数＋月／季区间替换；空响应保留已有，检查单日权重和；成员包装比较前后找最早变化 | 权重完整性、空响应保留、历史影响检测 | 非空响应仍按整个切片删除；需区分缺失快照与撤销。成员及派生结果联合发布 |
| [行业成员与官方指数目录](/Users/liucong/Projects/jixie/apps/api/src/market/indices/sync.ts:111) | SwIndustryMember 获取当前／历史后去重、整表替换；IndexBenchmark 也整表替换 | 去重、历史关系和官方目录映射 | 不适合通用增量追加；以完整来源或完整基线生成明确键差异，删除也属于变更 |
| [期货合约、行情、映射及结算](/Users/liucong/Projects/jixie/apps/api/src/market/futures/sync.ts:30) | 合约按产品组替换；日线／结算按实约有效区间替换；映射按连续代码＋日期区间替换；多个局部事务 | 产品范围、有效期裁剪、映射和写入规则 | 四类输入需要整轮外层事务；股指与商品产品组不得互删，空／部分响应保持业务判断 |
| [期货不可变日期快照](/Users/liucong/Projects/jixie/apps/api/src/market/futures/publication.ts:12) | 已有日期直接返回；新日期从四类表读取并校验后，upsert create，update 为空 | 输入校验、payload/hash、只创建语义可复用 | 专门处理：发布冻结 payload，不在主库回填时重算；同日不同 hash 必须识别冲突，不能被 update:{} 静默掩盖 |

### 财报、宏观、跨市场与商品

| 业务与入口 | 当前写入方式及事务 | 可复用部分 | 必须单独处理的边界 |
| --- | --- | --- | --- |
| [财务指标 FinaIndicator](/Users/liucong/Projects/jixie/apps/api/src/market/fundamentals/reference-sync.ts:256) | 按报告期或证券先读旧值，区分 created／updated，再事务 createMany 和按 tsCode＋endDate update；不删除来源未返回行 | 已有差异识别、字段比较及业务键最值得复用 | 比较发生在事务外且函数私有；回填需传候选、外层事务并验证正式基线，不能用旧比较覆盖并发新值 |
| [分红 Dividend](/Users/liucong/Projects/jixie/apps/api/src/market/fundamentals/reference-sync.ts:386) | 比较证券级行多重集合；不变不写，空源保留；变化则该证券全部删除、生成新 ULID 重建，单事务 | 空源保留、无变化跳过、来源规范化 | 专门处理：当前并非稳定逐行 upsert。应冻结候选 ID；若要保留未变化行 ID，需要另定匹配规则，不能声称现成可复用 |
| [三类财报版本](/Users/liucong/Projects/jixie/apps/api/src/market/fundamentals/sync.ts:341) | 规范化、生成来源指纹和可得时间；查已有 fingerprint 后分批追加；三表用 Promise.all，非一个总事务 | 版本映射、指纹去重及追加规则；已有窄数据库参数 | writer 私有且与归一／时间生成相连，回填需冻结规范行及 ID；先查再插仍有竞态，正式事务及唯一键校验不可省 |
| [财报修正证据](/Users/liucong/Projects/jixie/apps/api/src/market/fundamentals/sync.ts:66) | 按 source＋sourceId upsert，随后对唯一匹配的报表版本更新 evidence／availability 字段；本函数不包总事务 | 已导出，接收窄数据库依赖，事务接入基础较好 | 不是纯追加：证据与已有报表会一起变化。回填冻结 ID、observedAt 和关联更新，不重复生成审计身份 |
| [中国宏观与美国 CPI](/Users/liucong/Projects/jixie/apps/api/src/market/macro/china-macro.ts:290)／[CPI](/Users/liucong/Projects/jixie/apps/api/src/market/macro/us-headline-cpi.ts:716) | 目录 upsert；中国还 upsert 发布日程；比较最新观察后按 seriesKey＋period＋vintageDate upsert，分批事务 | 观察比较、版本身份和可得时间规则 | 同一天 vintage 可 update，并非绝对不可变追加；目录、日程、观察当前并非总事务；回填不能改成发布时间当天或重新生成 retrievedAt |
| [中国国债](/Users/liucong/Projects/jixie/apps/api/src/market/rates/china-treasury-curve.ts:170)／[信用曲线](/Users/liucong/Projects/jixie/apps/api/src/market/rates/chinabond-credit-curves.ts:250) | 按年请求，空源跳过；非空按 source＋curveCode／type＋整个请求日期范围删除重写 | 曲线映射、期限／可得日期校验、来源隔离 | 当前删除整个请求区间，不只是返回日期；直接 upsert 无法表达既有删除，回填前需确认候选覆盖语义 |
| [海外曲线与外汇](/Users/liucong/Projects/jixie/apps/api/src/market/cross-market/external-drivers.ts:261) | 曲线按来源／代码／类型／区间替换，外汇按代码／区间替换；空响应跳过，各自事务 | 单位、时区、可得日期、外汇校验及写入范围 | 多序列非一个事务；需冻结 retrievedAt，并保留每条序列的实际增改删，不用统一“海外数据全表替换” |
| [跨市场基准](/Users/liucong/Projects/jixie/apps/api/src/market/cross-market/benchmark-sync.ts:122) | 目录先 upsert；按基准＋五年窗口替换非空响应的日线 | 基准身份、窗口与可得日期规则 | 目录和日线不是总事务，需纳入统一正式发布；窗口替换不等于仅插新日期 |
| [商品仓单](/Users/liucong/Projects/jixie/apps/api/src/market/commodity/commodity-warehouse-receipts.ts:248) | 接收 database；按产品／月下载，空源保留；只删除来源实际返回日期后写入，切片事务 | 返回日期限定、空源保留及标准化可直接复用规则 | 数据库参数仍包含 $transaction；需拆 writer 接外层事务。与持仓的空值删除语义不同 |
| [商品持仓](/Users/liucong/Projects/jixie/apps/api/src/market/commodity/commodity-holding-positions.ts:399) | 接收 database；按代表合约范围获取；删除该产品代表日期，再写有结果的点，允许没有点 | 代表合约选择、聚合、日期范围 | 专门明确删除：空源可能清掉代表日期旧值，不能照搬仓单“只删返回日”。需审计是否符合目标缺失规则 |
| [商品主力映射及连续收益](/Users/liucong/Projects/jixie/apps/api/src/market/commodity/commodity-continuous-returns.ts:85) | 映射全部候选校验后，按产品／区间一事务替换；computeCommodityContinuousReturns 读库计算，rebuild 按日期区间替换输出 | 构造／计算已有独立入口、显式 database，边界较清楚 | 发布只复制冻结的映射和收益结果，不重跑计算；查询范围与输出删除范围可能涉及多个产品，必须完整记录 |
| [证券代码归一](/Users/liucong/Projects/jixie/apps/api/src/market/instruments/canonicalize-stock-codes.ts:117) | 每个代码对单事务，多表按稳定键查冲突、迁移新键、删除旧键；报表／证据直接更新代码 | 既有等价／冲突规则可复用 | 专门处理：跨表删除、版本 ID 和派生影响；不能把整个函数原样用于主库，重新比较会偏离已审计候选 |
| [市场、指数及行业指标](/Users/liucong/Projects/jixie/apps/api/src/market/state/sync.ts:27) | 按年切片；事务中建临时表、SQL 计算、删除输出日期范围并 INSERT 三类指标；单切片事务 | 计算 SQL 可用于暂存阶段，三类输出范围可复用 | 正式回填不重跑 SQL，不复制临时表；冻结输出并接外层事务。年度局部事务不等于整轮原子 |

表中“全表替换”是现有实现事实，不建议在正式回填时原样照搬。转成逐键差异时必须包含删除，并证明暂存初始化包含必要基线；反过来，完整切片合法删除也不能因“只回填变化行”而丢失。

### 后续任务与控制状态

| 业务 | 当前写入与并发控制 | 复用判断 |
| --- | --- | --- |
| [因子气象](/Users/liucong/Projects/jixie/apps/api/src/factor/weather/refresh.ts:118) | 计算后事务替换 pin 全部或增量点，再更新 pin；activeRefreshes Map 只在本进程去重 | 发布后复用，不从暂存回填。API 与维护 CLI 是不同进程，Map 不构成跨进程锁，需校验 pin／方法／输入修订 |
| [信号和账户调度](/Users/liucong/Projects/jixie/apps/api/src/signals/daily/scheduler.ts:27) | 账户结算后按部署逐个 enqueue／claim／execute；整批无总事务 | 发布后复用；保留 Job 认领，补提交后调度的持久化恢复 |
| [新版账户重放](/Users/liucong/Projects/jixie/apps/api/src/signals/accounting/versioned-replay.ts:323) | 候选 generation 后，以 accountInputRevision＋当前 generation 条件更新发布指针，失败抛错 | 已有 CAS 机制应保留；不把成交和账户复制回主库，不以维护锁替代业务并发控制 |
| [旧版账户结算](/Users/liucong/Projects/jixie/apps/api/src/signals/accounting/settlement.ts:88) | fullReplay 先删非基线快照，后按日期分别事务保存；无整轮总事务 | 不当作市场原子回填的一部分；独立说明失败边界，不能假定等同新版 generation 发布 |
| [运行／水位](/Users/liucong/Projects/jixie/apps/api/src/maintenance/runs/state.ts:117)／[水位](/Users/liucong/Projects/jixie/apps/api/src/maintenance/publication/watermark.ts) | begin 按 kind＋targetKey 查后更新／创建，水位有自己的事务；运行成功另写 | 业务字段可复用，事务边界需改：正式市场、水位、发布凭据共同提交；运行记录不是互斥锁 |

## 3 现有锁究竟保证了什么

生产的标准维护入口目前确实靠同一把操作系统 flock 串行化，不依靠数据库 running 状态抢占。锁是协作式的：只有使用相同锁文件并主动加锁的进程互斥。

| 入口 | 当前覆盖 | 边界 |
| --- | --- | --- |
| [每日／每周 systemd 服务](/Users/liucong/Projects/jixie/deploy/jixie-maintenance.service:16)／[周服务](/Users/liucong/Projects/jixie/deploy/jixie-maintenance-weekly.service:17) | 都使用 `/var/lib/jixie/maintenance.lock`，`flock -n -E 75` 包住整个 CLI | 第二个进程抢不到立即退出 75，不是排队；由服务重试策略决定何时再跑 |
| [根级 pnpm maintenance、import:data](/Users/liucong/Projects/jixie/package.json:23)／[锁包装](/Users/liucong/Projects/jixie/scripts/maintenance/with-maintenance-lock.sh:26) | 生产环境取数据目录下 maintenance.lock，成功后传 LOCK_HELD=1；daily／weekly／repair／baseline 经该入口共用 | 非生产直接执行不加锁；数据目录／覆盖变量不同会锁到不同文件，必须与 systemd 路径一致 |
| [bootstrap 部署](/Users/liucong/Projects/jixie/scripts/bootstrap.sh:807) | FD 9 持有同数据目录 maintenance.lock，主要部署阶段不与维护并发 | 激活维护前显式释放；初始化脚本重新获取锁。另有 bootstrap 自己的锁，不是同一个职责 |
| [assertProductionLock](/Users/liucong/Projects/jixie/apps/api/src/maintenance/runs/coordination.ts:42) | 生产只检查环境变量 `JIXIE_MAINTENANCE_LOCK_HELD=1` | 不是检测真实锁，变量由可信包装器传递；手工设置或错误继承会绕过实际互斥 |
| [独立 sync CLI](/Users/liucong/Projects/jixie/apps/api/scripts/sync/index.ts:6)／[示例](/Users/liucong/Projects/jixie/apps/api/src/market/cli/sync-stock-prices.ts:15) | 当前分派及该写入链没有维护 flock 包装／断言 | 可与标准维护并发写同一市场表；不能称所有市场写入口已受统一锁保护 |
| [signals:run CLI](/Users/liucong/Projects/jixie/apps/api/src/signals/cli/run-signals.ts:4) | runDailySignalCycle 会先同步市场再算信号，没有维护锁断言 | 同样存在市场写入旁路；仅把它视为只读信号计算会漏掉竞态 |
| [API 维护门禁](/Users/liucong/Projects/jixie/apps/api/src/maintenance/middleware.ts:6)／[任务排空](/Users/liucong/Projects/jixie/apps/api/src/maintenance/runs/coordination.ts:9) | 前者阻止新 app 请求；后者等 Job、AgentTurn、气象 running 安静窗口 | 都不是持有互斥锁；未登记的 Research／在途请求、已越过门禁但未登记的工作仍需核对 |

SQLite 写锁和唯一键提供数据库层面的写入串行及约束，但不会阻止“两个进程先读旧值，各自排队覆盖”的业务丢失更新，也不保证一轮多个局部事务整体原子。

## 4 改造时必须覆盖的竞态

以下为基于现状的设计建议，尚未实现。

| 场景 | 当前保证或风险 | 建议边界 |
| --- | --- | --- |
| daily、weekly、repair 同时启动 | 标准生产入口共用 flock，正常不会并行 | 暂存方案仍从准备到发布全程持有维护互斥锁；第一阶段不阻塞用户，不等于允许多轮维护同时准备 |
| 手工 sync、signals:run、导入与维护重叠 | 并非所有入口都遵循锁 | 正式市场写入口统一纳管；缺少实际持锁保障的生产直写拒绝执行，不仅依赖环境变量 |
| A 候选失败后释放锁，B 发布成功，A 再恢复 | A 的正式基线已过期 | A 重获锁后检查 baseDataRevision／schema；不能只凭断点继续回填，重建基线并重算依赖 |
| 重试与重复发布 | 业务键唯一不能证明上一轮是否已整体提交 | 正式事务保存唯一发布身份、哈希及修订号；结果不明先查凭据，禁止重复提交和递增修订 |
| 发布前新增部署或更改数据依赖 | 用户第一阶段仍正常操作，候选可能没覆盖新 ETF／期货／利率需求 | 发布窗口内排空相关写操作并复核需求指纹，或以同事务可验证的配置修订约束；复核后到提交前也不能留竞态窗口 |
| 第一阶段复制多张表 | 分别读取可能得到不同时间点；全程 flock 只防遵循协议的市场写者 | 同一正式读快照复制；冻结需求输入，所有旁路写者纳管。只看水位不够 |
| ETF／财报等先查后插 | ETF 补缺事务内重查；财报指纹先查再分批插仍依赖串行写者 | 回填接外层事务，事务内按冻结基线复核，唯一键冲突应解释而非统一吞掉 |
| 当前 writer 自行开事务 | 在外层事务里调用仍用全局 prisma 的函数，会另开连接／事务；可能锁等待或部分先提交 | 业务 writer 接受外层 TransactionClient；内部不再开启另一份正式事务 |
| 发布与长任务、多个读查询重叠 | 单次查询原子，不代表多个查询同版本 | 第二阶段阻止新相关操作并完整排空已有工作；数据缓存按修订失效，保留可追溯旧报告 |
| 父进程退出、子进程仍活跃 | IPC ACK 有财报单项完成保障，但不同执行进程／锁 FD 继承仍需验证 | 子进程只能写本轮暂存库，候选冻结前等其退出；不能遗留发布连接或发布门禁持有者 |
| 断点落库与候选数据落盘之间退出 | 是跨库操作，不可能靠一个本地事务同时原子提交 | 先保存候选实物后标完成，恢复校验范围／哈希；标记缺失可幂等重做，实物缺失不能跳过 |
| 发布与因子气象／账户后续处理重叠 | 气象只有进程内去重；新版账户已有 revision＋generation CAS | 气象补足跨进程认领／输入版本检查；账户保留自身 CAS。后续任务与后续市场发布之间也要协调 |
| 候选冻结与清理重叠 | 单纯“目录存在”无法判断仍有写者 | 只清理无活动持有者且发布／恢复状态明确的本轮文件；冻结哈希在发布前验证 |

单机部署采用现有统一维护锁串行即可，不需要为了暂存库引入多维护任务并行或分布式锁。维护锁与发布门禁分离：前者防维护互相覆盖，后者只在第二阶段短期限制用户访问。现有生产配置路径和源码覆盖不等于已核实线上锁的实际状态。

## 5 后续设计应优先确定的内容

1. 先为上述每个业务定义接收规范化候选和外层事务的发布操作，复用已有规则，不建设猜测所有 model 的通用合并器。
2. 专门评审整表来源、分红 ID、财报证据更新、不可变期货快照、代码归一及删除范围；这些不能靠统一 upsert 处理。
3. 把所有正式市场写入口纳入同一互斥协议，再谈基线快照与回填一致性；数据库事务不能替代入口锁。
4. 保持已确认的设计：按需复制市场数据，第一阶段无论历史检查／下载／修复／审计结果均不自动封站；全部 ready 后才进入发布门禁。

复用分类是静态评估，不是已通过测试的可替换承诺。后续产品实现仍需遵循 review-gated-development 的范围批准、静态检查、人工代码审阅与行为验证。本次未执行同步、维护、数据库迁移或并发测试。
