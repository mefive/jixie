# 策略工作台命名统一

2026-09-17：将前端 Lab 模块统一命名为 Strategy，对齐后端策略领域。属于现有策略能力维护，不新增业务能力。

## 范围与兼容

- 页面目录为 `apps/web/src/complex/strategy`，组件与 Store 为 `Strategy` / `StrategyStore`；CSS 与 i18n 使用 strategy 命名。
- 用户从「策略 / Strategy」导航进入 `/strategy`；站内策略跳转同步更新。
- 旧 `/lab` 使用 replace 重定向到 `/strategy`，保留 search 与 hash，鉴权前执行。
- 最近访问使用 `jx-strategy-recents`；仅新 key 不存在时读取并迁移 `jx-lab-recents`。写入成功后删除旧 key，写入失败仍返回旧记录；已有空列表优先，防止恢复用户已清除的记录。
- 同步现行帮助文案与 E2E 引用；保留帮助文章 URL 和历史记录。
- 策略、回测、扫描、部署业务、后端 API、数据库及 SDK 不变。

## 审查与验证记录

提交信息：`refactor(strategy): rename lab workbench to strategy`

- 范围：用户已批准。
- 静态检查：Web / Docs `tsc --noEmit`、受影响文件 ESLint 与 Prettier 检查、`git diff --check` 通过；运行时代码中旧名称仅保留兼容入口与测试。
- 人工代码审查：用户已批准。
- 审查后验证：`pnpm --filter web build`、`pnpm --filter docs build` 通过；`node --import tsx --test apps/web/src/complex/strategy/recents.test.ts` 4 项全部通过；`E2E_BASE=http://127.0.0.1:4178 node apps/web/e2e/strategy-navigation.mjs` 通过。
- 构建提示：产物体积提示及 embedded-analysis-card 混合静态/动态导入提示，无构建错误。
- 环境处理：tsx CLI 的 IPC 受沙箱限制，改用 Node 的 tsx import 入口执行同一测试；本机临时预览及浏览器获环境权限后运行。
- 浏览器验证采用隔离 API fixture，不运行真实回测、不写数据库；验证新旧地址、参数与 hash、旧记录迁移、打开策略、中英文导航，并生成截图。
- 截图：`apps/web/acceptance/strategy-navigation-zh.png`、`apps/web/acceptance/strategy-navigation-en.png`，已人工查看布局与双语导航。截图按仓库约定保留本地，不入库。
- 清理：浏览器已关闭，临时预览服务已停止；未启动 API 或数据库连接。
- 提交：全部必需验证通过，按已批准信息提交，不推送。
