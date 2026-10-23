# 统一数据同步：开发验证交付

日期：2026-10-24（Asia/Shanghai）。基线：`0de7bbc6647ff1a7f77ca0b605849a05ffe4ae23`。

第四轮产品代码和 Prisma 迁移 SQL 均经人工审阅通过；用户随后批准执行验证并在全部通过后提交。本记录是开发者的实际验证证据，供原设计会话独立验收，不替代独立验收结论。提交信息与 Gate 1 完全一致。

## 最终结果

- API 联合回归：**143 个文件、751 项测试全部通过，零失败、零跳过**。固定文件清单见 [verification-tests.txt](unified-data-sync-verification-tests.txt)。覆盖 Market、Maintenance、Signals、Backtesting、Factor、Research SDK、Job、CLI 及迁移。
- 部署/bootstrap/后端边界自测：57 项通过；E2E runner 自测 8 项、提交信息检查器自测 3 项及原提交信息校验通过。
- 根级 `pnpm build` 通过：shared/API/Web/Docs/sandboxd；Web 保留 Vite 大于 500 kB 的构建提示，不影响构建完成。
- `pnpm typecheck` 通过：后端边界 900 文件、3470 条运行时依赖、1010 条类型依赖、零违规；SDK 生成物一致性及全部 workspace 类型检查通过。
- `pnpm exec eslint . --ignore-pattern '.venv/**' --max-warnings 0`、`pnpm format:check` 通过。排除项仅为既有本地第三方虚拟环境，未修改 lint 规则。
- 本次新增/修改的 122 处双语 JSDoc 中英文空段检查通过；改动 Shell/MJS 语法及 `git diff --check` 通过。
- 源码 CLI 帮助、非法参数、alias 在联合回归中通过；另在全新临时 outDir 编译 API，执行 7 组编译后帮助/非法参数检查，旧 CLI 编译产物不存在。
- 维护状态双语浏览器检查、市场气象浏览器回归通过；截图已实际打开检查。浏览器采用 HTTP fixture，未连接工作 API/数据库。

## 迁移升级与数据保真

执行 [unified-sync-migration.test.ts](../../apps/api/tests/unified-sync-migration.test.ts)，使用复制到临时目录的真实迁移链和 schema，经 Prisma 6.19.3 `migrate deploy` 验证两条路径：97 个历史迁移 → 填入旧数据 → 新迁移，以及空库 → 全部 98 个迁移。测试 finally 关闭连接并删除临时库。

升级前对全部 88 张旧业务表建立快照；升级后逐行核对全部旧字段，并按列名比较类型、默认值、主键和非空约束（仅允许批准的可空调整），核对索引及其列、外键定义、`foreign_key_check` 与 `integrity_check`。Prisma 重建可能调整物理列顺序，因此不把 cid 当业务契约；按列名取值验证数据一致。

夹具包含三张重建表、零值 Moneyflow、FactorWeatherPin、报告、研究文档、信号、成交、账户快照、旧期货发布与旧财务指标。旧值、旧索引及用户结果均保留；8 张新表为空，新 pin 字段为 null。首次有限 sync 接续旧 revision=17，没有以旧行数伪造 complete 覆盖；旧派生结果在重新获得资格之前保持屏蔽。完整获取/计算后的资格恢复另由真实同步集成测试证明。

| 路径 | Prisma deploy 耗时 | 执行前库大小 | 执行后库大小 |
| --- | ---: | ---: | ---: |
| upgrade | 324.000 ms | 1597440 bytes | 1712128 bytes |
| empty | 559.257 ms | 4096 bytes | 1712128 bytes |

旧库夹具升级后增加 114688 bytes（112 KiB）。这里记录的是小规模隔离夹具的迁移命令总耗时和持久文件增长，未测量生产大表耗时或瞬时磁盘峰值；SQLite 表重建部署时仍须为复制和日志预留空间。没有对工作库执行 migrate、db push 或 reset。

97 个历史 migration.sql 和 migration_lock.toml 与基线逐字节一致；生成 SQL 从复审到验证结束均未修改：

- schema SHA-256：`0fbadaff35d42c7b2c6b2dd9f01535f9bcf16a26bfa9a3a424988eff39d41cc1`
- migration.sql SHA-256：`ed6dd5291b5553ab564f559ca7dd95abb36440df6f7aed410cc2e1f06295d793`

## 验收证据对应

下列入口均在最终通过清单内；具体 R01–R16 实现说明继续见 [Gate 2 交接](../design/unified-data-sync-gate-2.md)。表格表示开发验证完成。

| 验收 | 可定位证据 |
| --- | --- |
| A01 | tests/cli-entrypoints、import-aliases、scripts/command-entry、source.test 日期冻结；干净编译后 7 组 CLI 进程检查；部署自测。 |
| A02 | sync.integration 空库存量发现与有限预算；review-regressions.integration R02 跨 2015–2025 fixture 日历分轮回补，不跨越未核验区间。 |
| A03–A05 | sync.integration 部分批次合并、晚到旧缺口、未知字段保留及幂等；source.test 分页失败、重复页、稀疏权威空和稠密未知空。 |
| A06 | sync.integration 精确授权删除/null 修订/半快照拒绝/身份接续；review-regressions.integration R01、R09 全快照及归一冲突。 |
| A07 | sync.integration 有限错误与预算；publication-review.integration R12/R13 持久失败及冷却；settlement.integration R14 账户等待/错误；run-signals.test R16 退出码。 |
| A08 | Backtesting 执行日缺价格限制保持不成交；forward-readiness.integration R03 正式截面与未成熟远期窗口；review-regressions R06/R10、coverage-invalidation R15；Research 完整资格夹具。 |
| A09 | sync.integration 指标捕获版本/PIT；财报 resolver/source-contract；Research supplemental 财务可得日及分红经济日分离；迁移旧报告/信号/账户保真、账户和冻结输入回归。 |
| A10 | sync.integration 有界失效和公式版本变化；Research market-revision/research-sandbox-pool；R05/R10/R15 真实读取、私有副本 SQL 和资格恢复。 |
| A11 | sync.integration 发布边界事务回滚、重复执行和重算；publication-review R12/R13；Signals 恢复/结算的失败后重试及已完成结果不重复。 |
| A12 | sync.integration 独占写者及稳定用户读取；覆盖/原始记录/结果在事务边界提交；维护 HTTP 门禁和浏览器 partial 可用。 |
| A13 | sync.integration 旧资源核验回收；read-copy.integration 活跃/未知/崩溃副本；recovery.integration owner 消失、取消、独立执行和通知不重复；真实 worker.integration 取消、父 IPC 断开、PID/端口释放。 |
| A14 | Gate 2 中 24 项旧能力映射；source/provider/领域适配、SDK/Python/data loaders、SQL 文档、共享 Contract、生成 stub、部署计划及中英帮助/浏览器检查。 |

R01/R02/R05/R06/R09/R10/R11 的联合回归入口为 `maintenance/review-regressions.integration.test.ts`；R03 为 `factor/analysis/cross-sectional/forward-readiness.integration.test.ts`；R04 为 `signals/daily/recovery.integration.test.ts` 和真实 Worker 集成；R07 为 `infra/database/read-copy.integration.test.ts`；R08 为更新后的既有部署、Signals、Research 和 Maintenance 回归；R12/R13 为 `maintenance/publication-review.integration.test.ts`；R14 为 `signals/daily/settlement.integration.test.ts`；R15 为 `maintenance/coverage-invalidation.integration.test.ts`；R16 为 `signals/cli/run-signals.test.ts`。

## 纯测试修正

验证中没有修改已批准的产品 TypeScript、schema、Python 或 SQL。测试修正遵循批准后的测试例外：

- 临时库 helper 先初始化有效空 SQLite，并把 schema 放进临时目录，避免 Prisma 空文件错误及项目环境加载。
- 修正 Vitest beforeEach 意外返回 mock 函数、无效的手填分区 ID、缺少身份归一元数据及冷却断言；保留并验证真实重试条件。
- 旧回测夹具显式提供已知有效的执行日价格限制；另保留缺限制不成交的回归。没有全局补造默认价格限制。
- 旧 Signals/Research 夹具补入与实际输入匹配的覆盖证明；账户流程从手动开关改为默认执行的临时库测试，保留真实成交、实际成交修改与两条账户曲线断言。
- Research 数据集测试改用真实完整 schema；按新准入语义补齐计算状态，并将财务指标和分红断言改为捕获版本可得时间；保留公告日及经济 ex_date。
- 市场气象测试不再把未成熟热度变化视为零。浏览器 fixture 复用真实聚合器及 registry，修正测试调用参数顺序后通过。

首次/中间失败均在相应测试修正后复验；最终联合运行 751 项全部通过，没有跳过失败或降低断言。前端产品行为仍为已批准的实现。

## 实际命令与结果

从仓库根执行，最终联合回归的固定参数清单已随记录保存：

```sh
pnpm --filter api exec node --conditions=development node_modules/vitest/vitest.mjs run $(cat docs/reports/unified-data-sync-verification-tests.txt) --maxWorkers=2 --reporter=dot
# 143 files / 751 tests passed
node --test scripts/deploy/bootstrap.test.mjs scripts/deploy/plan-deployment.test.mjs scripts/checks/check-backend-boundaries.test.mjs
# 57 passed
node --test scripts/e2e/run.test.mjs
# 8 passed
pnpm check:commit-message <approved-message-file>
# 3 checker tests and exact approved message passed
pnpm --filter @jixie/shared build
pnpm build
pnpm typecheck
pnpm exec eslint . --ignore-pattern '.venv/**' --max-warnings 0
pnpm format:check
# all passed
```

Research 数据集和 Python SDK 另外单独复验过 `run src/research/datasets src/research/sdk/python/sdk.test.ts --maxWorkers=2 --reporter=dot`：12 文件、47 项通过，之后已并入上述联合清单。新同步十文件及真实 Worker、迁移也分别通过，最终以联合运行消除分批计数歧义。

编译 CLI 使用 `tempfile.TemporaryDirectory` 创建独立 package 根，复制 API package.json、链接依赖，执行 `pnpm exec tsc --outDir <temp>/dist`。对编译入口在 `DATABASE_URL=invalid`、空 TUSHARE_TOKEN 和空 NODE_OPTIONS 下逐个启动真实 Node 进程：无参数、`--help`、`sync --help` 返回 0；非法日期、旧 daily、旧 --mode、位置日期返回 2，均显示统一 usage。检查 run-maintenance/canonicalize-stock-codes/scripts-sync/market-sync 编译入口不存在，临时编译目录自动删除。

浏览器命令（先使用已完成的 production build）：

```sh
pnpm --filter web exec vite preview --host 127.0.0.1 --port 49173 --strictPort
E2E_BASE=http://127.0.0.1:49173 node apps/web/e2e/maintenance-fallback.mjs
E2E_BASE=http://127.0.0.1:49173 E2E_MARKET_FIXTURE=1 node apps/web/e2e/market-state.mjs
```

两项均通过。前者验证 502 恢复、准备/错误不封站、局部等待、中英文、真实发布门禁及恢复；后者验证四维分组数量、前后周期、银行历史抽屉、季度和窄屏无横向溢出。它们属于浏览器回归，业务输入/计算由隔离后端集成验证覆盖。

本次截图：`apps/web/acceptance/maintenance-{service-unavailable,preparing-zh,preparing-en,candidate-error,publishing-en,service-recovered}.png` 及 `market-weather-{industry,history,scale,board,style,mobile}.png`。已实际检查中英文准备页及移动布局，交付时展示中英文截图。图片按仓库惯例保持 gitignored。

## 资源与提交范围

浏览器全部关闭，预览进程已终止，127.0.0.1:49173 无监听；最终进程检查无本次 Worker、Vitest、headless Chromium 或预览残留。隔离库与私有计算副本由测试 finally 释放/删除；真实 Worker 测试还断言进程消失和端口可复用。未调用真实供应商、邮件、券商、付费模型，没有修改工作数据库，也没有部署。

本次没有新增 workspace 或跨包构建依赖；既有部署路径映射覆盖 API/生成 stub，部署计划自测已通过。部署时应按既有流程应用这份已批准迁移，切换统一 `data sync` service/timer 并停用 weekly；真实库长历史同步及生产部署仍由用户另行执行。

按 Gate 1 原信息提交，未 push。用户/审阅者文件 `docs/reports/unified-data-sync-review.md`、`docs/reports/api-landscape-review.md` 和 `docs/design/maintenance-repair-scope-review.md` 保持原样、排除暂存；这些文件仍保留在用户工作区。最终 commit hash 通过交付消息和 Git 历史提供，避免把提交自身哈希写回自身。
