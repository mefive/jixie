# Maintenance 与市场数据业务归属整理

日期：2026-09-18。用户已确认完整业务归属调整；产品代码已实现并经人工代码审查确认；静态检查、行为验证和构建全部通过。

提交信息：`refactor(maintenance): move market data operations into business modules`

## 交付与边界

Maintenance 保留日／周／修复编排、任务等待、生产锁、运行和 checkpoint、修复前失效记录、水位和 dataRevision、HTTP 门禁与跨业务审计。流程归 workflows，运行管理与公共协调归 runs，发布检查、审计、部署版本与水位归 publication；CLI 与 HTTP 各自保留独立适配入口。公共协调从 daily 提取到 runs/coordination，水位事务从运行 state 提取到 publication/watermark，避免以日维护作为基础能力，不保留旧路径转发文件。

Market fundamentals 接收历史导入、财报 Worker 链和数据审计；财报 CLI 迁至 market/cli。股票、指数、证券身份、宏观、跨市场、利率、ETF、商品审计归各自领域；共享质量结果与覆盖摘要归 market/quality。股票／指数查缺及修复、原始质量、派生质量、ETF 全历史补齐、日历读取、指数成员变更起点与商品持仓前置同步也归相应业务。

维护模块不再实现具体 SQL 审计、数据覆盖阈值或市场表修复规则。整体审计仍按原顺序组成原有 finding，风险模型历史要求由 Strategy 提供，Market 不反向依赖 Maintenance 或 Strategy。

现有 CLI 名称、参数、HTTP、SDK、数据库模型、系统服务及锁不变；不增加 workspace 或跨包构建依赖，不需要 schema migration。历史导入环境变量保持兼容。没有新增通用调度器、Job 类型或总服务层。

## 恢复与进程契约

财报 Worker 仅接收阶段和项目，不接收维护运行 ID；数据落库后通过 IPC 报告单项完成。父进程等待调用方 onItemComplete 返回，确认成功后 Worker 才处理下一项。周维护在回调内写原 MaintenanceCheckpoint；普通导入不写维护表。任何回调／IPC／子进程异常均失败，父进程在关闭子进程后才结束批次；完整 summary 和正常退出不能代替逐项完成确认。父进程消失时 Worker 退出，避免遗留执行进程。

ETF recovery 保持原 scope 指纹、no-daily / no-share / revision key 和全历史复查，通过调用方回调读写当前运行的恢复记录；新运行不复用上轮来源缺失观察。股票／指数修复前的 derived-invalidation 仍由 Maintenance 写入，数据业务不推进发布水位。

## 验证与审查

静态阶段：全仓类型检查（含 SDK 一致性和静态依赖边界）、受影响代码 ESLint / Prettier、diff 与旧路径检查。

人工代码审查后：Maintenance 回归、所有迁移后的领域审计／质量／修复与财报导入测试、边界检查器自测、CLI／别名契约；新增真实本地 provider + 临时 SQLite 的财报 IPC 测试，验证成功退出及 checkpoint 失败后不继续。补充 ETF 同轮缺失缓存／新轮重试、持久化失败、发布质量阈值与公共任务安静窗口回归。构建 shared/API，并在源码与编译模式核对 Worker 和 CLI 入口。只使用本地替身及临时数据库，测试完成关闭进程、监听和连接。

- 静态检查：目录组织完成后，`pnpm typecheck` 全部 workspace 通过；后端 766 个文件，2860 条运行时边和 673 条类型边，0 违规，SDK 生成物一致。受影响代码 ESLint、Prettier 与 diff 检查通过。35 个原审计函数体经静态语法 token 比对保持不变；仅总报告组合和拆分股票／行业计数的函数改变。
- 人工代码审查：用户已确认业务归属与 Maintenance 子目录调整，授权验证并提交。
- 行为验证与构建：Maintenance、Market 与 API CLI／别名／错误契约共 76 个测试文件、370 个用例全部通过；边界检查器 28 个自测通过，扫描 0 违规。shared 与 API 构建通过。真实 Worker 在源码和编译模式各验证成功确认与 checkpoint 失败退出；编译后 maintenance 和 fina CLI 均验证无效参数退出，生产别名在主进程与 Worker 中实际加载通过。
- 测试修正：临时 SQLite 显式创建空文件；真实 Worker 用临时 runner 文件启动，避免 eval 启动参数被子进程继承。默认运行源码测试，构建后设置 `JIXIE_TEST_COMPILED=1` 额外验证编译模式。本机 HTTP fixture 因 sandbox 监听限制使用授权的环境运行；临时数据库、监听与进程已清理。修正后 API 类型检查与测试文件 ESLint / Prettier 通过。
- Git：全部检查通过后按上述信息提交；不推送。
