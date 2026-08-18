# 机械交易系 (jixie) — Claude Code 工作指南

个人多市场量化研究实验室。名字取自《机械交易系统》——"系"如门派,承载被动、机械、成体系的投资理念。愿景与进度见 `README.md`，学习范围见 `docs/learning-map.md`。

## 项目定位与当前优先级

- **当前第一目标是系统学习量化投资并构造分析工具**，不是尽快接入实盘。研究、回测、信号与账户能力都为理解和验证服务；模拟盘、实盘和券商执行保留为长期阶段，不能挤占当前学习与研究主线。
- **研究范围是多市场、多资产**：目标覆盖中国内地、香港、美国的股票、债券和商品。现有 A 股 / ETF / 股指期货能力是已经落地的第一块，不是产品永久边界。
- **量化证据优先**：结论必须来自明确假设、可追溯数据、可复现计算和恰当统计检验，不把宏观叙事、图形直觉或 LLM 判断直接当成投资结论。
- **长期目标是可执行的风险调整收益**：寻找并验证能在真实成本和严格样本外约束下保持费后正收益、且 Sharpe / Calmar 良好的策略组合；不能把样本内最大化 Sharpe / Calmar 当成成功标准。
- **学习范围可以广，正式产品表面必须收敛**：一个知识主题先用文献笔记、Agent 对话、只读 SQL、沙盒计算、脚本或研究报告复现；只有反复使用且需要稳定契约的工作流才进入正式页面、共享类型或持久化模型。

### 探索、验证与执行三层

- **探索层**：Research 页面演进为 jixie 原生的响应式量化研究文档，统一承载 Markdown / Python /
  Validation Cell、Agent、平台数据和图表；复用现有只读 SQL、`analyzeData`、计算图卡片、Python 沙箱与
  `ResearchRun`，不引入 Jupyter，也不建设一套与 Research 平行的 Notebook 产品。上游变化必须使下游
  输出显式 stale，正式固化须在干净环境完整执行。
- **验证层**：FactorReport、代码快照、PIT、holdout、稳健统计、真实成本和数据截止日负责把探索结论变成可复查证据。
- **执行层**：策略回测、每日信号和账户对账保留窄而稳定；当前不以扩券商、自动下单或实盘运营为建设重点。

公开帮助和中英双语是学习产品的核心能力，不是发布后的装饰：中文和英文使用者都应能从概念说明进入真实页面、完成操作并理解指标限制。新增或改变用户可见研究能力时，必须同步判断帮助内容、SDK 参考和双语文案是否需要更新。

## 业务 / 研究方法论参考

- 因子研究的项目内业务参考书是 `docs/books/因子投资方法与实践（石川、刘洋溢、连祥斌）.epub`。
- 已结合 jixie 现状提炼为 `docs/books/因子投资方法与实践-项目指导.md`。修改因子数据口径、分析报告、因子准入、多因子合成、风险模型或组合构造前,先读该指导及对应设计文档。
- 书中方法用于指导研究纪律,不是逐字需求。具体市场制度、费率和项目已拍板设计以当前代码、`ROADMAP.md`、`docs/design/` 为准;不要把书中截至 2019 年的 A 股规则、固定涨跌幅或零交易成本设定照搬到其他时期和市场。

## 技术栈(变更前先讨论 trade-off)

- pnpm workspaces monorepo(Node 20+,纯 ESM),结构参照 `~/Projects/marginalia`、`~/Tools/fangtu`
- 后端 `apps/api`:**Hono + Prisma 6(不升 7)+ SQLite**;dev `tsx watch`,prod `tsc` + `node`
- 当前主要数据源:Tushare HTTP API(`http://api.tushare.pro`,POST + token),client 见 `apps/api/src/tushare`；扩展香港、美国或新资产时按数据许可、PIT 能力和可审计性单独选源，不假设 Tushare 能覆盖全部目标
- 前端 `apps/web`(登录与工作台)和 `apps/docs`(公开文档):React + Vite + Tailwind v4 + MobX「complex」架构(一页一 store)。**两个应用都遵循 `apps/web/CLAUDE.md` 的前端硬约定**(具名 BEM class + `.css` 里 `@apply`、classnames、FontAwesome、echarts)
- 共享类型 `packages/shared`

## 数据 / 存储宗旨(本项目核心原则)

- **ORM 优先:能用 Prisma 就用 Prisma。** 行情、因子、回测结果……默认都建 Prisma model,享受迁移、类型安全、Prisma Studio 可视化。
- **只有实测性能扛不住,才下沉到 `$queryRaw` / 原生 SQL**,且只针对那一条热路径,不整体抛弃 ORM。判断依据是"真的测出来慢",不是"我觉得会慢"——避免过早优化。
- 批量写入用 Prisma `createMany`;按交易日「先 `deleteMany` 当日 + `createMany`」保证可重复同步幂等(SQLite 不支持 createMany 的 skipDuplicates)。
- **改市场数据表 schema(加列/加表/改语义)必须同步 `apps/api/src/agent/tools/read-only-sql.ts` 的 `SQL_TABLE_DOCS`**——它既是 agent 只读 SQL 的表白名单,也是喂给模型的 schema 说明书(列名/单位/PIT 规则),是 schema.prisma 的手工镜像,漏更新 = 模型查不到新数据或拿错单位。新表若含用户数据则**绝不能**进白名单。
- **跨市场数据不能只靠代码字符串区分**：证券身份、交易所、市场时区、交易日历、交易币种、报价币种、公司行动、退市状态和数据 `availableDate` / vintage 必须有显式口径。收益比较必须说明本币或统一基准币及 FX 转换时点；缺少 PIT 历史时宁可标不可验证，不用今天的状态回填过去。

## Research SDK Contract 工作流

- **Prisma schema 是内部存储事实，不是 Python 公开 schema。** 禁止从 Prisma model 原样暴露或自动推断
  Research Runtime API；字段重命名、类型转换、指标选择、频率聚合和 PIT 语义必须经过显式服务映射。
- 修改 `apps/api/prisma/schema.prisma` 后，先判断是否改变公开 Research SDK。仅内部字段、索引、关系或 loader
  映射变化时，生成 Prisma migration、更新 loader / 映射和测试即可，不改 SDK Contract；若是市场数据表变化，
  仍必须同步上面的 `SQL_TABLE_DOCS`。
- 公开方法、参数、枚举或返回列变化时，唯一真相源是
  `packages/shared/src/research-sdk-contract.ts`；同时修改 Python runtime 实现和 API 映射，不得另写一份 Monaco
  schema。`apps/sandboxd/python/jixie_research_sdk.pyi` 是生成物，禁止手工编辑。
- 修改公开契约后运行 `pnpm gen:research-sdk`，再运行 `pnpm check:research-sdk`、`pnpm typecheck` 和相关测试。
  根级 `build` / `typecheck` 已把生成物一致性作为门禁；Git hook 只能提供本地快速反馈，不能作为正确性保证。
- `gen:research-sdk` 只从公开 Contract 生成派生产物，不读取 Prisma。Prisma → SDK 的业务映射需要人工决策；
  Contract → `.pyi`、Monaco 补全和 API 校验必须自动同步并由契约测试约束。

## 目录约定(对齐 fangtu)

- `apps/api` — Hono 后端 + `prisma/schema.prisma` + 领域逻辑(`src/tushare`、`src/store`,未来 `src/factor`、`src/backtest`)+ 研究 / 导入脚本(`scripts/`,wired 成 `smoke` / `sync` / `peek` 等)
- `apps/web` — 登录与工作台前端
- `apps/docs` — 独立公开文档前端，挂载 `/docs/help/*` 与 `/docs/sdk`
- `packages/shared` — 共享类型;依赖方向 `apps/* → packages/*`,反向禁止
- `packages/shared` 编译到 `dist`(后端/前端依赖其类型),改完类型需 `pnpm --filter @jixie/shared build`(install 时 `prepare` 也会自动构建)

## 代码约定

- **ESM 相对导入必须带 `.js` 后缀**(即使源是 `.ts`)
- 跨包用包名 `@jixie/shared`;`@prisma/client` 是 CJS,用 `import pkg from '@prisma/client'; const { PrismaClient } = pkg;`(见 `src/lib/prisma.ts`)
- ID 用 ULID,应用层生成;zod 做入参校验
- **代码注释一律用英文**(inline `//`、块注释、JSDoc、Prisma `///`、CSS `/* */`)——维护者可能不识中文,注释不留中文括注,用标准英文财经术语。例外(仍/可中文):**i18n 资源里的 zh 值**、**CLAUDE.md / README 文档**、**commit message**。**LLM prompt / 工具 description / few-shot 也一律英文**(见下「多语言」条)。**面向用户的 UI/报错文案走 i18n**(英文 key,zh+en 值),不再硬编码——详见 `docs/design/i18n.md` 与下「多语言」条
- 格式化:prettier(`semi`、`singleQuote`、`printWidth 100`、`trailingComma all`)+ eslint `curly: all`(控制语句强制大括号,`if (x) return;` 会被拆成带 `{}` 的多行)。**pre-commit hook**(simple-git-hooks + lint-staged)提交时自动对暂存文件跑 `eslint --fix` + `prettier --write`,机械格式无需手动维护;`.prettierignore` 里 `*.md` 等文档不受 prettier 摆布
- **空行分段(工具做不到,唯一靠人/agent 的格式)**:函数体内按逻辑段落用**单空行**分组 —— 入参校验 → 数据准备 → 主循环 → 收尾/return;注释引导的新段落,注释前空一行。函数首行前 / 末行后不空;紧密相关的连续单行不硬插;不留连续空行(prettier 会压成一行)。写的时候主动分段,别挤成一坨
- **对同一值的等值分支 ≥3 用 `switch`,不写 `if/else` 链**:TS 对可辨识联合(discriminated union)的 switch 能做穷尽检查,加新分支漏处理编译器会抓;纯「值→值」映射优先查表对象(`Record`),连 switch 都不用。条件异构(区间判断、复合谓词、不同变量)的 if/else 链不硬套 switch
- **命名一律语义全称**(代码是给人看的,没必要省):变量/参数、回调 / reduce / map-item / 临时变量都要有语义(`(sum, close)` 不是 `(a, b)`、`.map((code) => …)` 不是 `(c)`);金融/领域术语在定义处加简短英文注释,用标准英文财经术语(`ATR`/`EMA`/Donchian channel / after-adjustment price),不括注中文。领域惯例短名优先展开成全称(`predicate`/`fraction`/`direction`);纯数组下标 `for (let i …)` 可留
- 不为「未来可能复用」提前抽象:三处相似 < 一处错误抽象

## 多语言(i18n,中英双语)

产品支持中文 / 英文,**详设与执行计划见 `docs/design/i18n.md`**。几条不能违背的红线:

- **面向用户的字符串走 i18n,不硬编码**:前端过 react-i18next(`apps/web/src/i18n`,一页一命名空间,zh 是形状真相源、en 用 `typeof` 约束);后端过消息目录(`apps/api/src/i18n`,`t(localeFromRequest(c), key)`)。
- **LLM prompt / 工具 description / few-shot 示例一律英文,绝不抽成 i18n key**(和「代码全英文」一致;A 股专有名词用标准英文财经术语)。这是需求 1(UI i18n,值可切换)与需求 2(prompt 是静态英文串)的边界,别搞混。
- **LLM 回复跟随用户提问语言**(英文提问→英文回答),靠 prompt 里一句英文指令 `REPLY_LANGUAGE` 实现,不给模型传 locale;唯一按 locale 变的是命名助手生成的名称语言。
- `Locale = 'zh' | 'en'` 在 `@jixie/shared`;前端 `localeStore` 单例是唯一切换入口,api client 每请求带 `Accept-Language`。
- 切表/加因子时,面向用户的中文 label 用 i18n 显示层映射;**DB 存的规范名保持中文不迁移**(它也是 LLM 上下文)。

## Prisma 已知坑

- `DATABASE_URL` 里的相对路径是相对 `schema.prisma` 解析(不是 cwd):`file:./dev.db` 实际生成在 `apps/api/prisma/dev.db`
- Prisma 7 破坏性变更(移除 `datasource.url`),留在 6.x
- **Migration SQL 必须由 Prisma 生成,禁止手工修改已生成的 migration 文件**。修改 schema 后使用 `prisma migrate dev` 生成新的 migration;如果发现历史 migration checksum 漂移,先备份并审计数据库状态,通过修复迁移元数据解决,不要改写历史 SQL。

## 市场规则与 A 股回测基线

跨市场研究不得默认复用 A 股规则。香港、美国、债券、商品和不同基金品种必须分别确认结算、交易单位、
涨跌幅、卖空、税费、交易时段、公司行动、期货换月和币种口径；尚未建模的规则必须显式限制研究范围，
不能静默按 A 股处理。

A 股回测必须内置以下规则(写回测时别漏):

- 复权:回测价格用 `close × adj_factor`(后复权),消除除权除息假跳空
- T+1:当日买入,次日才能卖
- 涨跌停:涨停不可买、跌停不可卖
- 停牌 / ST:停牌日不可成交;ST 按策略决定是否剔除
- 成本:佣金(双边约万 2.5,最低 5 元)+ 印花税(**仅卖出**千 0.5)+ 过户费

## 回测 CPU 密集(二期注意)

回测是纯计算,会阻塞 Node 事件循环。二期多用户时,回测放 worker 线程 / 进程(指向 `apps/api/src/backtest`),HTTP 主线程只派活收结果。长任务用「同步写库 → 返 jobId → 后台跑 → 订阅进度」模式(参照 marginalia)。

## 协作风格

- **本项目授权自动执行**:pnpm、Prisma(migrate dev / generate / db push / studio)、typecheck / 测试 / 构建 / 跑脚本 —— 判断安全的直接执行并汇报
- **Git**:`git commit` 准备好(含 message)后**先确认,用户点头才执行**;`git push` **一律用户手动,我不代跑**
- 仍先确认:`rm -rf`、force push、`git reset --hard`、删库 / `prisma migrate reset`、对外发送
- **测试服务清理**:agent 为测试临时启动的 API / Web / dev server,验证结束后必须主动关闭,并确认监听端口和数据库连接已释放;不得把测试进程遗留给用户
- **E2E 截图交付**:完成涉及 E2E 的任务后,不仅要运行并检查验收截图,还必须在最终回复中直接展示本次 E2E 截图,不能只给文件路径或口头说明
- 先理解再动手:选型 / 加依赖 / 改架构先讲清 trade-off;不熟的概念讲 why,不只讲 what
