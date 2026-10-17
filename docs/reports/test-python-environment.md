# 统一测试 Python 环境

提交信息：`fix(test): require the project Python environment`。

当前状态：人工代码审阅已确认；静态检查、行为测试与全部 workspace 构建通过，按固定信息提交。

## 行为

API 的 `test` / `test:watch`、直接加载 API Vitest 配置的运行，以及 sandboxd 的 Vitest 运行，都在收集测试之前
调用 `scripts/sandbox/test-python-environment.ts`。默认解释器从该模块所在仓库定位到
`.venv/research-py-v1/bin/python3`，不使用调用方的工作目录。

校验复用 `scripts/sandbox/python-environment.ts` 的 `packageValidation`，版本和包信息来自
`packages/shared/src/research-python-runtime.ts`：要求 CPython 3.13.x、所有固定包版本及对应导入均可用。
有效环境经 `JIXIE_PYTHON_EXECUTABLE` 提供给测试 Worker 和其子进程。显式覆盖必须通过同样的校验；空字符串
也属于错误。解释器缺失、不可执行、版本不匹配或依赖不匹配时直接失败，说明所选路径、要求及
`pnpm setup:sandbox` 修复方式；不会再尝试系统 Python、其他解释器或自动安装。

Python SDK 边界检查器自测通过 `pnpm test:python-sdk-boundaries` 使用相同初始化；独立环境回归命令为
`pnpm test:python-environment`。前者通过 `tsx` 加载 TypeScript 校验器。

API 中七处直接创建 Python 子进程的测试通过 `tests/python-environment.ts` 读取初始化结果；未初始化时明确报错。
两份 FCFF 测试移除自行拼接 cwd 路径和覆盖解释器的逻辑，保留各自本地沙盒开关及清理。

`.venv/` 仍为每台机器的本地环境，不入库。生产运行逻辑、开发启动器、Python 版本及依赖清单未改变，
不涉及数据库、公开 SDK、部署组件或跨包构建依赖。纯 TypeScript 测试也会执行入口校验；静态 typecheck 与
`setup:sandbox --check` 不执行此初始化、不要求本地 Python。

## 审阅入口

- `scripts/sandbox/test-python-environment.ts`：默认定位、显式覆盖、只读校验、错误与环境传递。
- `apps/api/vitest.config.ts`、`apps/sandboxd/vitest.config.ts`：收集前初始化及 Worker 环境。
- `apps/api/tests/python-environment.ts`：测试读取时禁止无初始化运行。
- `scripts/sandbox/test-python-environment.test.ts`：默认路径、cwd、覆盖、失败和真实入口回归。
- `scripts/checks/check-python-sdk-boundaries.test.mjs` 与根 `package.json`：Node 自测入口。
- `scripts/README.md`、根 `README.md`、`CLAUDE.md`：准备方式和失败策略。

`scripts/sandbox/tsconfig.json` 同时纳入两份 Vitest 配置，使根级 typecheck 校验其跨目录导入及配置类型。
新增 JSDoc 的中英文说明之间保留一个空段，中文不加语言前缀。

## 静态检查结果

- 相关 TS/MJS、JSON 的 Prettier 检查通过。
- 所有修改及新增 TS/MJS 的 ESLint 检查通过，0 错误、0 警告。
- `pnpm typecheck` 通过，含 sandbox 脚本、两份 Vitest 配置和全部 workspace。
- 后端边界：890 个文件、3,305 条运行时边、894 条类型边，0 违规。
- `pnpm setup:sandbox --check` 通过，生成物未变。
- 测试源码中系统 `python3` 回退与 FCFF cwd 路径覆盖已移除。
- `git diff --check` 通过。

## 人工审阅后的验证

人工审阅通过后已执行以下命令（均不设置解释器覆盖变量）：

```sh
pnpm test:python-environment
pnpm test:python-sdk-boundaries
node --import tsx --test scripts/sandbox/setup.test.ts
pnpm --filter api test src/math src/backtesting src/factor/sdk src/strategy/sdk src/research/sdk src/factor/sandbox/python/packaging.test.ts src/strategy/sandbox/python/packaging.test.ts src/research/sandbox/python/packaging.test.ts src/research/templates/fcff/valuation-template.test.ts src/research/templates/fcff/evidence-template.test.ts tests/sdk-adapters.test.ts
pnpm --filter sandboxd test
pnpm build
```

正常验证不设置 `JIXIE_PYTHON_EXECUTABLE`，以确认入口默认值本身有效。回归用例使用临时目录和 PATH 陷阱验证
默认环境缺失时不调用系统 Python、不创建环境、不安装依赖；对错误版本和包错误注入失败并核对没有第二次尝试；
真实启动两个应用的 Vitest，验证错误配置在收集前失败；实际 API Python SDK 用例在 PATH Python 不可用且无覆盖变量时仍应成功。
测试子进程均带超时；临时目录在用例结束时清理，sandboxd 既有测试负责关闭其监听和子进程。

实际结果：

- Python 环境回归 10 项、Python SDK 边界回归 5 项、sandbox setup 回归 14 项全部通过。
- API 38 个文件、227 项测试全部通过，覆盖计算、撮合、TS/Python SDK、打包和 FCFF 模板。
- sandboxd 生命周期 8 项全部通过；首次执行因工具沙箱禁止本地 Unix socket 监听而出现 `EPERM`，在允许监听的执行环境完整重跑通过，无代码调整。
- `pnpm typecheck` 与 `pnpm build` 全部通过；Vite 保留既有大分包及静态/动态混合导入提示。
- ESLint、Prettier、SDK 生成物一致性与 `git diff --check` 全部通过。
- 已确认测试子进程结束，无遗留服务；`.venv/` 不入库。

2026-10-17 用户已确认两项改动，验证通过后按固定信息提交，不推送。
