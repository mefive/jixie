# Sharing 后端阅读地图

Sharing 服务于公开库页面：聚合公开策略、已发布因子/组合以及当前用户可展示的资源，查看公开策略详情，并复制策略到自己的工作区。

| 入口 | 职责 |
| --- | --- |
| [routes.ts](routes.ts) | 根级 HTTP 入口，具名导出 `sharingRoute`，server 使用同名导入 挂载原 `/api/app/library`；保持三个既有端点 |
| [catalog.ts](catalog.ts) 的 `listSharingCatalog` | 聚合公开资源与自己的资源、作者显示及响应投影 |
| [catalog.ts](catalog.ts) 的 `getPublicStrategy` | 只读取公开策略详情，保持原响应字段 |
| [Strategy copy-public.ts](../strategy/definitions/copy-public.ts) 的 `copyPublicStrategy` | 检查公开源、生成当前用户唯一名称，复制配置并默认设为 private；由 Sharing HTTP 调用 |

复制是 Strategy 的业务操作，Sharing 不额外增加转发文件。目前没有 Sharing 因子/组合复制 endpoint，不预设尚未存在的操作。一次性聚合查询留在 catalog，不给每个 Prisma 查询建立包装层。

公开因子须为 published；公开组合还须有 key。当前用户的私有策略如果依赖自定义因子，仍按既有规则从 mine 列表过滤。作者显示保留名称优先、邮箱掩码回退。复制只带配置，不复制源策略的对话、报告、部署或任务；查询命名与创建的原事务边界不变。

新增 [routes.integration.test.ts](routes.integration.test.ts) 的 3 个独立 SQLite + Hono 场景，覆盖公开/私有与发布筛选、既有详情响应、拒绝复制非公开资源，以及同名复制后的所有权、private 默认值、空消息/结果与源记录不变。既有多用户权限测试继续从新路由入口运行。

Commit 10 已通过人工 review；本模块 3 项及全量 API 201 个文件/1083 项测试通过，Shared/API 构建与 Web 类型检查通过。根列表测试使用既有挂载路径 `/library`，不带尾斜杠。见 [开发计划](../../../../docs/design/backend-architecture-refactor.md#710-commit-10-实现记录2026-09-09)。

## 命名与数据库

共享响应类型位于 `packages/shared/src/sharing.ts`：`SharingCatalog`、`SharingAssetBase`、`SharingStrategy`、`SharingFactor`；前端通过 `fetchSharingCatalog` 读取，JSON 字段保持不变。`catalog.ts` 描述资源目录，`getPublicStrategy` / `copyPublicStrategy` 描述只允许公开源的操作，无需机械替换 public。

Prisma schema 与历史 migration 中没有 Library/Sharing 模型或表名。资源继续存放在 Strategy、Factor、FactorComposite，使用既有 visibility 字段区分 private/public，无需 schema 或数据库迁移。前端页面名、文案和 URL 保留公开库概念；Sharing 是后端业务模块及其代码接口的名称。
