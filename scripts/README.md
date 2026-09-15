# 仓库脚本索引

本目录负责仓库开发环境、跨包生成、工程检查和部署编排。API 的数据同步、审计、探针、维护及研究命令见 [API 脚本索引](../apps/api/scripts/README.md)；业务实现放在 `apps/api/src/`，操作系统服务配置放在 `deploy/`。

优先在仓库根目录使用 `pnpm` 命令；股票价格同步使用 `pnpm sync:stock-prices [start] [end]`；原 `sync` 命令已移除，其余命令名保持。只有 `bootstrap.sh` 保留根级位置，它是文档约定的部署入口，并支持单文件上传到新服务器后初始化仓库。

| 目录 / 入口 | 内容 | 常用入口 |
| --- | --- | --- |
| [dev/](dev/) | 多服务启动、进程组清理、Python 环境安装及清理测试 | `pnpm dev`、`pnpm setup:research-python`、`pnpm test:dev-shutdown` |
| [generators/](generators/) | 从 shared 契约生成 Research / Factor Python 类型声明与运行时依赖清单 | `pnpm gen:research-sdk`、`pnpm gen:factor-sdk`、`pnpm gen:research-runtime`；对应 `check:*` 检查一致性 |
| [checks/](checks/) | 后端依赖边界检查及规则、提交信息检查、各自测试 | `pnpm check:backend-boundaries`、`pnpm test:backend-boundaries`、`pnpm check:commit-message`、`pnpm test:commit-message` |
| [bootstrap.sh](bootstrap.sh) | 安装、构建、迁移、部署和服务配置 | `./scripts/bootstrap.sh` |
| [deploy/](deploy/) | 部署影响分类及测试、部署维护门禁、维护 timer 激活 | 由 bootstrap 调用；测试：`node --test scripts/deploy/plan-deployment.test.mjs` |
| [maintenance/](maintenance/) | 生产维护锁、按步骤与年份执行可续跑的批量导入 | `pnpm maintenance ...`、`pnpm import:data ...` |
| [tools/](tools/) | Git hook 的 pnpm 环境校验、代码量统计 | hook 自动调用 `run-pnpm.sh`；`pnpm loc` |

## 调用边界

- 根级 `pnpm import:data` 获取维护锁，再由导入脚本编排 API 的 `sync:*`、修复和审计命令；具体数据处理仍归 API。
- 根级 `pnpm maintenance` 加锁后调用 API 维护 CLI。维护锁在生产环境启用，本地开发直接执行目标命令。
- `.pyi` 是静态类型声明，Python 执行不依赖它。API 使用 shared 中相同的生成函数为 Pyright 生成临时声明，前端获得补全和诊断结果；requirements 清单用于 Docker 和本地 Python 环境。
- 部署门禁直接使用 SQLite，以便迁移期间不依赖可能不兼容的 Prisma Client。它仍属于部署职责。
- 测试和辅助模块与对应脚本放在同一目录；不把它们当成独立业务命令。

## 清理与新增规则

本次移除 API 的一次性 FCFF 文档创建脚本：固定三家公司及 2026-09-07 标题，交付已在研究报告中记录完成，无 pnpm / 生产调用。源码可从 Git 历史找回，研究模板和案例参数继续保留。

`canonicalize:stock-codes` 仍被批量导入调用，属于可重复执行的数据修复；Tushare 连接与能力探针仍供导入和 bootstrap 使用，继续保留。已完成的 M0 财报来源、M5 主营业务研究探针及专属测试已移除，历史结论与证据保留，财报版本 fixture 迁入 Market 业务测试目录。旧版批量因子分析命令 `factor:report` 已移除：它仅输出终端摘要，没有产品或生产调度调用；正式分析使用因子页面的报告流程，历史脚本可从 Git 历史查阅。

新增应用 CLI 优先放入 `apps/api/src/<所属模块>/cli/`；本目录继续承载工程和跨包编排脚本。仅因名称含 migration、repair 或 probe，或没有定时调用，不能认定已废弃；移除前需核对命令、部署、源码和文档调用，以及历史任务是否完成。已完成的一次性入口应删除并留下历史说明，不建立永久临时脚本目录。

未改变可部署 workspace 或跨包构建依赖，`deploy/component-impact.json` 现有 `scripts/` 前缀继续覆盖所有子目录并触发全量部署。已安装旧 Git hook 的开发者需运行 `pnpm exec simple-git-hooks` 刷新路径。历史设计和验收记录保留当时路径，当前命令以本索引及 package.json 为准。

## 本次整理验证记录

提交信息：`chore(repo): organize scripts and remove obsolete replay entry`。

方案与代码均已通过人工审查。审查前静态检查通过：全仓 typecheck、后端边界（0 violations）、SDK / Python 运行时生成物一致性、ESLint、Prettier、Shell 语法及 diff 检查。

审查后验证：4 个脚本测试文件共 36 项全部通过，包含新子目录的部署影响与开发进程组清理；shared 构建通过；部署计划 CLI 的 HEAD 对 HEAD 比较返回无部署，导入 CLI 的 `--help` 与 `pnpm loc` 正常执行。本地 Git hooks 已刷新为新路径。未运行生产部署、数据同步、数据库迁移或数据写入脚本，未启动常驻服务。

## 无引用代码与退役资源清理（2026-09-15）

提交信息：`chore(repo): remove unused code and retired assets`。已确认删除范围为 6 个无调用代码/样式及一次性交付验收文件、10 张未引用帮助截图，以及 Web package.json 中两个目标脚本已不存在的 Screen 测试命令。清理了 `walled-run.ts` 对已移除 `runCodeBacktest` 的注释引用；正式回测、资金流业务、历史图表重放、Worker、Python runtime、迁移和研究证据保留。

删除的源码/样式入口为 `market/registry/moneyflow.ts`、`strategy/runtime/typescript/run.ts`（API），以及 `i18n/format.ts`、`complex/screen/condition-chips.css`、`components/query-card.css`（Web）；一次性脚本为 `apps/web/e2e/research-fcff-delivery.mjs`。旧截图来自 getting-started、screening、market-valuation 和 signals，当前帮助文章及截图脚本无引用。无 API、schema、数据迁移或跨包构建依赖变更；旧图片直链不再由新构建提供。

范围与代码已通过人工审查。审查前检查全部通过：全仓类型与契约一致性、后端边界（683 个文件、0 违规）、改动文件格式及 ESLint、删除资源引用、API/Web/Docs 命令源文件路径和 diff 检查。审查后 API、Web、Docs 均构建至新建的独立临时目录并通过；Docs 产物确认不包含 10 张退役截图。Web/Docs 有大 chunk 提示，Web 另有 embedded-analysis-card 静态/动态导入混用提示，未阻止构建。未运行 E2E、已退役脚本或真实数据写入，未启动常驻服务。
