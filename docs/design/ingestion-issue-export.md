# Ingestion 诊断导出与修复 CLI

修复 Agent 从一次 `issues export` 获得诊断、业务记录和同一份修复契约。Agent 写业务 JSON 计划并使用 CLI 预览，维护者审核证据和实际前后值。中文工作说明见 [修复 Agent Prompt](../prompts/ingestion-issue-repair.md)。

```bash
pnpm data runs --limit 1
pnpm data issues export RUN_ID --out /absolute/path/issues.json
pnpm data issues export RUN_ID --issue ISSUE_ID --out /absolute/path/one-issue.json
pnpm data issues repair --plan /absolute/path/repair.json
pnpm data issues repair --plan /absolute/path/repair.json --apply --expect-plan PLAN_HASH
```

`runs` 仅返回 id、status、startedAt、finishedAt，默认最近 5 条，limit 范围 1–100。导出保持只读一致快照，文件排他创建并设置 0600 权限。导出不暴露数据库 DDL、索引、外键、内部表名或内部业务行 ID。当前只有一个 JSON 契约。历史 Run、批次和问题按原样留存，导出按最近尝试分类。

`repairContract.plan` 的 JSON Schema 由 CLI 解析计划所使用的 Zod 定义生成。仅列出本次涉及数据集的业务操作与字段说明。单个 Issue 的 `context` 给出可用操作、可定位业务键、当前值、版本和可填模板。未接纳原始来源证据与已写入的业务值分别展示。旧问题的 resolution 表中审计数据仍留存，导出以处理摘要呈现。

业务写入支持 A 股股票日线和分红的 insert、update、delete。需要变更业务键时，以同一计划精确新增和删除。其他数据集可以经核查 accept 或 reopen，数据写入须有对应的领域校验实现。批次下载失败走采集入口。

预览会验证 Run 已结束、Issue 范围、字段和业务约束、目标存在性、旧版本及预期处理状态，并给出前后值和 `planHash`。摘要绑定当前库、修复内容、市场版本和问题处理版本。正式应用持维护锁，数据修改前生成备份，在发布锁保护下重新预备并验证，同事务提交业务数据、market revision 和处理记录。每份数据修复只递增一次 revision。纯 accept／reopen 不改 revision。数据库记录精确核验修复后的值或已删除的目标缺席。CLI 返回处理摘要和备份位置。相同的已应用计划且处理回执仍有效时，重试不再次执行。旧处理结论随重开进入历史。前端依旧读取统一的处理状态。

计划提交 `feat(ingestion): add issue repair CLI`。验证覆盖导出契约、CLI 参数与预览、应用与重复提交、跨 Issue 越界保护、事务回滚、分红补录、删除后缺席核验及重开历史。真实历史数据使用另行批准的计划。

## 验证记录（2026-11-04）

- 47 项相关测试、36 项后端边界自测、全工作区构建及静态检查通过。隔离 SQLite 验证了真实 CLI、旧版本拦截、越界拒绝、处理登记失败后的整份回滚、重复提交回执、分红补录、重开历史及删除后缺席核验。
- 对工作库目标 `20181231` 的 Run 只读验证了新版导出及分红 accept 预览。预览包含 3 次从 pending 到 accepted 的拟议状态变更及 0 条业务改动。工作库随后核对为 8 条已修复警告、3 条待处理错误，market revision 保持 34963。
