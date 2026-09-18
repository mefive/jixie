# API 命令入口与业务模块组织计划

> 状态：已完成；计划与产品代码 review 均已批准，静态检查、行为验证和干净构建通过，结果随本次提交归档。
> 日期：2026-09-15；核对代码基线：`24f20ce6`（已根据最新 ETF 恢复提交修订）。
> 本次交付：按批准范围完成全部结构调整、测试、部署入口及文档联动；验证只使用本地数据源替身和临时数据库，不涉及生产部署。
> Commit message：`refactor(api)!: organize CLIs and application maintenance`
> 提交 footer：`BREAKING CHANGE: rename sync to sync:stock-prices in the root and API packages.`
> 用户已批准 review 后验证通过即提交；本记录与实现同批提交，不 push。

## 2026-09-18 命名简化补充

原计划及下方验收记录保留历史名称；当前模块使用 `apps/api/src/maintenance/` 和 `#maintenance/*`。
`maintenance` 已能表达整轮维护协调，无需 `application` 前缀。职责划分、业务行为、命令、HTTP URL、数据库模型和进程协议保持。

- 提交信息：`refactor(api): rename application-maintenance to maintenance`。
- 范围已批准：模块整体改名，同步包内别名、调用方、systemd 入口、边界检查及测试、当前架构与使用文档。
- 静态检查：`pnpm typecheck` 通过（含静态边界扫描，0 违规，生成契约一致及全部 workspace 类型检查）；受影响代码 ESLint、Prettier 与 `git diff --check` 通过。36 个模块文件整体迁移，除 README 外内容逐字节一致。
- 人工代码审查：用户已确认；约定的行为验证全部通过，随本次提交归档。
- 行为验证：18 个 API 测试文件、99 项测试通过（完整 Maintenance 模块、包内别名、CLI 入口、业务错误）；28 项边界检查器自测通过，项目扫描 0 违规。
- 构建：shared 与 API 构建通过；生产条件下主进程及真实 Worker 均成功加载 `#maintenance/daily-schedule.js`，编译后的两个 CLI 与参考数据 Worker 入口存在。
- 验证使用临时 SQLite 和本地数据源替身；临时目录已清理，子进程和 Worker 均已退出，未启动持久服务，未部署或推送。
- 验证范围：类型检查、静态依赖扫描、lint/格式与 diff 检查；审查后运行维护模块、别名、CLI、业务错误及边界检查器测试，构建 API 并验证编译后的别名加载。

> 后续业务归属调整：财报 CLI、历史导入和 Worker 已按 [Maintenance 业务边界整理](maintenance-business-boundaries.md) 迁入 Market；下文保留原迁移的历史记录。

## 1. 目标、依据与取舍

目标是让维护者从业务模块同时找到可调用能力和命令入口，明确数据写入、维护发布、进程启动各自的责任。

遵循 [CLAUDE.md](../../CLAUDE.md)、[提交约定](../../CONTRIBUTING.md) 和用户显式指定的
[review-gated-development](../../../../.codex/skills/review-gated-development/SKILL.md) 工作流。
沿用 [后端架构地图](../backend-architecture.md)、[依赖边界](../backend-boundaries.md) 和
[生产维护设计](production-maintenance.md) 中已经落地的职责；这不是重新启动已完成的后端整体重构。

采用以下组织：

1. Market、Application Maintenance、Signals、Auth 的应用命令放入所属模块的 `cli/`；原 `src/maintenance/` 改名为 `src/application-maintenance/`。
2. Market 负责市场数据获取、转换、校验、替换事务和数据切片 checkpoint；Application Maintenance 负责整轮更新的执行顺序、应用可用性、质量发布门禁、运行状态和恢复。股票代码修复及其 CLI、财报分期规则归回 Market。
3. CLI 负责参数、命令选择、输出、退出码及进程资源收尾；允许简单的同步组合和仅为输出服务的数据库查询。
4. 将脚本内两处较重流程收回 Application Maintenance：基线修复、财务参考数据历史导入。财报 Worker 与整体审计的混合职责见 §1.6，本次不全面拆解。ETF 历史恢复已由最新提交纳入 weekly，其实现随模块改名迁移，行为保持。
5. 将独立 `backup-db.mjs` 移至 `apps/api/scripts/` 根目录，保留完整工具和零 npm 依赖运行方式；只调整路径定位及调用配置。

本次不采用集中 `apps/api/cli/`：它能改善命名，但仍需要在入口树和实现树之间往返。
模块内 CLI 与现有模块内 HTTP、Worker 入口一致；pnpm 命令和命令索引继续提供统一发现入口。
本次也不引入独立 CLI package、通用命令框架、DI 容器或每个命令一层 service。

### 1.1 已核实的当前事实

- `apps/api/scripts/sync/` 有 24 个 TS 入口；其中 `sync-fina.ts` 使用 Maintenance 参考数据 Worker，其余 23 个可以归入 Market。
- `apps/api/scripts/maintenance/` 有 4 个 TS 入口和 1 个独立 MJS 备份工具；独立 ETF 历史恢复入口已删除。
- Market 同步被 Maintenance daily/weekly/self-heal 和 Signals sync 直接调用；部分同步函数目前只有 CLI 调用方，仍拥有稳定的数据写入语义。
- API server 使用维护状态路由和请求门禁；没有第二套 API 内 daily/weekly 调度器。外部 systemd 仍是生产定时触发源。
- `run-maintenance.ts` 的 `baseline` 分支只修复基线附近的数据；真正初始化发布水位的是 `src/maintenance/daily.ts` 的 `initializePublishedBaseline`。
- ETF 历史查缺由 weekly 的 `recoverEtfRegistry` 承担：从约定起点到发布水位按代码/日期检查日线、复权、份额，按年份读取、按缺失数据集补齐；最近 252 日的修订窗口独立保留。
- `market/quality/etf-history-coverage.ts` 的 `inspectEtfHistoryCoverage` 被恢复与审计共用；`market/sync/etf.ts` 的 `fillEtfHistoryGap` 只插入仍缺的键，不覆盖已有观测。weekly 不再调用年度切片同步来证明历史覆盖。
- `sync:fina` 全量分支跳过已有分红证券，并给 Worker 传入空维护运行 ID；weekly 则使用运行 checkpoint 重新协调参考数据。
- API tsconfig 已同时编译 `src`、`scripts`、`tests`；目录移动不创建新的构建单元。
- 生产 daily/weekly 调用编译后的 CLI；bootstrap 已删除独立 ETF 恢复调用，其余既有数据检查和 pnpm 调用保留；backup 服务直接用 Node 执行原 MJS 文件。

### 1.2 本次范围与交付界面

一个完整提交包含：28 个 TS CLI 迁移、1 个独立 MJS 备份工具移至脚本根目录、Maintenance 模块改名、两份既有 Market 职责迁出、两份新增流程实现、相应测试、包内别名/边界检查、pnpm/systemd 路径和当前使用文档更新。
最终 CLI 分配为 Market 24 个、Application Maintenance 2 个、Signals 1 个、Auth 1 个；业务文件与模块测试的迁移另计，不混入 28 个 CLI 数量。
ETF 恢复实现及其新增质量能力作为当前基线保留；bootstrap 只核对已有调用并更新备份依赖说明中的路径，不改变部署执行流程。

直接使用者是管理员、开发者、systemd 和部署/导入脚本。将范围含糊的 `sync` 改名为 `sync:stock-prices`，其余 pnpm 命令名保留；所有参数与数据处理契约保留，不新增 HTTP API、页面或 SDK 方法。
业务函数是 API 包内接口，供 CLI 和必要的模块调用，不作为新的公共包出口。

暂不迁移 `scripts/audit/`、`scripts/probes/`、`scripts/research/`；其中 `scripts/audit/audit-data.ts` 仅更新对改名模块的 import。
根级工程/部署脚本继续保留。`server.ts` 只更新维护路由/门禁的 import；其他业务模块只处理受本次迁移影响的引用，数据库 schema 不在重构范围内。

### 1.3 根据最新提交调整的计划

`24f20ce6 fix(maintenance): reconcile ETF history before weekly audit` 已替代初稿依据的 ETF 恢复方式。

| 初稿内容 | 本次修订 |
| --- | --- |
| 迁移独立 `recover-etf-history.ts`，新增已发布 ETF 历史恢复函数 | 取消；入口及 bootstrap 调用已删除，不恢复第二条执行链 |
| 29 个 TS CLI、Maintenance 下 4 个 CLI | ETF 入口删除后为 28 个 TS CLI、原拟 Maintenance 下 3 个 CLI；§1.6 又将股票代码 CLI 归回 Market，最终协调模块下 2 个；全部 28 个都有既有 pnpm 命令 |
| 提取三处流程、扩展 `etf-recovery.ts` | 仅提取基线修复和财报历史导入；ETF 恢复模块保持现状 |
| weekly 依赖证券/年度完成标记判断历史覆盖 | 改为描述每次全历史查缺、事务内仅补缺失键；修订日期和本轮源缺失观察分别记录 |
| 修改 bootstrap 入口及验证独立 ETF 恢复 CLI | 取消路径修改及独立入口验证；保留新 ETF 恢复/覆盖/补缺测试作为相关回归 |

此次 ETF 修订保持总体调用方向；后续股票命令命名调整见 §1.5，应用维护职责及目录调整见 §1.6，最终 commit message 以本文顶部为准。审批及实现状态见 §10。
该次复核只修订计划，不把最新提交已实现的 ETF 行为列为本次待开发功能，也不复用其历史验证结果代替本次验证。

### 1.4 备份工具的位置调整

根据用户对仅剩单文件目录的反馈，备份工具直接放到 `apps/api/scripts/backup-db.mjs`。
其独立性由 Node 内置模块、sqlite3 CLI 和无需应用构建的运行契约保证，不需要保留单独的 `scripts/maintenance/` 目录。
该组 4 个 TS 入口移入各自模块、备份移出后，API 的 `scripts/maintenance/` 不再保留；仓库根级同名目录仍负责锁和导入编排。

默认数据库实际位置仍是 `apps/api/prisma/dev.db`，所以脚本内相对定位从上溯两级改为一级。
同步更新 `backup` 命令、生产 backup service、用法说明与当前文档；launchd 已调用 pnpm 命令，其 plist 无需改路径。
迁移总量为 28 个 TS + 1 个 MJS，API 内现有 29 个相关 pnpm 命令均调整文件路径，其中股票价格同步另按 §1.5 改名。

### 1.5 股票价格同步的命名

原 `apps/api/scripts/sync/sync.ts` 只组合股票名录、交易日历、股票日行情和复权同步。
`sync` 容易被理解为全量市场同步，因此采用以下明确命名：

- 目标文件：`apps/api/src/market/cli/sync-stock-prices.ts`。
- API 命令：`pnpm --filter api sync:stock-prices [start] [end]`。
- 根级快捷命令：`pnpm sync:stock-prices [start] [end]`。

价格同步包括日行情和复权；名录、日历是它所需的前置数据。`sync:stock-history` 仍负责股票名录和历史名称，两个命令的主任务可以区分。
本次同步更新两个 package.json、批量导入脚本、命令用法和当前文档，移除原 `sync` 命令，不留下含糊的兼容别名。
现有参数顺序、默认日期和执行步骤保持；导入脚本的 `stock-bars-<year>` 完成标记保持，改名不导致已完成阶段重跑。

这是本次唯一计划中的命令改名。由于根级和 API 的旧命令接口移除，拟议提交信息增加 `!` 和顶部所列的 `BREAKING CHANGE` footer；该变更与整体计划一起在 Gate 1 审批。

### 1.6 应用维护模块的职责收窄与改名

CLI 是调用方式。生成邀请码、同步行情、运行信号分别属于各自业务，不因管理员通过命令行执行而统一归入 Maintenance。
原 Maintenance 的独立职责是整轮更新的协调：等待在途任务结束，组织数据修复/同步/重算，通过质量门禁后发布可用截止日与 dataRevision，再触发下游信号，并记录进度、恢复中断。
HTTP 门禁读取同一运行状态；部署入口还以 `kind=deploy` 写入 MaintenanceRun。因此这个模块同时协调应用可用性，不能完全归入行情同步。

采用 `application-maintenance` 表达全应用维护协调。仍是 API 包内模块，不新建服务、workspace 或调度器。
整体搬入 Market 会把 Signals 调用及 Strategy 模型就绪要求一起带入，而 Signals 本身依赖 Market；保留独立协调位置有实际调用关系依据。

| 当前职责 | 本次决定 | 边界依据 |
| --- | --- | --- |
| daily/weekly/repair、运行状态、恢复、发布与 HTTP 门禁 | 随模块迁入 `src/application-maintenance/` | 决定更新顺序、何时发布以及应用何时恢复可用 |
| `canonicalize-stock-codes.ts` 及其 CLI | 实现迁至 `market/instruments/`，CLI 迁至 `market/cli/` | 合并证券代码对应的市场数据，不管理维护运行或发布；weekly 调用其结果决定后续重算 |
| `reference-periods.ts` 及同名测试 | 迁至 `market/fundamentals/` | 财报历史起点和季度分期是领域规则，供 weekly 和历史导入复用 |
| 已在 Market 的数据同步与具体质量检查 | 保持各自领域归属 | 数据来源、口径、有效性和写入由数据所属模块负责 |
| `reference-worker.ts` / `reference-worker-process.ts` | 随协调模块改名迁移，本次保留协议和内部职责 | Worker 同时执行财报任务并写全局运行 checkpoint，不能原样搬入 Market 引入反向依赖 |
| `data-audit.ts`、`quality.ts`、`self-heal.ts` | 本次随协调模块迁移，记录现有混合职责 | 包含具体数据检查/修复和发布策略；全面拆分超出本次 CLI 与模块归属调整 |
| `risk-data-audit.ts` 与整轮审计汇总 | 留在应用维护协调模块 | 组合 Market 数据质量与 Strategy 的模型要求 |

对混合职责的长期边界是：具体数据规则归 Market；审计结果汇总、发布阻断决策及跨模块就绪条件归 Application Maintenance。
这不是要求本次抽取所有检查或新增通用流程框架，也不代表当前文件整体永久属于协调模块。
`sync:fina` 的全量入口及新增历史导入操作本次随 Worker 留在 Application Maintenance，是保留既有进程/checkpoint 协议的范围选择；目标结构中财报分期规则归回 Market，不能再以该辅助函数的当前位置证明 CLI 归属。

目录改名同步更新包内别名为 `#application-maintenance/*`、server/audit 调用、Worker 源码/编译路径与边界检查器的精确路径规则。
`maintenance` 命令、systemd unit 名、环境变量、锁文件、HTTP URL、已有具名函数/类型及数据库模型名保持；不把物理目录改名扩展成持久化或外部接口改名。
拟议提交标题调整为本文顶部版本，原 `sync` 命令改名的 breaking-change footer 保留。

## 2. 迁移后的目录结构

以下路径以仓库根目录为基准。列出本次全部目标 CLI，以及相关业务实现；原 Maintenance 的剩余实现、README 和模块测试整体迁入 Application Maintenance，两个迁回 Market 的文件另行列出。
其他未列出的业务文件和测试保留原位置。
文件名通常保持原样；`sync.ts` 显式改为 `sync-stock-prices.ts`，不同时重命名其他命令。

```text
package.json                           根级股票价格同步快捷命令改名
apps/api/
  package.json                         pnpm 命令及原生包内别名
  tsconfig.json                        既有编译范围保留
  src/
    server.ts                          更新应用维护路由/门禁的别名导入
    market/
      cli/
        canonicalize-stock-codes.ts
        sync-stock-prices.ts
        sync-basic.ts
        sync-stock-history.ts
        sync-limit.ts
        sync-moneyflow.ts
        sync-toplist.ts
        sync-sw-industry.ts
        sync-etf.ts
        sync-index.ts
        sync-index-daily.ts
        sync-index-basic.ts
        sync-market-reference.ts
        sync-market-state.ts
        sync-futures.ts
        sync-commodity-futures.ts
        sync-commodity-continuous-returns.ts
        sync-commodity-holdings.ts
        sync-commodity-warehouse-receipts.ts
        sync-rates.ts
        sync-credit-curves.ts
        sync-external-market.ts
        sync-cross-market-benchmarks.ts
        sync-macro.ts
      sync/
        stocks.ts
        calendar.ts
        stock-daily.ts
        stock-flows.ts
        etf-history.ts
        etf.ts
        indices.ts
        futures.ts
        market-indicators.ts
        cross-market-benchmarks.ts
      quality/
        etf-history-coverage.ts         保留：按生命周期检查三表预期键
        etf-history-coverage.test.ts    保留：内部缺口与生命周期回归
        etf-registry-audit.ts           保留：复用覆盖检查进行 registry 审计
      instruments/
        canonicalize-stock-codes.ts    从 maintenance/ 迁入：历史代码冲突检查与合并
      fundamentals/                    原有财报同步、口径、查询及审计保持
        reference-periods.ts           从 maintenance/ 迁入：历史起点与季度分期
        reference-periods.test.ts      随领域规则迁移
      rates/                           利率和外部市场数据保持原组织
      macro/                           宏观同步和历史可得性保持原组织
      commodity/                       商品数据同步、计算和质量保持原组织
      providers/                       数据源客户端及配置保持原组织
      registry/                        静态清单保持原组织
      README.md
    application-maintenance/           原 maintenance/ 改名，承载全应用维护协调
      cli/
        run-maintenance.ts
        sync-fina.ts
      baseline-repair.ts               新增：导入基线附近修复
      baseline-repair.test.ts          新增：修复范围、失败和不发布水位
      financial-history-import.ts     新增：财务参考数据历史导入
      financial-history-import.test.ts 新增：选择范围、分批和失败传播
      etf-recovery.ts                  保留：weekly 全历史查缺和近期修订
      etf-recovery.test.ts             保留：全历史复查与重试回归
      daily.ts
      weekly.ts
      repair.ts
      self-heal.ts
      state.ts
      quality.ts
      data-audit.ts
      risk-data-audit.ts
      reference-worker-process.ts
      reference-worker.ts
      daily-schedule.ts
      middleware.ts
      routes.ts
      daily-schedule.test.ts
      data-audit.test.ts
      data-audit.integration.test.ts
      macro-risk-audit.test.ts
      market-risk-audit.test.ts
      reference-worker-process.test.ts
      routes.test.ts
      self-heal.test.ts
      self-heal-recovery.test.ts
      state.test.ts
      weekly.test.ts
      README.md
    signals/
      cli/run-signals.ts
      scheduler.ts
      sync.ts
      README.md
    auth/
      cli/gen-invite.ts
      invite-code.ts
      README.md
  scripts/
    README.md                          保留为 API 命令与独立脚本的统一索引
    backup-db.mjs                      从 maintenance/ 移出，保持独立运行
    audit/                             不迁移；audit-data.ts 更新模块别名
    probes/                            本次不迁移
    research/                          本次不迁移
  tests/
    cli-entrypoints.test.ts            新增：包级命令与部署入口契约
    import-aliases.test.ts              增补应用维护别名的源码/生产验证

deploy/
  jixie-maintenance.service            更新编译入口
  jixie-maintenance-weekly.service     更新编译入口
  jixie-maintenance.timer              保留
  jixie-maintenance-weekly.timer       保留
  jixie-backup.service                 更新脚本路径，继续直接用 Node 执行
  jixie-backup.timer                   保留
  com.jixie.backup.plist               保留
  component-impact.json              现有前缀继续适用
scripts/
  bootstrap.sh                        更新备份依赖说明路径；既有 pnpm 调用保留
  maintenance/with-maintenance-lock.sh 保留互斥和环境设置
  maintenance/import-market-data.sh   改用 sync:stock-prices，保留导入 checkpoint
  deploy/plan-deployment.test.mjs      既有部署影响验证
  checks/check-backend-boundaries.mjs 更新模块改名后的 HTTP 和 Market 方向规则
  checks/check-backend-boundaries.test.mjs 更新 fixture，覆盖新路径的直接/间接依赖
  README.md                           更新应用命令组织说明
docs/
  design/api-cli-organization.md       本计划及后续开发记录
  backend-architecture.md              更新模块内 CLI 阅读入口
  backend-boundaries.md                更新应用维护模块名及对应边界
  backend-runtime-entries.md           更新源码/编译路径
  design/production-maintenance.md     更新实际维护启动路径
```

迁移完成后 `apps/api/scripts/sync/` 和 `apps/api/scripts/maintenance/` 不再有文件，不保留兼容转发入口。
原 `apps/api/src/maintenance/` 也不保留副本或转导出；旧 `#maintenance/*` 别名移除，内部消费者全部使用新路径。
独立备份工具位于 API 的 `scripts/` 根目录；仓库根级 `scripts/maintenance/` 继续保留维护锁和批量导入编排。

## 3. 每个命令文件的迁移与职责

### 3.1 Market：24 个入口

其中 23 个源文件位于 `apps/api/scripts/sync/`，`canonicalize-stock-codes.ts` 源于 `apps/api/scripts/maintenance/`；目标目录统一为 `apps/api/src/market/cli/`。
除 `sync.ts` 改名为 `sync-stock-prices.ts` 外，其余文件同名迁移。所有入口共同负责原有参数/默认值、配置、输出、失败退出和 Prisma 收尾；下表描述各自的调用内容。
业务实现列以 `apps/api/src/market/` 为基准。

| 目标文件 | pnpm 命令 | 入口具体职责 | 主要业务实现 |
| --- | --- | --- | --- |
| `canonicalize-stock-codes.ts` | `canonicalize:stock-codes` | 调用证券代码合并操作，保持现有错误、输出和收尾行为；不自行管理发布水位 | `instruments/canonicalize-stock-codes.ts` |
| `sync-stock-prices.ts`（原 `sync.ts`） | `sync:stock-prices`（原 `sync`） | 同步股票日行情和复权，先刷新所需股票名录与交易日历；打印数量 | `sync/stocks.ts`、`sync/calendar.ts`、`sync/stock-daily.ts` |
| `sync-basic.ts` | `sync:basic` | 同步股票每日估值指标；打印数量 | `sync/stock-daily.ts` |
| `sync-stock-history.ts` | `sync:stock-history` | 登记代码变更、刷新完整股票名录与历史名称 | `sync/stocks.ts` |
| `sync-limit.ts` | `sync:limit` | 同步每日涨跌停价格 | `sync/stock-daily.ts` |
| `sync-moneyflow.ts` | `sync:moneyflow` | 同步个股资金流并输出覆盖 | `sync/stock-flows.ts` |
| `sync-toplist.ts` | `sync:toplist` | 同步龙虎榜 | `sync/stock-flows.ts` |
| `sync-sw-industry.ts` | `sync:sw-industry` | 调用申万历史成员同步，保留客户端最小间隔 | `sync/indices.ts` |
| `sync-etf.ts` | `sync:etf` | 解析 registry/major/代码选择器与 refresh；组合日历、ETF 元数据、行情/复权和份额 | `sync/calendar.ts`、`sync/etf-history.ts`、`sync/etf.ts` |
| `sync-index.ts` | `sync:index` | 解析 market-state/代码选择器；同步权重和行情，输出覆盖 | `sync/indices.ts` |
| `sync-index-daily.ts` | `sync:index-daily` | 选择指数并逐个补行情 | `sync/indices.ts` |
| `sync-index-basic.ts` | `sync:index-basic` | 选择指数并补估值指标 | `sync/indices.ts` |
| `sync-market-reference.ts` | `sync:market-reference` | 组合指数目录、看板指数行情和申万行业行情同步 | `sync/indices.ts` |
| `sync-market-state.ts` | `sync:market-state` | 触发本地市场/指数/行业指标计算，输出数量 | `sync/market-indicators.ts` |
| `sync-futures.ts` | `sync:futures` | 组合股指期货合约、CFFEX 日历、行情、主力映射和结算参数 | `sync/futures.ts`、`sync/calendar.ts` |
| `sync-commodity-futures.ts` | `sync:commodity-futures` | 同步商品实际合约和行情，按品种输出覆盖 | `sync/futures.ts`、`commodity/commodity-futures.ts` |
| `sync-commodity-continuous-returns.ts` | `sync:commodity-continuous` | 准备上下文日历、同步连续收益、执行审计并映射失败退出 | `commodity/commodity-continuous-returns.ts`、`commodity/commodity-continuous-return-quality.ts` |
| `sync-commodity-holdings.ts` | `sync:commodity-holdings` | 准备日历，同步会员持仓排名汇总 | `commodity/commodity-holding-positions.ts` |
| `sync-commodity-warehouse-receipts.ts` | `sync:commodity-warehouse-receipts` | 同步仓单，按品种查询数量供输出 | `commodity/commodity-warehouse-receipts.ts` |
| `sync-rates.ts` | `sync:rates` | 准备日历，调用财政部国债曲线同步 | `rates/china-treasury-curve.ts` |
| `sync-credit-curves.ts` | `sync:credit-curves` | 准备日历，调用中债信用曲线同步 | `rates/chinabond-credit-curves.ts` |
| `sync-external-market.ts` | `sync:external-market` | 准备日历，同步美国利率与外汇驱动 | `rates/external-market-drivers.ts` |
| `sync-cross-market-benchmarks.ts` | `sync:cross-market-benchmarks` | 准备日历，同步跨市场基准并输出清单覆盖 | `sync/cross-market-benchmarks.ts` |
| `sync-macro.ts` | `sync:macro` | 解析月份范围，准备可得性计算用日历，组合中国宏观与美国 CPI 同步 | `macro/china-macro.ts`、`macro/us-headline-cpi.ts` |

这些轻量组合继续留在各 CLI，不为每行再新增一个“命令 service”。日历预备范围、选择器、刷新参数和当前校验行为保留。

### 3.2 Application Maintenance、Signals、Auth 与独立备份

以下源、目标路径以 `apps/api/` 为基准。

| 源文件 | 目标文件 | 命令/调用方 | 迁移后的职责 |
| --- | --- | --- | --- |
| `scripts/maintenance/run-maintenance.ts` | `src/application-maintenance/cli/run-maintenance.ts` | `maintenance`、daily/weekly systemd | 解析 daily/weekly/repair/baseline；对现有需恢复的分支检查锁并调用中断恢复；调用相应操作；打印摘要与收尾 |
| `scripts/sync/sync-fina.ts` | `src/application-maintenance/cli/sync-fina.ts` | `sync:fina`、批量导入、手动修复 | 解析参数、配置和批大小；全量分支调用历史导入操作；单股分支直接调用 Market 已有按股同步；展示摘要/数量并收尾 |
| `scripts/maintenance/run-signals.ts` | `src/signals/cli/run-signals.ts` | `signals:run` | 解析日期，调用 `runDailySignalCycle`；按错误数设退出码 |
| `scripts/maintenance/gen-invite.ts` | `src/auth/cli/gen-invite.ts` | `gen:invite` | 保留数量/备注校验、调用码生成函数、批量写库和逐行输出；小型管理员操作完整保留在入口文件 |
| `scripts/maintenance/backup-db.mjs` | `scripts/backup-db.mjs` | `backup`、systemd、launchd | 保留 Node 内置模块 + sqlite3 CLI 的备份、可读性验证与轮换；调整默认数据库相对定位，仍无需应用构建或 npm 包 |

Application Maintenance 下共 2 个 CLI。`sync:fina` 的当前归属按 §1.6 保留与全局 checkpoint 关联的 Worker 链，不把它视为所有财报导入的永久归属。
Market CLI 不能反向依赖 Application Maintenance；不通过修改边界白名单放行这种反向依赖。

## 4. 应用实现：逐文件职责与拟议接口

### 4.1 本次新增的业务文件

路径以 `apps/api/src/application-maintenance/` 为基准。下列都是内部具名函数，不读取 `process.argv`、设置退出码或断开调用者共享的 Prisma。

| 文件 | 拟议可调用接口 | 职责与消费者 |
| --- | --- | --- |
| `baseline-repair.ts`（新增） | `repairBaseline(targetDate?: string): Promise<SelfHealSummary>` | 从原 CLI 提取截止日裁剪、lookback 配置、自愈、必要的派生重算及验证；由 maintenance CLI 的 baseline 分支调用 |
| `financial-history-import.ts`（新增） | `importFinancialReferenceHistory(options): Promise<FinancialReferenceImportSummary>` | 根据现有行情选择财报历史，选择尚无分红的证券，按阶段分批执行参考数据 Worker；由 sync:fina 全量分支调用 |

`FinancialReferenceImportOptions` 至少包含 `throughDate`、`financialPeriodsPerProcess`、`dividendCodesPerProcess` 与可选 `onLog`。
`FinancialReferenceImportSummary` 包含 `financialStatements`、`financials`、`dividends` 三个既有 `ReferenceSyncSummary`。
CLI 继续按原环境变量和默认值提供选项，原有源码中仅用于命令展示的最终行数查询留在 CLI。
基线修复操作按既有流程在需要时创建客户端；不为统一配置注入而改造现有 daily/weekly。

#### 必须保持的操作差异

- **基线修复**：没有目标日时取最近已收盘交易日；未来目标裁剪至最近收盘；自愈仍有 deferred 则失败；只在存在派生影响时重算并验证。不得初始化/推进水位、增加 dataRevision、创建新的维护运行或自动恢复其他运行。
- **基线发布**：仍留在 daily 的 `initializePublishedBaseline`，继续管理维护运行、在途任务等待、质量验证及 `initializeDailyWatermark`。本次不合并这两个基线流程。
- **ETF weekly 历史补缺**：保持 `24f20ce6` 的现有调用：weekly 在已有日发布水位时调用 `recoverEtfRegistry`。每次重试都从 2015 年起按上市/退市生命周期检查至水位，分别比对三张 ETF 表；只请求有缺口的数据集，在事务中复查并只插入仍缺的键。历史覆盖不能由年度或修订完成标记替代。
- **ETF 源缺失与近期修订**：保留 `etf-recovery-v2` 命名空间及其元数据/水位哈希，`no-daily` / `no-share` 只记录本轮源缺失观察，新 weekly 再查；`revision` 日期 checkpoint 只控制近期修订。补缺所需复权缺失、广泛日线缺失仍阻塞；审计保留首尾覆盖错误与内部缺口检查，不伪造观测或推断停牌。以上均为当前行为，本次不重写。
- **ETF 手动范围同步**：现有 `sync:etf` 仍使用 `etf-history.ts` 的证券/年度切片和范围份额同步；它与 weekly 全历史查缺职责不同，本次只迁移该 CLI，不改造成 weekly 流程，也不重新引入独立恢复入口。
- **财报全量导入**：先原始财报、再财务指标、再尚无分红记录的证券；传给 Worker 的运行 ID 仍是 `null`。财报批大小继续使用当前 `MAINTENANCE_WEEKLY_FINANCIAL_PERIODS_PER_PROCESS`，不顺便改成 weekly 的另一个环境变量。
- **weekly 参考数据协调**：保留现有运行 checkpoint、完整分红协调和 WAL checkpoint。与首次历史导入共用已有 Worker/分期辅助，不改造成一个带大量模式开关的统一流程。
- **财报单股修复**：保留代码校验、必填开始日期、默认结束日、限流及 `syncFinancialStatementsByStock` 调用；不为了分目录新增一层纯转发函数。

### 4.2 随改名迁入 Application Maintenance 的既有文件

以下路径以 `apps/api/src/application-maintenance/` 为基准，文件从原 Maintenance 同名迁入，测试随模块迁移。
业务行为保持；`weekly.ts` 改为跨模块调用 Market 的证券代码合并与财报分期规则。混合职责本次的处理边界见 §1.6。

| 文件 | 职责 |
| --- | --- |
| `daily.ts` | 日历/截止日、日维护、自愈、原始和派生质量、发布水位、后续信号；保留首次基线发布与生产锁前提检查 |
| `weekly.ts` | 慢频参考数据、ETF 全历史补缺及近期修订、自愈、整体审计、派生失效及恢复；保留 weekly 自己的 checkpoint |
| `etf-recovery.ts` | `recoverEtfRegistry`：按生命周期和发布水位分年检查三表、逐日补缺、记录本轮源缺失观察，再执行有日期 checkpoint 的近期修订；由 weekly 调用，不新增 CLI 或已发布恢复包装函数 |
| `repair.ts` | 显式日期区间修复，调用 daily，完成仓单维护和最终审计 |
| `self-heal.ts` | 查缺口、制定允许的修复项、调用 Market 并重查质量 |
| `state.ts` | 维护运行/项目、心跳、中断恢复、发布水位、dataRevision 与状态查询 |
| `quality.ts` | 发布前的原始数据和派生数据质量验证 |
| `data-audit.ts` | 整体覆盖和质量审计；同时含具体领域检查的现状本次保留，不把整个文件描述成薄汇总层 |
| `risk-data-audit.ts` | 组合市场质量与策略风险模型的历史要求 |
| `reference-worker-process.ts` | 参考数据子进程 fork、批次辅助、IPC 摘要和退出结果检查；继续按源码/编译选择 Worker |
| `reference-worker.ts` | 子进程参数与 IPC、Market 财报/指标/分红调用、可选运行项 checkpoint、子进程 Prisma 收尾 |
| `daily-schedule.ts` | 定时日维护是否因休市且无缺口而跳过的判断 |
| `middleware.ts` | HTTP 维护门禁，读取状态并返回 Retry-After |
| `routes.ts` | 维护状态 HTTP 路由 |

### 4.3 迁回 Market 的既有实现

以下路径以 `apps/api/src/market/` 为基准。迁移保留原文件名、导出接口和行为，原位置不保留转发层。

| 目标文件 | 可调用接口 | 职责与消费者 |
| --- | --- | --- |
| `instruments/canonicalize-stock-codes.ts` | `canonicalizeStockCodes(): Promise<StockCodeCanonicalizationSummary>` | 按既有代码变更清单事务合并市场数据，检查冲突，返回迁移数和最早影响日；供 Market CLI 与应用维护 weekly 调用 |
| `fundamentals/reference-periods.ts` | `financialHistoryStart(earliestMarketDate: string): string`、`quarterlyReportPeriods(startDate: string, endDate: string): string[]` | 计算财报导入历史起点和季度报告期；供 weekly 与新增历史导入操作调用 |
| `fundamentals/reference-periods.test.ts` | 模块测试 | 随规则迁移，保留历史起点及季度边界验证 |

证券代码合并只返回其实际修改及影响日期；后续派生重算、运行 checkpoint 与发布决策仍由 weekly 负责。
`instruments/stock-identity.ts` 继续保持纯身份规则，代码合并的持久化逻辑不混入该文件。

### 4.4 继续保留的 Market 同步文件

路径以 `apps/api/src/market/sync/` 为基准。它们不因调用方迁移而变成可执行脚本。

| 文件 | 职责 |
| --- | --- |
| `stocks.ts` | 股票名录、历史名称与已登记代码变更 |
| `calendar.ts` | 交易日历同步与开市日期读取 |
| `stock-daily.ts` | 股票行情/复权/估值/涨跌停同步，以及四表候选校验与事务替换 |
| `stock-flows.ts` | 个股资金流和龙虎榜的同步/刷新 |
| `etf-history.ts` | ETF 元数据和手动范围同步使用的证券/年度历史切片验证、写库、断点；不再是 weekly 历史查缺的实现 |
| `etf.ts` | 按交易日同步 ETF 行情/复权/规模、覆盖验证和修订刷新；`fillEtfHistoryGap` 负责按缺失数据集请求、校验并只插入缺失键 |
| `indices.ts` | 指数目录、成分权重、行情、估值、申万成员和行业行情 |
| `futures.ts` | 股指/商品合约与行情，以及股指期货映射和结算参数 |
| `market-indicators.ts` | 本地市场、指数、行业派生指标的批计算与落库 |
| `cross-market-benchmarks.ts` | 跨市场基准注册、来源选择和分段同步 |

相关 Market 质量文件继续位于 `apps/api/src/market/quality/`：

| 文件 | 既有接口与职责 |
| --- | --- |
| `etf-history-coverage.ts` | `ETF_HISTORY_START`、`inspectEtfHistoryCoverage(database, products, dates)`：依据上市/退市生命周期逐代码/日期比对日线、复权、份额，供恢复和审计共用 |
| `etf-registry-audit.ts` | `auditEtfResearchRegistry`：组合 registry/元数据/覆盖审计，复用全历史预期键检查发现区间内部缺口，保留不同缺失类型的错误/警告语义 |

其他直接依赖保持原职责：`market/fundamentals/sync.ts` 处理原始财报版本同步，
`market/fundamentals/reference-sync.ts` 处理财务指标/分红协调；各 rates/macro/commodity 文件见 §3.1。
`signals/scheduler.ts` 保留每日周期和已发布数据上的信号生成，`signals/sync.ts` 保留部署所需数据补齐；
`auth/invite-code.ts` 保留码生成、规范化和格式校验。上述文件无新增命令启动副作用。

## 5. 调用方向与进程边界

```text
pnpm / Shell / systemd
  ├─ Market CLI ────────────────→ Market 数据操作
  ├─ 应用维护 CLI ─────────────→ Application Maintenance 操作
  │                               ├─ Market 数据操作 / 证券代码合并 / 财报分期
  │                               ├─ Signals 同步与信号生成
  │                               ├─ Market 质量 + Strategy 模型要求的整体审计
  │                               └─ reference-worker-process → reference-worker
  ├─ Signals CLI ──────────────→ Signals 周期 → Market 数据操作
  ├─ Auth CLI ─────────────────→ Auth 码生成 + 邀请码写库
  └─ node backup-db.mjs ────────→ sqlite3 CLI + 文件系统

API server → Application Maintenance routes / middleware → 维护状态查询
部署入口 → MaintenanceRun（kind=deploy）→ 同一 HTTP 门禁读取

Application Maintenance weekly → recoverEtfRegistry
  ├─ Market inspectEtfHistoryCoverage / fillEtfHistoryGap（历史补缺）
  └─ Market syncEtfMarketDate（近期修订）
Market registry 审计 → 同一个 inspectEtfHistoryCoverage
```

- 可复用实现不导入 CLI；CLI 不导入整应用 `index/bootstrap/server` 来获得执行环境。
- 模块内引用使用相对 `.js` 导入；跨模块使用 API package.json 的 `#market/*`、`#application-maintenance/*` 等别名。Market 不直接或间接回调应用维护协调模块。
- 边界检查继续覆盖 `src`；更新模块改名相关的精确 HTTP 路径和 Market 直接/间接依赖规则，保持原有约束，不新增目录级豁免。
- `reference-worker.ts` 随模块迁入 Application Maintenance，仍是内部子进程入口；父进程与 Worker 保持同目录及相对 URL，`.ts`/`.js` 选择和 IPC 协议保持。
- 等待 Job、Agent turn、Factor weather 完成属于应用维护流程的状态检查；Factor/Research 目前直接读取 MaintenanceState 的已有数据耦合本次保留，不把它描述为新增跨模块函数调用。
- 操作系统锁仍由 Shell/systemd 获得。CLI 或业务中的前提检查不等于实际取得锁。
- 新业务操作允许加载必要运行配置，但导入文件不能自动启动任务；执行、输出和进程终止的边界应可单独阅读。

## 6. 命令、部署与文档联动

### 6.1 运行契约

| 场景 | 迁移后入口/约束 |
| --- | --- |
| 本地源码命令 | 股票价格同步使用 `pnpm --filter api sync:stock-prices`，其余命令名保留；继续使用 `tsx --conditions=development --env-file=.env`，cwd 为 `apps/api` |
| 根级股票价格同步 | `pnpm sync:stock-prices [start] [end]` 转交 API 同名命令；原根级 `sync` 命令移除 |
| 根级维护命令 | `pnpm maintenance ...`；继续经过根级 `with-maintenance-lock.sh` |
| 生产 daily/weekly | `/usr/bin/node /opt/jixie/apps/api/dist/src/application-maintenance/cli/run-maintenance.js daily\|weekly`；保留现有 flock、环境文件、用户、超时、重试和工作目录 |
| ETF 历史恢复 | 由既有 weekly 调用 `recoverEtfRegistry`，使用本轮维护状态、发布水位与锁；不新增 bootstrap 直调或独立 CLI |
| 财报参考 Worker | `src/application-maintenance/reference-worker.ts` / `dist/src/application-maintenance/reference-worker.js`；IPC、源码 execArgv 继承与编译模式行为保持 |
| HTTP 与部署维护状态 | `/api/maintenance/status`、`/api/app/*` 门禁、`kind=deploy` 及 MaintenanceRun/Checkpoint/State 模型保持；server 只切换源码模块导入 |
| 备份 | `/usr/bin/node /opt/jixie/apps/api/scripts/backup-db.mjs`；Node 内置模块、sqlite3 CLI，默认数据库路径仍锚定 API prisma 目录，环境变量覆盖语义不变 |

API tsconfig 已包含整个 `src`，不修改编译根。API `package.json#imports` 将旧 `#maintenance/*` 条目替换为以下配置，其余条目保留：

```json
{
  "#application-maintenance/*": {
    "development": "./src/application-maintenance/*",
    "default": "./dist/src/application-maintenance/*"
  }
}
```

同步更新所有内部消费者，旧别名不保留；Market、Signals、Auth 的既有别名继续使用。
生产必须保留 API package.json，不能将 dist 脱离原生别名配置单独运行。

28 个 TS 入口及备份 MJS 的旧直接文件路径将移除；原 `sync` 命令按 §1.5 改名，其余 pnpm 命令接口保持。
已安装的 systemd unit 必须随版本重新安装并加载，旧 unit 不能与新构建混用；仅拉源码不算完成部署切换。
本次开发交付包含可部署配置，但不执行生产部署、不启动维护 timer、不执行生产数据任务。

### 6.2 逐文件联动清单

| 文件 | 计划处理 |
| --- | --- |
| 根级 `package.json` | 将 `sync` 快捷命令改为 `sync:stock-prices`，转交 API 同名命令，参数传递保持 |
| `apps/api/package.json` | 更新 28 个应用命令及 `backup` 的路径，共 29 个；其中 `sync` 改为 `sync:stock-prices`；用 `#application-maintenance/*` 替换旧模块别名；不新增 ETF 恢复命令 |
| `apps/api/src/application-maintenance/` | 从原 Maintenance 迁入剩余实现、README 和模块测试，迁入 2 个 CLI 并新增 2 项流程操作；weekly 改用 Market 的证券代码合并与财报分期规则 |
| `apps/api/src/market/instruments/canonicalize-stock-codes.ts` | 从原 Maintenance 迁入；修正 Market 内相对导入，保持事务、冲突规则和返回接口 |
| `apps/api/src/market/fundamentals/reference-periods.ts` 及 `.test.ts` | 从原 Maintenance 同名迁入，保留纯分期规则；weekly 和历史导入操作使用新的跨模块路径 |
| `apps/api/src/server.ts` | 路由和门禁改从 `#application-maintenance/routes.js`、`#application-maintenance/middleware.js` 导入；具名导出和 HTTP 挂载保持 |
| `apps/api/scripts/audit/audit-data.ts` | 保持现有 CLI 位置及行为，只更新整体审计导入别名 |
| `apps/api/tests/import-aliases.test.ts` | 保留原覆盖，增补新应用维护别名的源码/生产解析与可加载性验证 |
| `scripts/checks/check-backend-boundaries.mjs` | HTTP 适配精确路径改为 `application-maintenance/middleware.ts`；更新 Market 的直接及传递依赖禁入目标；旧 maintenance 源码目录纳入已退役目录，防止漏改绕过规则 |
| `scripts/checks/check-backend-boundaries.test.mjs` | 更新维护门禁 fixture；验证新模块的 HTTP 边界、Market 直接/间接禁入和旧目录退役，保持允许/拒绝语义 |
| `apps/api/scripts/backup-db.mjs` | 从原目录移入，默认数据库定位改为 `join(scriptDir, '..', 'prisma', 'dev.db')`，更新用法注释；备份、验证、轮换算法及环境变量语义保留 |
| `deploy/jixie-maintenance.service` | 将 daily 的编译入口改至模块 CLI |
| `deploy/jixie-maintenance-weekly.service` | 将 weekly 的编译入口改至模块 CLI |
| `deploy/jixie-backup.service` | 将 ExecStart 改为新的 MJS 源码路径；保留 Node 直调、数据库/备份目录配置和服务参数 |
| `deploy/com.jixie.backup.plist` | 保留现有 pnpm backup 调用；通过 package.json 使用新路径，无需改 plist |
| `scripts/bootstrap.sh` | 更新 sqlite3 依赖说明中的备份路径；核对现有 pnpm 调用及 service 安装，保持独立 ETF 恢复调用已删除 |
| `scripts/maintenance/import-market-data.sh` | 将逐年股票行情阶段的 `pnpm --filter api sync` 改为 `pnpm --filter api sync:stock-prices`；阶段键、日期切片和其他命令保持 |
| `apps/api/scripts/README.md` | 更新为 API 命令与独立脚本索引；逐项链接新位置、保留备份例外；核实当前数量，不加入已删除的 ETF 恢复入口 |
| `apps/api/src/market/README.md` | 增加 24 个 CLI 定位、证券代码合并和财报分期入口；解释单项同步与整轮发布的差别，更新协调模块链接 |
| `apps/api/src/application-maintenance/README.md` | 随目录改名迁移；解释全应用协调、2 个 CLI、两项新增流程、迁回 Market 的职责及混合职责边界；保留最新 ETF 恢复说明 |
| `apps/api/src/strategy/README.md` | 更新应用维护风险审计和整体审计的链接，保持 Market/Strategy 质量职责说明 |
| `apps/api/src/signals/README.md` | 链接 signals:run 的新位置及既有 scheduler 调用 |
| `apps/api/src/auth/README.md` | 链接邀请码管理员入口，说明其写库职责 |
| 根级 `README.md` | 更新应用维护实现与说明文档的当前链接，保持产品范围及生产使用语义 |
| `scripts/README.md` | 说明应用 CLI 按模块归属、根级脚本编排对应 pnpm 命令及股票价格同步新名称 |
| `docs/backend-architecture.md` | 更新 Application Maintenance 名称与职责、迁回 Market 的实现、模块 CLI 阅读规则及维护调用链 |
| `docs/backend-boundaries.md` | 更新应用维护 HTTP 精确路径和 Market 禁入模块名，说明规则随改名迁移而没有放宽 |
| `docs/backend-runtime-entries.md` | 登记新的源码/编译入口、Worker 随模块迁移的路径和备份独立运行条件 |
| `docs/design/production-maintenance.md` | 更新当前可执行的 systemd/CLI 示例，不改历史运行语义 |
| `docs/design/factor-to-strategy.md` | 更新现有申万同步入口的源码定位 |
| `CLAUDE.md` | 更新 Application Maintenance 的目录/职责、Market 的两项归属，补充模块 CLI 约定、轻量组合允许范围和独立脚本例外 |
| `docs/design/api-cli-organization.md` | 保存审批状态、静态检查、review、验证和最终提交记录 |

对当前命令说明和可执行示例进行引用扫描。明确标为历史基线或既往验收的记录保留当时路径，不将历史验证改写成已验证新入口。
历史设计中的阅读导航链接仍需指向可用文档，例如 `backend-architecture-refactor.md` 的模块 README 链接；仅更新链接目标，不重写其已完成提交和验收记录。

本次没有新增/重命名可部署 workspace，也没有改变跨包构建依赖。
`deploy/component-impact.json` 的 `apps/api/` 与 `deploy/`、根级 `scripts/` 前缀已覆盖所有变更，因此预计不修改映射或部署规划测试。
审查后运行既有 `scripts/deploy/plan-deployment.test.mjs`。若实现需要改变组件或跨包构建依赖，须回到 Gate 1，并同时规划这两个文件的修改。

## 7. 验证计划

### 7.1 产品代码 review 前：只做静态检查

先检查每个组合命令内容，避免夹带测试、构建、业务执行或数据库操作。

1. `pnpm check:backend-boundaries`：确认所有新路径解析成功、Market 没有直接/间接反向导入 Application Maintenance、没有新的跨模块循环；核对 HTTP 精确路径和退役目录规则。
2. `pnpm --filter api typecheck`：只运行 `tsc --noEmit`，覆盖 CLI、新操作及测试代码。
3. 对变更的 TS/JS/JSON 跑 ESLint 和 Prettier 静态检查；Markdown 按仓库既有忽略配置处理。
4. 核对 daily/weekly/backup 三个 service 配置只改变入口路径；对备份 MJS 执行 `node --check`，对 bootstrap 和批量导入脚本分别执行 `bash -n`，只做语法检查。
5. 静态核对 28 个 CLI TS + 1 个 MJS、29 个 API package 命令、根级 sync:stock-prices 快捷命令、Shell 调用和三个 service 路径；核对 CLI 分配为 24/2/1/1，业务文件与测试迁移另计。确认旧 sync 命令、旧 src/maintenance 与旧包内别名均已移除，备份默认数据库锚点不变，独立 ETF 恢复入口保持删除，可复用生产实现没有反向导入 CLI。
6. 核对文档相对链接、源码/编译路径和默认运行目录；`git diff --check`。

如果全量静态检查出现无关基线问题，应报告来源，不顺便扩大重构。需要修改受本次影响的代码则修复后重跑相应静态检查。
此阶段不运行 unit/integration/E2E、真实 CLI、构建或 smoke。

### 7.2 产品代码 review 后：行为验证

| 文件/验证对象 | 需证明的行为 |
| --- | --- |
| `application-maintenance/baseline-repair.test.ts`（新增） | 目标日期裁剪、无开市日失败、deferred 失败、正确选择派生重算区间；不写水位或维护运行、不关闭调用者 Prisma |
| `application-maintenance/financial-history-import.test.ts`（新增） | 历史报告期使用 Market 分期规则；分红只选择未导入证券；三阶段顺序与批大小保持；Worker 运行 ID 为 null；子进程错误中止后续阶段并向上抛出 |
| `market/fundamentals/reference-periods.test.ts`（迁移） | 原历史起点、季度边界规则的行为保持 |
| 既有 ETF 回归：`application-maintenance/etf-recovery.test.ts`、`market/quality/etf-history-coverage.test.ts`、`market/sync/etf.test.ts` | 保持全历史逐键检查、重试发现新缺口、修订日期 checkpoint、仅填缺失键及必需复权缺失时拒绝写入；不新增针对已删除 CLI 的测试或恢复接口 |
| `apps/api/tests/cli-entrypoints.test.ts`（新增） | 包级命令和部署入口映射一致；根级/API 的 sync:stock-prices 指向正确、日期参数继续传递且旧 sync 不再注册；选择代表入口验证失败退出与资源收尾；备份仍为独立 MJS 入口 |
| `scripts/checks/check-backend-boundaries.test.mjs` | review 后执行 `pnpm test:backend-boundaries`；新模块 HTTP 边界仍有效，Market 的直接/间接回调继续拒绝，旧目录不能重新引入 |
| `apps/api/tests/import-aliases.test.ts` | 新别名在 development 条件下由真实主进程与 Worker 加载源码；生产默认条件解析到编译目标，两种条件下旧别名均不可解析；编译模块实际加载由下方真实进程验证覆盖 |
| 既有相关测试 | 随迁的应用维护 state/routes/daily-schedule/self-heal/weekly/审计/ETF 恢复及 reference-worker-process；包括部署状态复用门禁的既有回归；Market ETF 历史/财报同步；部署规划测试 |
| 干净 API 构建 | 无旧产物的临时构建环境中生成全部 28 个迁移 CLI 及依赖，两个 service 指向的目标都存在；Worker 位于新模块，旧 dist/src/maintenance 和独立 ETF 恢复产物均不存在；备份源码无需构建 |
| 源码与编译的真实进程验证 | 用隔离数据库和本地 provider 替身验证 Market CLI（包含改名后的 sync:stock-prices 和既有 sync:etf）、maintenance baseline，以及 financial CLI → reference Worker 的子进程链；确认开发条件/生产默认别名与 IPC/退出正确 |
| 独立备份路径验证 | 在无 node_modules、无应用构建的临时同结构目录内，用小型 SQLite fixture 从其他 cwd 直接执行新 MJS；核对默认数据库定位、环境变量覆盖及备份可读性，输出与轮换仅使用临时目录 |

测试按职责留在模块内；包级路径、命令/部署契约测试放 `apps/api/tests`。
不为每个简单移动单独写一套镜像测试，也不把“编译文件存在”当作全部运行验证。
代表性源码/编译验证覆盖每个新提取流程和财报 Worker 路径；其余纯路径迁移以构建产物、模块解析及静态映射检查覆盖。

财报链需要保持原进程协议，使用本地替身响应控制外部数据；所有数据写入只发生在独立临时数据库。
不执行真实 Tushare/BLS 等请求、真实行情回填、邀请码发放或信号邮件；不安装/启动生产 systemd 服务。
若本机没有 systemd，明确将本地验证限定为配置入口核对与对应 Node 进程验证，不声称已完成生产 service 验收。
备份的实现差异仅限默认数据库相对定位和用法说明；除临时 fixture 验证外，核对备份/验证/轮换算法不变。
备份验证不访问用户真实数据库和现有备份目录，不安装或启动定时服务。

构建及测试只在 review 通过后运行；若需要先构建 shared，仍在此阶段执行。
清理本次创建的临时进程、监听端口、IPC 和数据库连接，并记录真实结果。

## 8. 不变项、风险与重新审批条件

### 8.1 不变项

- 除已明确的 `sync` → `sync:stock-prices` 外，CLI 命令名保留；所有参数位置、日期默认值、选择器、refresh 与失败退出契约保持，不顺便统一历史默认日期或补充新参数校验。
- 同步顺序、数据来源、覆盖阈值、事务与 checkpoint key、财报版本/PIT 语义。
- 维护锁、调度频率、运行状态机、水位、dataRevision、恢复顺序和 Signals 行为。
- `maintenance` 命令、systemd unit 名、环境变量、锁文件、具名函数/类型、HTTP URL 和 MaintenanceRun/Checkpoint/State 数据模型保持；目录与包内别名按本计划改名。
- Prisma schema、数据库迁移、HTTP/SDK 契约、依赖包和 workspace 构建关系。
- 备份算法、数据库默认实际位置、环境变量、保留数量和零 npm 依赖运行契约；源码位置和服务入口按本计划调整。

### 8.2 已知风险与判断

1. **安装过的 unit 路径过期**：必须交付并部署同版本 service；旧源码直调路径不提供永久转发兼容层。
2. **把 CLI 搬进 Market 引出反向依赖**：财报历史导入与 Worker 暂留 Application Maintenance；证券代码合并和分期规则不依赖协调模块，可以迁回 Market；边界检查不放宽。
3. **提取流程时改变前提检查顺序**：基线修复与基线发布不能混同，财报全量导入和 weekly 的选取/断点语义不能合并；用行为测试约束。
4. **源码可运行而编译入口失败**：保留包内条件别名、API cwd、package.json 和 Worker 路径；用两种产物的真实进程验证。
5. **迁移之际统一不同恢复策略**：本次只归并职责，保留已有显式分支和不同 checkpoint 语义。
6. **照初稿恢复已删除流程**：不得重建独立 ETF 恢复 CLI、bootstrap 调用或已取消的已发布恢复接口；不得让 weekly 退回年度完成标记判断覆盖。
7. **备份移出后数据库定位偏移**：按脚本位置修正一级目录深度，仍指向 API prisma 目录；用从其他 cwd 启动的临时 fixture 验证，不能依赖生产环境显式路径掩盖默认路径错误。
8. **旧股票同步命令失效**：根级和 API 命令同时改为 `sync:stock-prices`，本仓库导入脚本和当前用法说明一起更新；仓库外人工命令需采用新名称，保留阶段键以免目录/命令改名触发重新导入。
9. **模块改名让边界检查失效或漏掉调用方**：同步修改新模块的精确 HTTP 路径、Market 直接/间接禁入规则、包内别名与 server/audit 引用；用边界 fixture 和源码/生产别名验证约束，不保留旧模块转发目录。
10. **将职责收窄扩大成全面拆分**：本次只迁出证券代码合并与财报分期两个明确领域实现；整体审计、发布质量、自愈及 Worker 的混合职责记录在 §1.6，不改造通用调度/Worker 框架，不改变检查与发布语义。

若需要在本计划之外进一步改变命令接口、数据语义、锁/状态机、生产部署模型、增加依赖、放宽边界规则，或发现必须修改其他模块的产品行为，暂停相关实现并返回 Gate 1。
单纯相对导入修正、文档链接和已批准范围内的测试修正不单独触发范围审批。

## 9. 工作流与完成标准

这是一个完整的实现提交，不拆成“先搬一部分再决定后续”的阶段。

1. **Gate 1**：用户审批本文范围及精确 commit message 后开始实现。
2. **实现与静态检查**：完成全部迁移、流程提取、测试代码、配置与文档；只跑 §7.1。
3. **Gate 2**：提交未 commit 的 diff 供人工代码 review，说明静态结果、风险及待跑验证。
4. **验证与提交**：review 通过后跑 §7.2；必需验证全部通过，更新本文记录，再按预告 message 提交。此次 review 批准按显式工作流同时提供验证后提交授权，不额外请求第三次确认；不 push。
5. 若验证需要修正产品代码，完成静态检查后返回 Gate 2；已批准范围内仅测试/fixture 的修正可自主完成并复验。

完成标准：

- [x] 24 个 Market、2 个 Application Maintenance、1 个 Signals、1 个 Auth CLI 全部位于目标模块。
- [x] 原 Maintenance 的剩余实现、README 和测试迁入 application-maintenance；证券代码合并实现及其 CLI、财报分期规则及测试归回 Market。
- [x] 新包内别名、server/audit 导入、Worker 路径与边界检查规则一致；旧源码模块和旧别名没有残留，既有外部维护契约保持。
- [x] 股票价格同步文件和根级/API 命令采用明确名称，导入脚本同步调用且 checkpoint 键保持。
- [x] 两处待提取流程已有明确 Application Maintenance 操作入口；轻量命令未被机械拆成转发层，混合职责没有借迁移扩大为全面拆分。
- [x] ETF 历史恢复保持 weekly 的既有执行链，覆盖检查和仅补缺失键能力保留，不恢复已删除的独立入口。
- [x] backup 位于 API scripts 根目录，默认数据库实际位置及独立执行契约保持；备份 service 和 pnpm 命令使用新路径。
- [x] package、bootstrap、service、当前使用文档引用一致；28 个旧 TS 入口及旧备份位置没有遗留转发副本，API 的 scripts/sync 和 scripts/maintenance 不再保留。
- [x] 静态检查通过，产品代码完成人工 review，所需行为验证和干净构建通过。
- [x] 临时进程/端口/数据库连接已收尾，提交记录与实际验证结果一致。

## 10. 开发记录

| 项目 | 当前状态 |
| --- | --- |
| 仓库与代码核对 | 已完成，当前基线 `24f20ce6` |
| 2026-09-15 最新提交复核 | 已据 ETF 恢复变更收缩迁移范围；修订清单、职责、部署及验证安排，见 §1.3 |
| 2026-09-15 备份位置反馈 | 计划将备份移至 API scripts 根目录，同步默认数据库定位、命令和 service 路径，见 §1.4 |
| 2026-09-15 股票同步命名反馈 | 原 sync.ts / sync 改为 sync-stock-prices.ts / sync:stock-prices，根级快捷命令和导入调用同步；已更新拟议提交信息，见 §1.5 |
| 2026-09-15 应用维护职责反馈 | 用户已确认方案方向并要求更新文档；计划改名 application-maintenance，证券代码合并及 CLI、财报分期规则归回 Market；同步路径、别名、边界和验证范围，见 §1.6 |
| 本计划 | 用户以“目前看没问题，继续”批准计划，按既定范围完成实现 |
| Gate 1 范围 / commit message | 已批准；精确提交信息及 footer 见本文顶部 |
| 产品实现与测试代码 | 已完成迁移、两处流程提取、路径/别名/边界规则及文档联动；新流程、入口、别名和边界回归已编写 |
| 静态检查 | API tsc --noEmit、ESLint、Prettier、后端边界、Shell/Node 语法与 diff 检查通过；CLI 映射与 Markdown 链接已核对 |
| Gate 2 人工代码 review | 用户以“继续”批准代码 review，授权验证通过后按既定信息提交 |
| 行为验证 / 构建 | 103 项 API 测试、34 项边界/部署测试、干净 API 构建、源码/编译进程及独立备份验证全部通过，见 §10.2 |
| Git commit / push | 本记录与实现使用顶部已批准信息一并提交；具体 hash 以本文件 Git 历史为准；未 push |

### 10.1 2026-09-15 实现与静态检查交付

- 迁移了 59 个既有文件：28 个 TS CLI、独立备份和原 Maintenance 的实现/测试/README；另外新增两项流程及其测试、包级 CLI 契约测试。具体目录见 §2。
- `repairBaseline` 保留锁前提、日期裁剪、lookback、自愈与派生验证，CLI 负责参数格式、完成输出和 Prisma 收尾；不承担 daily 的基线发布。
- `importFinancialReferenceHistory` 返回三阶段累计摘要，使用 Market 分期规则，保留空运行 ID、跳过已有分红及顺序分批。展示行数查询和进程收尾仍在 CLI。
- 原模块其余生产实现保持行为。weekly 仅修改两个 Market 导入；财报 Worker、ETF 恢复及发布状态实现没有行为改写。备份仅调整用法路径和默认数据库定位的一级目录深度。
- 静态结果：后端扫描 694 文件、2617 条运行时边、622 条类型边，0 violations；4 条既有例外、0 跨模块循环组保持。API `tsc --noEmit` 与受影响源码 ESLint/Prettier 通过，备份 Node 语法、bootstrap/导入 Shell 语法及 diff 检查通过。
- API 命令索引按实际目录核实为 39 个入口；移除了已不存在的 API generators 目录说明。历史验收记录保留原事实，旧设计的阅读导航链接更新到现有位置。
- 已准备 §7.2 的流程测试、命令/服务映射、无效参数进程退出、新别名和边界 fixture；真实 provider 替身/临时数据库及干净编译运行验证仍待 review 通过后执行，不以静态检查代替运行验证。
- 主要兼容变化：原 `sync` 命令更名为 `sync:stock-prices`；源码和编译入口移动，已安装的 daily/weekly/backup unit 需随版本更新。维护命令、HTTP URL、schema、环境变量和锁协议保持。

### 10.2 2026-09-15 review 后验证与提交记录

产品代码 review 通过后执行以下验证；未修改已审查的产品代码。

| 验证 | 实际结果 |
| --- | --- |
| API 相关单元/集成测试 | 23 个文件、103 项测试通过：完整 application-maintenance 测试、Market 分期/财报同步、股票日线、ETF 历史/覆盖/补缺、包级入口及别名测试；Prisma 全局默认指向临时数据库，集成用例独立迁移临时 SQLite |
| 边界检查器与部署规划回归 | `node --test scripts/checks/check-backend-boundaries.test.mjs scripts/deploy/plan-deployment.test.mjs`：34 项全部通过 |
| 干净 API 构建 | `pnpm --filter api exec tsc --outDir <临时目录>/build/apps/api/dist` 通过；28 个 CLI、新 reference Worker 和 service 对应入口均生成；旧 `dist/src/maintenance`、`dist/scripts/sync`、`dist/scripts/maintenance` 均不存在；使用既有已安装依赖和未变更的 shared 产物 |
| 源码与编译版 Market CLI | 两种模式分别在独立迁移数据库执行 `sync-stock-prices` 与 `sync-etf`，本地 HTTP 替身提供数据；核对股票/ETF 名录、日线、复权、份额、可得日期、ETF 切片 checkpoint 及股票日期参数 |
| 源码与编译版 baseline | 在完整原始数据切片中故意留下 Moneyflow 缺口，实际调用 Market 补齐并通过原始数据校验；维护水位、dataRevision 和已有状态不变，不创建 MaintenanceRun；派生重算及错误分支另由流程单元测试覆盖 |
| 源码与编译版财报 CLI → 子进程 | 实际导入 3 个报告期，以 2 个报告期分批；每类报表入库 9 个版本、财务指标 3 行、分红 1 行；真实 Worker IPC 返回摘要，空运行 ID 不写维护 checkpoint；本地源错误使 Worker 和父 CLI 都以 1 退出，后续批次/阶段不再执行 |
| 编译后的原生别名 | 使用默认生产解析条件，在真实主进程及 Worker 中加载 `#application-maintenance/daily-schedule.js`；开发条件加载及旧别名拒绝已由包级测试覆盖 |
| 独立备份 | 临时同结构目录只有 MJS 与 SQLite fixture，无 node_modules、无构建；从其他 cwd 用 Node 直接执行。默认数据库锚点、JIXIE_DB_PATH 覆盖、备份内容及 integrity_check、按前缀保留最新 2 份和不触碰无关文件均通过 |

验证过程中，沙箱禁止本地端口监听；获准后使用仅绑定 `127.0.0.1` 的临时数据源替身完成验证。
首轮临时 harness 的失败断言误设为“首个错误只产生 1 次请求”，而既有财报实现预先将三张报表请求一起排队。
根据实际调用契约将断言修正为“三张已排队请求可以结束，不能开始后续报告类型、报告期或阶段”，并在新的临时数据库重跑通过；未修改产品代码或放宽失败传播要求。

本地证据目录为 `/tmp/jixie-cli-verify.UqGBQN`，包含测试/构建日志、临时运行 harness、provider 请求记录、备份检查和进程清理记录；它是本次本地验证材料，不作为仓库运行依赖。
最终一轮 13 个直接子进程及其进程组均已退出，替身监听已关闭，Prisma 客户端已断开。测试未访问真实行情服务、用户数据库或现有备份；未发送邀请码/邮件，也未安装或启动生产 systemd 服务。
systemd 验证范围为配置入口核对及对应 Node 进程运行，不能替代部署后的服务验收。
