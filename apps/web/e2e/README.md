# 前端 e2e（Playwright 验收截图）

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
   pnpm --filter web test:e2e:factor-panel-composite # 含 Phase 5 多资产风险研究真实回测
   pnpm --filter docs test:e2e
   ```

工作台截图落在 **`apps/web/acceptance/`**，文档截图落在
**`apps/docs/acceptance/`**（均 gitignored，验收专用）。工作台开发服务器会把 `/docs/*` 代理到
5174，因此 E2E 使用同一 origin 验证工作台与公开文档之间的跳转。

`E2E_BASE` 可覆盖前端地址(默认 `http://localhost:5173`);`E2E_NL=1` 打开需要 DEEPSEEK_API_KEY 的真 LLM 步骤,`E2E_BT=1` 打开真回测步骤。
