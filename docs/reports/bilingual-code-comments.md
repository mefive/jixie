# 复杂流程与契约的中英文用途注释

本次修改为仓库中的复杂流程、计算方法和相关类型补充用途说明，供维护者在源码与编辑器中理解职责、调用边界和计算口径。提交信息固定为：

```text
docs(repo): document complex workflows and contracts in Chinese and English
```

当前状态：人工代码审阅已确认；静态检查、行为测试与全部 workspace 构建通过，按固定信息提交。

## 规范与范围

根 `CLAUDE.md` 的代码注释规则改为中英文双语，同时修正术语定义处的英文单语要求及多语言条款中的关联表述。标识符、LLM prompt、工具 description 和 few-shot 仍保持英文；用户界面文案仍使用原有 i18n。

TypeScript / TSX / MJS 在声明前使用双语 JSDoc，中文说明不加语言前缀，JSDoc 的中英文说明之间保留一个空段，供 Markdown hover 分段；保留已有英文细节、参数说明和链接。包装组件的注释放在外层声明前，不插进 `observer` 或 `complex.component` 参数中。Python 使用相邻中文、英文注释，不新增或翻译运行时 docstring。

本次只改变源码注释、相邻空行和项目说明。公开签名、算法、调用顺序、JSON、提示词、数据库、依赖、部署组件及构建依赖均保持原样；SDK 生成物没有变化。

## 扫描与覆盖

实施时对 800 个受版本控制的 TS / TSX / MJS 文件建立 AST 工作集，另扫描 23 个 Python 文件。排除生成声明、第三方框架副本、测试与 E2E 代码；不遍历数据库、研究产物或依赖目录。

初步筛选条件为函数至少 25 行、至少三个流程分支，或已有用途 JSDoc；数学函数另作检查。第二轮补查 12 行以上且至少两个分支、包含多步算术、多个异步步骤以及持有状态的构造函数。相关 interface、对象类型、协议联合和递归类型一并盘点。行数和分支只用于发现候选，具体说明按实现职责编写。

最终补充或扩展：

- TS / TSX / MJS：577 个文件，1,820 处函数、方法、构造函数或复杂回调，995 处 interface/type。
- Python：23 个文件，135 处类、协议或函数说明。
- 合计：600 个源码文件，2,950 处双语用途说明。

TS 工作集中的其余 138 个候选有明确排除原因：117 个简单类型别名或字面量联合、12 个简短局部算术回调、9 个测试契约或测试服务声明。未给简单 getter、单步接口转发或每个字段机械添加说明；原有英文行内注释没有全部改写。本记录的覆盖数量针对上述扫描工作集和筛选规则，不将机械筛选视作对自然语言准确性或所有潜在复杂度的证明。

| 范围 | TS 文件 | 函数/方法等 | interface/type |
| --- | ---: | ---: | ---: |
| API 工程命令 | 10 | 18 | 6 |
| Agent | 26 | 66 | 23 |
| Auth | 5 | 6 | 4 |
| 回测引擎 | 19 | 122 | 76 |
| Factor | 75 | 186 | 66 |
| Infra | 17 | 25 | 25 |
| Jobs | 5 | 9 | 7 |
| Maintenance | 13 | 27 | 17 |
| Market | 105 | 367 | 218 |
| Math | 3 | 47 | 6 |
| Research | 88 | 264 | 126 |
| Signals | 28 | 60 | 15 |
| Strategy | 46 | 124 | 37 |
| API 启动、日期、HTTP 装配与共享库查询 | 4 | 10 | 0 |
| Docs 应用 | 7 | 15 | 4 |
| Sandboxd | 2 | 16 | 7 |
| Web 应用 | 85 | 395 | 70 |
| Shared | 30 | 35 | 287 |
| 根工程脚本 | 9 | 28 | 1 |

重点解释的口径包括：复权与实际成交单位、T+1 冻结层、精确日期取价和跨停牌盯市、年化期数、HAC/OLS/排名计算、实际合约和连续收益、宏观抓取版本与可得日期、财报累计流量和单季/TTM、Job 计算与终态事务、沙盒所有权和取消清理、Research 依赖失效与不可变执行、提案应用和审阅、草稿保存及刷新重连。

## 审阅入口

- `CLAUDE.md`：新的双语注释规则。
- `apps/api/src/backtesting/cash-portfolio.ts`、`performance.ts`、`data/engine-data.ts`：交易与计算单位。
- `apps/api/src/math/stats.ts`、`inference.ts`：统计定义及边界。
- `apps/api/src/market/fundamentals/`、`macro/`、`cross-market/`：版本、PIT 与计价。
- `apps/api/src/jobs/job-service.ts`、`maintenance/workflows/daily.ts`：任务与发布生命周期。
- `apps/api/src/research/document-runs/run-document.ts`、`proposals/cell-changes.ts`：执行、依赖及审阅边界。
- `apps/api/src/research/sdk/python/valuation.py`：FCFF 与反向估值。
- `apps/web/src/complex/research/research-store.ts`、`complex/strategy/strategy-store.ts`：保存、运行与重连。
- `packages/shared/src/research.ts`、`factor.ts`、`sdk/research/contract.ts`：共享与公开契约用途。

## 静态检查

检查只解析或分析源码，不执行应用、启动服务或运行测试：

- 修改的 TS / TSX / MJS 文件执行 ESLint 与 Prettier 检查。
- `pnpm typecheck`：包含不运行自测的后端边界扫描、SDK 生成物一致性、sandbox 脚本与全部 workspace 类型检查。
- 将 577 个修改后的 TS / TSX / MJS 文件与改前 AST 比较：忽略注释、位置及格式产生的等价括号，保留节点种类、标识符、字面量和子节点顺序。
- 将 23 个 Python 文件与改前 AST 比较，保留原有 docstring 值，忽略源码位置。
- 对双语说明逐项检查是否含中文及英文段落，并运行 `git diff --check`。

最终静态检查结果：

| 检查 | 结果 |
| --- | --- |
| ESLint | 577 个修改文件，0 错误、0 警告 |
| Prettier | 577 个修改文件全部通过 |
| `pnpm typecheck` | shared、api、docs、sandboxd、web 及 sandbox 脚本全部通过 |
| 后端静态边界 | 889 个文件、3,300 条运行时边、894 条类型边，0 违规 |
| SDK 生成物一致性 | 全部为最新，无生成物变更 |
| TS / TSX / MJS AST 比较 | 577 个修改文件，0 差异 |
| Python AST 比较 | 23 个修改文件，0 差异，原 docstring 保持不变 |
| 双语结构检查 | 2,815 个 JSDoc、135 组 Python 注释，全部具备中英文说明 |
| `git diff --check` | 通过 |

人工审阅后已完成下述行为验证。

## 人工审阅后的验证

实际执行：

```sh
JIXIE_PYTHON_EXECUTABLE=/Users/liucong/Projects/jixie/.venv/research-py-v1/bin/python pnpm --filter api test src/math src/backtesting src/factor/sdk src/strategy/sdk src/research/sdk
node --import tsx --test scripts/sandbox/setup.test.ts
pnpm build
```

结果：

- 32 个 API 测试文件、211 项测试全部通过，覆盖计算、撮合与 TS/Python SDK。
- sandbox setup 的 14 项测试全部通过。
- `pnpm build` 成功构建 shared、sandboxd、api、docs 和 web。Vite 提示分包体积超过 500 kB，以及嵌入式分析卡片同时被静态和动态导入；没有构建错误。
- 首次 API 验证使用系统 Python 3.9，6 项沙盒测试因不支持 `match` 语法失败。改用仓库已有 Python 3.13.16 后完整重跑 211 项通过；未修改代码或测试来绕过问题。
- 验证后复查 577 个 TS/TSX/MJS 和 23 个 Python 文件 AST，均与改前一致。
- 未运行迁移、数据同步或 E2E 服务；测试子进程已结束。

2026-10-17 用户已确认代码审阅，验证通过后使用既定提交信息提交；不推送。


## 恢复 hover 段落分隔（2026-10-17）

用户确认恢复中英文说明之间的空段，提交信息为 `docs(repo): separate bilingual comment paragraphs`。
现有 577 个 TS / TSX / MJS 文件共 2,815 处双语 JSDoc 增加一行 ` *`，使 Markdown hover 分段显示。
保留去掉的中文语言前缀，Python 的相邻行注释保持原格式；根规范同步明确 JSDoc 段落规则。
并行审阅的 Python 测试环境改动中，3 个新增文件的 5 处 JSDoc 也采用此格式，随该改动提交。

对全部 580 个受影响源码文件逐字比对：移除 JSDoc 分隔行后与调整前完全相同，无表达式、字面量或调用顺序变化。
ESLint、Prettier、根级 typecheck、SDK 生成物一致性和 diff 检查均通过。
同批验证 API 227 项、sandboxd 8 项、环境与边界回归 29 项全部通过，全部 workspace 构建成功。
用户已确认两项改动，分别按各自既定信息提交；不推送。
