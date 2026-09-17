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
3. 跑 e2e:
   ```bash
   pnpm --filter web test:e2e
   pnpm --filter web test:e2e:strategy-indicators # 五指标策略真实回测 + Strategy 验收截图
   pnpm --filter web test:e2e:factor-panel-composite # 含 Phase 5 多资产风险研究真实回测
   pnpm --filter docs test:e2e
   ```

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
node apps/web/e2e/factor-questions.mjs
```

截图输出 `factor-questions-report-{zh,en}.png` 与 `factor-questions-compare-{zh,en}.png`，日志为
`factor-questions-server.log`，均位于 `apps/web/acceptance/`。报告是完整且内部一致的合成样本，不代表真实因子收益；
本测试验证已有报告的问答链路，不验证报告计算、真实模型的分析质量或尚未接入的嵌入式 Python Cell。

`factor-question-recovery.mjs` 是单独的**前端恢复回归**，通过 HTTP/SSE 夹具覆盖进行中刷新、报告来源/仅定义、
切换因子、供应商失败后重试、取消、连接丢失、提交响应丢失、历史分页及创作响应迟到。9 个场景独立重置，
失败时输出诊断截图，不再用边界场景截图充当主流程验收。启动 Web 后运行：

```bash
E2E_BASE=http://localhost:5173 node apps/web/e2e/factor-question-recovery.mjs
```

上述两类浏览器检查不能彼此替代；报告归属、Holdout、并发、迁移等后端边界仍由
`apps/api/src/factor/questions/*.integration.test.ts` 验证。后续嵌入式分析接入还需单独验收
“选择来源 → 生成 Python → 实际执行 → 查看输出/代码/版本 → 继续到 Research”的用户任务，不能用本轮问答测试代替。

策略命名兼容回归（本地 Web 服务即可，API 使用隔离 fixture，不写数据库）：

```sh
node apps/web/e2e/strategy-navigation.mjs
node --import tsx --test apps/web/src/complex/strategy/recents.test.ts
```
