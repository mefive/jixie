# 前端 e2e（Playwright 验收截图）

E2E 从具体用户任务出发，验证用户通过界面完成任务及其结果。使用浏览器或生成截图本身不等于完成端到端验收。
刷新、断线、取消等异常应由测试设施注入，用户仍提出正常问题；不把“保存状态”“测试重连”等测试口令当作用户任务。
截图用于展示用户看到的任务结果，原始 JSON、占位答案或空报告不能替代主要产品验收。

约定:**每次前端改动收尾都跑一遍这个流程,产出 `shots/*.png` 供验收。**

## 跑法

1. 起后端、文档应用和工作台(三个终端):
   ```bash
   NODE_ENV=development pnpm --filter api dev      # :3001
   pnpm --filter docs dev --port 5174 --strictPort # :5174
   pnpm --filter web dev --port 5173 --strictPort  # :5173
   ```
2. 首次装浏览器:`pnpm --filter web exec playwright install chromium`
3. 从仓库根目录选择并运行任务（也可用 `pnpm -w e2e ...`）：
   ```bash
   pnpm e2e --list
   pnpm e2e research-executions
   pnpm e2e strategy-indicators
   pnpm e2e factor-panel-composite
   pnpm e2e docs-help
   pnpm e2e --group research --list # 只查看该组，不执行
   pnpm e2e --group learning       # 按原 learning-cases 顺序执行
   ```

统一入口和显式清单位于 `scripts/e2e/`；不按文件名自动发现任务，fixture/辅助代码不作为独立用例执行。
`pnpm e2e`、`--list` 和 `<任务> --help` 仅显示帮助，不启动浏览器。执行单项或显式分组时顺序运行，首个失败即停，
保留退出码并汇总通过/未运行数量；中断会转发到子进程组并清理残留浏览器/服务。
旧的 Web/Docs `test:e2e*` package scripts 已移除，原默认 `test:e2e` 对应 `pnpm e2e research-executions`；
原 `test:e2e:learning-cases` 对应 `pnpm e2e --group learning`。其余原命令去掉 `test:e2e:` 前缀即为任务名。

### 运行条件与分组

- `research`、`factor`、`strategy`、`market`、`signals`、`learning`、`platform`：按用例启动 Web/API/sandboxd/Docs，并准备相应市场数据。部分任务会写测试数据、执行真实回测或调用模型；运行器不自动启动整套开发环境，也不修改已有环境开关。
- `docs`：`docs-help` 通过 Web 的 `/docs` 代理验证导航及登录；`research-financial-help` 直接访问 `E2E_DOCS_BASE`（默认 5174）。
- `isolated`：`factor-questions`、`embedded-analysis` 自行启动隔离 API/模型夹具，需要先构建 shared 和 Web；嵌入式分析还需要 Research Python runtime。
- `browser`：只需 Web 服务，使用 HTTP/SSE 夹具；这是前端回归检查，不替代完整业务链路验收。
- `report-deployments` 必须使用可丢弃的 API 数据库并设置 `E2E_ISOLATED_DB=1`，会保留报告/部署历史。
- `factor-sdk` 需要 Vite 开发服务和 API，验证三类 TS 因子的双语声明/提示与编辑器自动保存；创建的测试草稿在结束时删除。
  `factor-python` 验证 Python 默认创建、补全与真实分析报告，需要足够的历史股票数据；建议使用可丢弃数据库。

### 帮助图片生成

帮助图片生成从 E2E 命令族中分离；原脚本和已有图片保留，执行会覆盖对应文档图片。

```bash
pnpm docs:images --list
pnpm docs:images backtest          # 操作真实页面并生成标注图
pnpm docs:images stage-l           # 给已有验收图加标注
pnpm docs:images --group annotate --list
```

`capture` 组需要浏览器及对应服务/数据，部分脚本会运行真实计算或模型调用；`annotate` 组的 `latest`、`stage-l`、`stage-m`
读取 `apps/web/acceptance/` 已有图片，沿用脚本的 ImageMagick 要求（`/opt/homebrew/bin/magick`），不执行产品验收。
原 `help-content` 对应 `getting-started`，其他名称去掉 `test:e2e:help-content-` 前缀。
新增用例或图片任务只修改 `scripts/e2e/commands.mjs`，在 `notes` 中说明特殊运行条件；保留相应 app 工作目录及 Node 参数。

工作台截图落在 **`apps/web/acceptance/`**，文档截图落在
**`apps/docs/acceptance/`**（均 gitignored，验收专用）。工作台开发服务器会把 `/docs/*` 代理到
5174，因此 E2E 使用同一 origin 验证工作台与公开文档之间的跳转。

`E2E_BASE` 可覆盖前端地址(默认 `http://localhost:5173`);`E2E_NL=1` 打开需要 DEEPSEEK_API_KEY 的真 LLM 步骤,`E2E_BT=1` 打开真回测步骤。

## 因子报告问答：完整用户任务与恢复回归

`factor-questions.mjs` 验证已经登录的用户打开一份因子报告、提问理解 Rank IC、刷新后继续阅读，再打开另一份报告追问比较。
操作从页面进入报告历史和聊天框，检查可见的报告数值、回答内容及范围限制；来源详情默认折叠，需要核对时才展开。
第二次回答期间刷新，由外部模型夹具延迟响应，以验证刷新后恢复的是同一轮回答。

本脚本自行启动 [测试服务器](../../api/tests/factor-questions-e2e-server.ts)，在独立临时 SQLite 库应用迁移，使用真实
Web、应用路由、会话鉴权、报告映射、Agent、SSE 和持久化。只把外部模型服务替换为本地受控服务；它校验模型实际收到的
报告/历史，并从收到的摘要产生确定的回复。完成后额外核对数据库里的两轮消息、来源及模型调用次数。
不加载开发 `.env`，不使用开发/生产数据库，不调用付费模型；服务、监听及临时库随脚本结束清理。

人工产品代码审查通过后，从仓库根目录执行：

```bash
pnpm --filter @jixie/shared build
pnpm --filter web build
pnpm e2e factor-questions
```

截图输出 `factor-questions-report-{zh,en}.png` 与 `factor-questions-compare-{zh,en}.png`，日志为
`factor-questions-server.log`，均位于 `apps/web/acceptance/`。报告是完整且内部一致的合成样本，不代表真实因子收益；
本测试验证已有报告的问答链路，不验证报告计算、真实模型的分析质量或尚未接入的嵌入式 Python Cell。

`factor-question-recovery.mjs` 是单独的**前端恢复回归**，通过 HTTP/SSE 夹具覆盖进行中刷新、报告来源/仅定义、
切换因子、供应商失败后重试、取消、连接丢失、提交响应丢失、历史分页及创作响应迟到。9 个场景独立重置，
失败时输出诊断截图，不再用边界场景截图充当主流程验收。启动 Web 后运行：

```bash
E2E_BASE=http://localhost:5173 pnpm e2e factor-question-recovery
```

上述两类浏览器检查不能彼此替代；报告归属、Holdout、并发、迁移等后端边界仍由
`apps/api/src/factor/questions/*.integration.test.ts` 验证。后续嵌入式分析接入还需单独验收
“选择来源 → 生成 Python → 实际执行 → 查看输出/代码/版本 → 继续到 Research”的用户任务，不能用本轮问答测试代替。

策略命名兼容回归（本地 Web 服务即可，API 使用隔离 fixture，不写数据库）：

```sh
pnpm e2e strategy-navigation
node --import tsx --test apps/web/src/complex/strategy/recents.test.ts
```
