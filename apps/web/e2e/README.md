# 前端 e2e（Playwright 验收截图）

约定:**每次前端改动收尾都跑一遍这个流程,产出 `shots/*.png` 供验收。**

## 跑法

1. 起后端 + 前端(两个终端):
   ```bash
   NODE_ENV=development pnpm --filter api dev      # :3001
   pnpm --filter web dev --port 5173 --strictPort  # :5173
   ```
2. 首次装浏览器:`pnpm --filter web exec playwright install chromium`
3. 跑 e2e:
   ```bash
   pnpm --filter web test:e2e
   ```

截图落在 **`apps/web/acceptance/`**(gitignored,验收专用)。脚本走「dev 登录 → 选股看图 → 示例查询出表 → 点开个股 K线/PE/量 → 切回回测工作台」,每步截一张。

`E2E_BASE` 可覆盖前端地址(默认 `http://localhost:5173`)。
