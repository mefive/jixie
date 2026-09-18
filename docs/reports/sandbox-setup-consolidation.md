# 沙盒准备入口收敛

计划提交：`refactor(repo): unify sandbox setup and generated checks`。

## 已批准范围

用户确认将三个生成、三个检查及本地 Python 安装入口合成 `pnpm setup:sandbox`，名称覆盖用户脚本所需的 SDK 与执行环境。

- 默认：从 shared 契约逐项生成 Research / Factor Python 类型声明及 requirements；仅改写缺失或过期文件。
- 默认：检查 `.venv/research-py-v1` 的 CPython 版本、包的精确版本及所有导入；健康时跳过安装，首次创建虚拟环境，依赖不符时重装固定依赖并再次校验。
- `--check`：只比较三份生成物，汇总不一致文件并失败，不写文件、不运行 Python、不安装依赖。根级 build/typecheck 统一调用此模式。
- `--help`：只显示帮助。未知或组合参数在修改文件、检查环境前报错。
- 已有环境的解释器损坏或不兼容时保留目录并失败，提示移走旧目录后重试；不自动删除环境。仅管理项目默认环境，不修改 `JIXIE_PYTHON_EXECUTABLE` 指向的外部环境。
- 删除旧四个执行脚本及七个 package 注册；shared 的纯渲染函数继续保留。全项目注册从 66 个降为 60 个，根级从 32 个降为 26 个。
- 生成物仅更新头部入口提示，SDK 接口、依赖版本、数据库和 TS 构建流程不变。生产仍用容器提供 Python；不启动任何服务。
- 更新当前开发/设计文档和 dev 报错提示；历史验收记录保留当时命令。
- 未添加或重命名 workspace、未改变跨包构建依赖；部署映射既有 `scripts/` 前缀覆盖新目录，路径回归更新到新入口。

## 验证与交付

范围与代码审查均已获用户批准；验证通过，按约定提交，不推送。

审查前静态检查全部通过：全仓 typecheck（含后端边界 734 个文件、0 违规，以及新入口的生成物一致性检查）、入口独立 tsc、相关 ESLint/Prettier 和 diff 检查。

审查后验证全部通过：

- `node --import tsx --test scripts/sandbox/setup.test.ts scripts/deploy/plan-deployment.test.mjs`：23 项通过，覆盖首次配置、重复跳过、SDK 单独变化、依赖修复、错误传播、只读检查、CLI 参数、构建注册及部署路径回归。
- 实际连续执行两次 `pnpm setup:sandbox`：三份生成物均已同步，真实本地 Python 环境验证通过，两次均跳过安装。
- `pnpm setup:sandbox --check` 通过。
- `pnpm --filter @jixie/shared build` 通过。

安装分支用隔离 fixture 和模拟子进程验证，未重新下载或安装依赖；未运行全量产品 E2E，未启动常驻服务。

## 编辑器类型检查遗漏修复

修复提交：`fix(repo): declare sandbox Node types and include static checks`。

用户在提交后发现 `setup.ts` 的 Node 类型错误。已用本机 VS Code 自带 TypeScript 6.0.3 复现：
沙盒目录共 35 条诊断；原命令行 TypeScript 5.9.3 可通过，不能据此断言编辑器也无错误。
`@types/node` 已安装，问题是沙盒 tsconfig 依赖隐式类型发现，没有显式声明 Node 类型。

修复：在沙盒 tsconfig 添加 `types: ["node"]`；根级 typecheck 纳入 `tsc -p scripts/sandbox/tsconfig.json`，
避免独立入口只在本次人工验证中被检查。变更仅涉及静态验证配置，不改运行行为。
VS Code 自带 TypeScript 6.0.3 重新检查为 0 条诊断；JSON 格式与 diff 检查通过。
全仓复查发现本地 Prisma Client 类型缺失，已执行 `prisma generate` 恢复生成物，未运行数据库迁移。
恢复生成物后，根级 `pnpm typecheck` 全部通过，包含新增沙盒静态检查及所有 workspace；未修改依赖、schema 或业务实现。
