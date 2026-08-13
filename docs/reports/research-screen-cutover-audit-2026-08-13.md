# Research / Screen 切换验收（2026-08-13）

## 结论

Research 已完成一次性正式切换并取代 Screen 一级入口。`UniverseSpec V1` 覆盖旧 Screen 的确定性筛选、排序
和结果字段；6 条旧记录均迁入 Research 并能使用新执行器重跑。Screen 页面、Agent profile、专属 API、共享
类型、旧表与旧外键列已在同一变更中删除，没有双写、旧 API 转发或兼容重定向。

## 当前数据清单

对本地开发库做只读检查：

| 对象 | 数量 | 处理要求 |
|---|---:|---|
| `SavedScreen` | 4 | 迁移为保存的 Universe |
| `ScreenConversation` | 2 | 迁移为 `surface=research` 的 Agent 对话 |
| `surface=screen` 的 `AgentConversation` | 2 | 与对应旧会话合并迁移，不能重复导入消息 |

4 个 SavedScreen 都是当前 schema 合法的简单最新截面筛选：3 个按总市值降序取前 10，1 个为股息率不低于
3%、PE(TTM) 低于 20 并按股息率降序取前 10。它们可以无损映射，但前提是新的 Universe 语义目录和执行器先
登记并实现下表字段。

## 旧字段到 Universe measure 的计划映射

| Screen 字段 | 新语义 ID | 单位/含义 |
|---|---|---|
| `close` | `equity.close` | CNY，指定时点收盘价 |
| `pctChg` | `equity.daily_return_pct` | %，当日简单收益 |
| `pe` | `equity.pe` | 倍，静态市盈率 |
| `peTtm` | `equity.pe_ttm` | 倍，滚动市盈率 |
| `pb` | `equity.pb` | 倍，市净率 |
| `ps` | `equity.ps` | 倍，市销率 |
| `dvRatio` | `equity.dividend_yield_pct` | %，股息率 |
| `totalMv` | `equity.total_market_cap_cny_10k` | 万元，总市值 |
| `circMv` | `equity.float_market_cap_cny_10k` | 万元，流通市值 |
| `turnoverRate` | `equity.turnover_rate_pct` | %，换手率 |

映射必须由迁移程序静态定义并逐条校验，不允许模型参与。迁移后保存的是 `UniverseSpec V1`，运行时不能继续
读取 `ScreenSpec`。

## 数据迁移实现状态

幂等命令 `pnpm --filter api migrate:screen-to-research` 已实现并接入 bootstrap：schema 升级前使用
`--finalize` 完成迁移、验证与旧 Agent 副本清理，升级后再次运行并在旧表不存在时安全 no-op。它不调用 LLM，
也不依赖旧 Prisma model：源表使用只读 raw SQL 检测和读取。

- SavedScreen 使用旧 ID 创建 Research 对话，并保存类型化的 `UniverseSpec V1` part；
- ScreenConversation 使用旧 ID 创建 Research 对话，query card 静态转换为 Universe part；
- 已有 Agent turn 移到 Research 对话，消息按 role、顺序和内容校验后复制，旧 Screen 在线期间不破坏源记录；
- 全部源数据先解析，随后在单一事务中迁移和复核，任一非法 spec、owner 冲突或消息分叉都会阻断部署；
- `--finalize` 只在目标校验通过且旧会话的 turn 已全部迁走后，删除旧 Agent 消息和会话；重复执行为 no-op；
- `--dry-run` 运行相同迁移与验收逻辑，最后回滚事务。

本地真实数据演练识别 2 个 ScreenConversation、4 个 SavedScreen、18 条旧消息和 3 个 turn。数据库副本第一次
执行创建 6 个 Research 对话和 22 条消息，第二次执行创建与追加均为 0。正式切换前 dry-run 预测清理 2 条旧
Agent 会话；正式执行也清理 2 条。Prisma migration `20260813112746_research_screen_cutover` 随后删除 4 条
SavedScreen、2 条 ScreenConversation、两张旧表和 `screenConversationId` 列。切换后 6 条 Research 记录完整，
`surface=screen` 数量为 0，迁移状态为 up to date。

## 已完成的切换范围

1. ✅ 补齐最终 `UniverseSpec V1`：结果字段、单位、历史可投资状态、停牌/风险警示、成分有效期、PIT 可得时间、
   missing/revision 规则和冻结成员快照。
2. ✅ 实现参数化 Universe 执行器，并让 Research Agent 通过正式工具使用它；Research Agent 仍不能获得
   SQL 或任意代码工具。
3. ✅ Universe part 已作为正式 Research 对话产物持久化，迁移提供完整 dry-run、事务回滚和结果校验。
4. ✅ 两套旧会话存储已完成去重迁移演练，消息顺序、query card 语义、turn 和 owner scope 均有断言。
5. ✅ 完成统一对象搜索与跨资产详情首批视图，使旧 `/stock/:code` 跳转有正式替代。
6. ✅ 在一次发布中替换导航和路由，删除 Screen 页面、profile、工具、API、共享类型与旧表；随后用全仓搜索和
   部署影响测试确认没有运行时引用残留。

## 切换验收断言

- ✅ 4/4 SavedScreen 能得到成员与排序一致的 Universe 结果；
- ✅ 2/2 旧会话只迁移一次，用户/助手消息数和顺序一致；
- ✅ 切换后的 Research 可以完成原低估值、高股息、规模和换手率筛选；
- ✅ `/screen`、Screen profile、`runScreen`、`ScreenSpec`、旧 CRUD 和数据库表在同一变更中消失；
- ✅ 不存在兼容重定向、双写或模型生成 SQL/JS 的替代入口。
