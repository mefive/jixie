# Ingestion 问题处理与数据状态

状态：2026-11-04 人工审阅和验证通过，工作库已迁移并补齐处理记录。提交信息：`feat(ingestion): track issue resolutions and expose data health`。

## 两种状态

`IngestionRun.status`／Batch／summary 保留采集时的执行与接纳结果。`IngestionIssue` 保留原始来源事实。新表 `IngestionIssueResolution` 记录随后的人类／Agent 处理，前端与诊断包共同使用。

不将行情补丁伪装成完整来源响应重新接纳，不因修复问题就把旧 partial 改为 succeeded。仅 warning 的 Run 可以是 completed，因此不能只扫描 completed_with_issues。

## 模型与幂等补齐

以 `issueId` 为主键及外键，状态为 pending、resolved、accepted。附带 reason、evidence、before、after、marketRevision、resolvedAt、创建／更新时间及 history；history 保存显式再次处理前的旧结论。before／after 格式为 `{ table, key, values }[]`，只核验声明的字段及唯一匹配行，不要求未来其他字段永久不变。

Run 结束时，在保存终态的同一事务内，按已保存计划与各逻辑单元最近尝试补齐缺失的 pending。被替代尝试和旧计划单元作为历史排除；无法确认有效性的诊断保留并单独提示，不能自动当成已修复。

`pnpm data issues reconcile [RUN_ID]` 是显式补齐入口。省略 ID 时检查已结束且有问题的 Run；包括 completed、completed_with_issues、failed、interrupted。仍运行或没有 finishedAt 时跳过。命令持维护者写锁，每 Run 独立事务，重复执行不更新已有记录的状态、证据或时间。无需额外常驻任务。同轮有诊断的逻辑单元保留成功收据，避免压缩后将已替代问题重新列为待办。

只读状态、详情及导出不会补写记录。未补齐的有效 Issue 暂按 pending 展示，同时报告 missingResolutionRecords，避免旧库或补齐遗漏让问题消失。

## 登记修复

后端 `ingestion/resolutions.ts:recordIssueResolution(transaction, input)` 接收维护者已经开启的 Prisma 写事务，不开放任意 SQL 执行器或前端改价按钮。

受控调用方须先在同一事务检查完整旧值及预期行数，执行已批准的业务补丁、递增 market revision，再调用登记入口；入口核对 Run 已结束、Issue 有效、实时 revision 与 after 的唯一业务行／字段。before 是调用方在写入前已核实的快照，入口不能在更新后重新证明旧值，因此不声称代替旧值保护。任何错误由调用方抛出并整体回滚。调用方仍须遵循备份、maintenance／publication 锁与消费者失效流程。

accepted 表示经过说明与证据确认保留现状，不冒充数据修改。已有终态处理需提供从新诊断包取得的 previousResolutionUpdatedAt，匹配后才能更新，并把旧结论加入 history；补齐命令永远不做这种修改。

读取 resolved 时，复用 Market 对受影响身份的显式 ORM 查询核对 after。字段被覆盖、目标行消失或无法完整核验时，当前展示重新成为 pending，并返回 changed／unknown；存储结论保持，供审计。不同于仅凭当前值碰巧相同自动推断修复，只有正式处理记录存在才会显示 resolved。

## 统一读取与前端

`issue-state.ts` 提供计划／最近尝试分类，`issue-overview.ts` 聚合当前处理进度。诊断包复用相同分类、处理核验与计数方法。新的干净 Run 不自动清空更早 Run 中仍有效的待办；跨 Run 的 Issue ID 分别计数，不冒充去重后的唯一业务问题数。

- `GET /api/ingestion/status` 继续提供可用性与维护状态，同时增加 health：最近 Run 的执行结果和处理统计，以及跨 Run 的 pending／resolved／accepted（分别计 error、warning）。不将来源问题用作全站读取资格。
- `GET /api/ingestion/issues?offset=0&limit=20` 需要登录，limit 1–100，只提供分页摘要、业务身份、处理理由与核验状态，详情不返回原始 payload 或内部故障内容。
- 顶栏可点击的数据状态打开抽屉，分别显示本次采集结果、全部运行当前处理进度及可展开的问题摘要；支持双语、窄屏、失败重试。只有实际发布锁争用／服务故障使用既有维护遮罩。

诊断包新增处理表实际结构、每项 resolution／handling 及 counts.handling；原 error／warning 与历史分类统计保持。仍保留当前有效诊断中的已处理记录供核验，Agent 按 handling.status 优先处理 pending。`runs` 保持之前约定的四字段与默认 5 条。

## 迁移与验证

只新增处理表、外键和索引，不改变现有市场表或原诊断；不新增依赖或公开 Research SDK。原有中文 Prompt 合理性标准调整一并保留。

Prisma 在隔离目录生成迁移 `20261104041114_ingestion_issue_resolution`，SQL 与审阅预览一致。隔离库验证保留原 Run、warning 与 payload，外键检查无错误。

- 根级 typecheck、后端依赖边界、Prisma 校验、ESLint、Prettier 和 diff 检查通过。7 个相关测试文件的 54 个测试、36 个边界自测及完整构建通过。
- Playwright 用模拟接口验证中文桌面与英文窄屏、待处理和已修复状态、详情按需加载、失败后重试。浏览器及临时服务已关闭。
- 工作库先用 SQLite 在线备份，备份位于 `apps/api/prisma/ingestion-backups/before-issue-resolution-epwbFl/dev-20261104-121409.db`。本地 API 持有连接时 Prisma 两次遇到锁，临时退出 API 子进程后，在维护锁及发布锁下应用迁移。原 watch 进程已恢复 API。
- 幂等补齐首次新增 31 条，第二次新增 0 条。目标为 `20181231` 的 Run 含 3 条待处理 error 和 8 条待处理 warning，另有 10 条历史错误仍按已替代尝试分类。其余 20 条来自更早的 Run，有效性待核对。实际 API 和 CLI 导出均已验证。
- 目标 Run 的 Run、Batch、Issue、相关 Daily／Dividend 行及 market revision 的迁移前后摘要一致。行情修复另行处理。
