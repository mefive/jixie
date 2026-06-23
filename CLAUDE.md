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

## 目录约定(对齐 fangtu)

- `apps/api` — Hono 后端 + `prisma/schema.prisma` + 领域逻辑(`src/tushare`、`src/store`,未来 `src/factor`、`src/backtest`)+ 研究 / 导入脚本(`scripts/`,wired 成 `smoke` / `sync` / `peek` 等)
- `apps/web` — 前端(二期)
- `packages/shared` — 共享类型;依赖方向 `apps/* → packages/*`,反向禁止
- `packages/shared` 编译到 `dist`(后端/前端依赖其类型),改完类型需 `pnpm --filter @jixie/shared build`(install 时 `prepare` 也会自动构建)

## 代码约定

- **ESM 相对导入必须带 `.js` 后缀**(即使源是 `.ts`)
- 跨包用包名 `@jixie/shared`;`@prisma/client` 是 CJS,用 `import pkg from '@prisma/client'; const { PrismaClient } = pkg;`(见 `src/lib/prisma.ts`)
- ID 用 ULID,应用层生成;zod 做入参校验
- **代码注释一律用英文**(inline `//`、块注释、JSDoc、Prisma `///`、CSS `/* */`);但**面向用户的字符串**(console / 报错 / UI 文案 / 邮件模板 / 因子 label)、**CLAUDE.md / README 文档**、**commit message** 仍用中文
- 格式化:prettier(`semi`、`singleQuote`、`printWidth 100`、`trailingComma all`)
- 不为「未来可能复用」提前抽象:三处相似 < 一处错误抽象

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
