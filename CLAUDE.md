# 机械交易系 (jixie) — Claude Code 工作指南

境内 A 股量化研究平台。名字取自《机械交易系统》——"系"如门派,承载被动、机械、成体系的投资理念。愿景与进度见 `README.md`。

## 技术栈(变更前先讨论 trade-off)

- pnpm workspaces monorepo(Node 20+,纯 ESM),结构参照 `~/Projects/marginalia`、`~/Tools/fangtu`
- 后端 `apps/api`:**Hono + Prisma 6(不升 7)+ SQLite**;dev `tsx watch`,prod `tsc` + `node`
- 数据源:Tushare HTTP API(`http://api.tushare.pro`,POST + token),client 见 `apps/api/src/tushare`
- 前端 `apps/web`:React + Vite + Tailwind v4 + MobX「complex」架构(一页一 store)。**前端硬约定见 `apps/web/CLAUDE.md`**(具名 BEM class + `.css` 里 `@apply`、classnames、FontAwesome、echarts)
- 共享类型 `packages/shared`

## 数据 / 存储宗旨(本项目核心原则)

- **ORM 优先:能用 Prisma 就用 Prisma。** 行情、因子、回测结果……默认都建 Prisma model,享受迁移、类型安全、Prisma Studio 可视化。
- **只有实测性能扛不住,才下沉到 `$queryRaw` / 原生 SQL**,且只针对那一条热路径,不整体抛弃 ORM。判断依据是"真的测出来慢",不是"我觉得会慢"——避免过早优化。
- 批量写入用 Prisma `createMany`;按交易日「先 `deleteMany` 当日 + `createMany`」保证可重复同步幂等(SQLite 不支持 createMany 的 skipDuplicates)。
- **改市场数据表 schema(加列/加表/改语义)必须同步 `apps/api/src/agent/tools/read-only-sql.ts` 的 `SQL_TABLE_DOCS`**——它既是 agent 只读 SQL 的表白名单,也是喂给模型的 schema 说明书(列名/单位/PIT 规则),是 schema.prisma 的手工镜像,漏更新 = 模型查不到新数据或拿错单位。新表若含用户数据则**绝不能**进白名单。

## 目录约定(对齐 fangtu)

- `apps/api` — Hono 后端 + `prisma/schema.prisma` + 领域逻辑(`src/tushare`、`src/store`,未来 `src/factor`、`src/backtest`)+ 研究 / 导入脚本(`scripts/`,wired 成 `smoke` / `sync` / `peek` 等)
- `apps/web` — 前端(二期)
- `packages/shared` — 共享类型;依赖方向 `apps/* → packages/*`,反向禁止
- `packages/shared` 编译到 `dist`(后端/前端依赖其类型),改完类型需 `pnpm --filter @jixie/shared build`(install 时 `prepare` 也会自动构建)

## 代码约定

- **ESM 相对导入必须带 `.js` 后缀**(即使源是 `.ts`)
- 跨包用包名 `@jixie/shared`;`@prisma/client` 是 CJS,用 `import pkg from '@prisma/client'; const { PrismaClient } = pkg;`(见 `src/lib/prisma.ts`)
- ID 用 ULID,应用层生成;zod 做入参校验
- **代码注释一律用英文**(inline `//`、块注释、JSDoc、Prisma `///`、CSS `/* */`)——维护者可能不识中文,注释不留中文括注,用标准英文财经术语。例外(仍/可中文):**LLM prompt / 工具 description / few-shot 示例**(刻意保持中文,见 i18n 详设)、**i18n 资源里的 zh 值**、**CLAUDE.md / README 文档**、**commit message**。**面向用户的 UI/报错文案走 i18n**(英文 key,zh+en 值),不再硬编码——详见 `docs/design/i18n.md` 与下「多语言」条
- 格式化:prettier(`semi`、`singleQuote`、`printWidth 100`、`trailingComma all`)+ eslint `curly: all`(控制语句强制大括号,`if (x) return;` 会被拆成带 `{}` 的多行)。**pre-commit hook**(simple-git-hooks + lint-staged)提交时自动对暂存文件跑 `eslint --fix` + `prettier --write`,机械格式无需手动维护;`.prettierignore` 里 `*.md` 等文档不受 prettier 摆布
- **空行分段(工具做不到,唯一靠人/agent 的格式)**:函数体内按逻辑段落用**单空行**分组 —— 入参校验 → 数据准备 → 主循环 → 收尾/return;注释引导的新段落,注释前空一行。函数首行前 / 末行后不空;紧密相关的连续单行不硬插;不留连续空行(prettier 会压成一行)。写的时候主动分段,别挤成一坨
- **命名一律语义全称**(代码是给人看的,没必要省):变量/参数、回调 / reduce / map-item / 临时变量都要有语义(`(sum, close)` 不是 `(a, b)`、`.map((code) => …)` 不是 `(c)`);金融/领域术语在定义处加简短英文注释,用标准英文财经术语(`ATR`/`EMA`/Donchian channel / after-adjustment price),不括注中文。领域惯例短名优先展开成全称(`predicate`/`fraction`/`direction`);纯数组下标 `for (let i …)` 可留
- 不为「未来可能复用」提前抽象:三处相似 < 一处错误抽象

## 多语言(i18n,中英双语)

产品支持中文 / 英文,**详设与执行计划见 `docs/design/i18n.md`**。几条不能违背的红线:

- **面向用户的字符串走 i18n,不硬编码**:前端过 react-i18next(`apps/web/src/i18n`,一页一命名空间,zh 是形状真相源、en 用 `typeof` 约束);后端过消息目录(`apps/api/src/i18n`,`t(localeFromRequest(c), key)`)。
- **LLM prompt / 工具 description / few-shot 示例永远中文,绝不抽成 i18n key**——中文是刻意选择(A 股数据 + 中文模型)。这是需求 1(UI i18n)与需求 2(prompt 中文)的边界,别搞混。
- **LLM 回复跟随用户提问语言**(英文提问→英文回答),靠 prompt 末尾一句中文指令实现,不给模型传 locale。
- `Locale = 'zh' | 'en'` 在 `@jixie/shared`;前端 `localeStore` 单例是唯一切换入口,api client 每请求带 `Accept-Language`。
- 切表/加因子时,面向用户的中文 label 用 i18n 显示层映射;**DB 存的规范名保持中文不迁移**(它也是 LLM 上下文)。

## Prisma 已知坑

- `DATABASE_URL` 里的相对路径是相对 `schema.prisma` 解析(不是 cwd):`file:./dev.db` 实际生成在 `apps/api/prisma/dev.db`
- Prisma 7 破坏性变更(移除 `datasource.url`),留在 6.x

## A 股回测必须内置的规则(写回测时别漏)

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
- 先理解再动手:选型 / 加依赖 / 改架构先讲清 trade-off;不熟的概念讲 why,不只讲 what
