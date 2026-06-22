# apps/web — 前端协作约定

> 前端硬约定（来自 `complex-frontend` skill，本项目前缀 `jx-`）。全仓库通用约定见根 `CLAUDE.md`。
> `@src` 别名指向 `apps/web/src`（见 `vite.config.ts` 与 `tsconfig.json` paths）。

## 1. 架构：页面 = complex(MobX)

- `@src/lib` 是 antd-free 框架核心：`Complex` / `BaseStore` / `BaseModel` / `LoaderModel` /
  `ModalModel` / `reactUtils.observer` / `dataUtils`。**不要绕过它们另造**。
- 每个有独立 store 生命周期的页面 = 一个 **complex**，放 `src/complex/<page-name>/`，五件套：
  - `complex.ts` —— `new Complex({ name, storeClass })`
  - `<page>-store.ts` —— `extends BaseStore` + `makeObservable`；所有 `LoaderModel` 在 `setup()` 里
    `loader.setup({ request })` + `registCleaner(() => loader.cleanup())`，再触发加载。不在字段上
    `run(promise)`、不重写 `cleanup()` 手动清理。
  - `<page>.tsx` —— `complex.component(() => {...}, 'Page')`，`complex.useStore()` 取 store
  - `index.ts` —— `export default complex.entry(Component)`
- **请求统一走 `LoaderModel`**（读 `loading`/`loaded`/`error`/`result`），不在组件里散 `useState + fetch`。
  loading/error 直接读 `loader.loading`/`loader.error`，不在 store 上包薄 getter。
- **store 只放领域数据 + 业务流程**；**临时 UI 态**（下拉开关、输入草稿、hover 高亮）用组件 `useState`，不进 store。
- 全局单例 store（如 `authStore`）放 `src/store/`，module 级 `export const`，哪里用哪里 import，不进 React Context。
- 路由：`app-routes.tsx` 的 `ComplexRoute` 把 store 生命周期接进 react-router；`RequireAuth` 做未登录守卫。
  带参页面 `key={参数}` 触发重建；不该重建的参数变化走 store 方法，不走 setup。

## 2. 文件内组织顺序(硬规则)

- **主组件写在文件最前**；有 props 则 **props 类型紧贴其上、放 imports 之后最顶部**。
- **帮助函数、子组件、配置常量放主组件之后**，用 `// —— 子组件 / 帮助函数 ——` 分隔。
- store / 纯工具文件按各自结构；本规则只约束组件 `.tsx`。

## 3. 样式：具名 class + `@apply`(不在 JSX 堆工具类)

- **必须 `.css`，不能 `.less`**（Tailwind v4 + Vite 下 `.less` 的 `@apply` 不展开，会漏成死样式）。
- 组件旁同名 `<comp>.css`，`import` 之；顶部 `@reference '<相对>/styles/index.css'`。
- **三级 BEM `jx-{comp}-{element}`**，element camelCase（无第二个连字符）：`jx-resultList-cardBody`。
  状态变体平级 `jx-resultList-card--active`。
- **扁平不嵌套**：hover/focus 用 `@apply hover:..` 变体，不写 `&:hover`。
- `@apply` 按语义分组、一组一行：layout → box → visual → typography。
- **arbitrary / 一次性值写成 CSS 属性**（`height:44px;`、`letter-spacing:8px;`），不进 `@apply`。
- **SVG 用原生属性** `fill="var(--color-x)"`；单个动态语义色（涨跌 `text-up`/`text-down`）可保留工具类。
- 颜色 token 在 `src/styles/index.css` `@theme`。**A 股涨跌：红涨 `--color-up` / 绿跌 `--color-down`**。
- **数据图表用 ECharts**（`@src/components/echart` 的 `<EChart>` 壳，按需注册模块），页面里 `lazy` +
  `Suspense` 懒加载，echarts 独立 chunk 不进主包。canvas 取不到 CSS 变量 → 颜色落 hex。极简
  sparkline 才手绘 SVG，其余不自画 SVG。

## 4. 条件 className → `classnames`，多行展开

```tsx
className={
  classNames(
    'jx-card',
    {
      'jx-card--active': active,
    },
  )
}
```
静态单 class 直接写字符串；只有带条件才用 `classNames`。

## 5. 图标：FontAwesome

- UI 图标用 `@fortawesome/react-fontawesome` + `free-solid-svg-icons`，**不手写** `×`/`→` 等字符。
- **不自画 `<svg>` 图标**；唯一例外：数据图表（用 ECharts）。

## 6. 导入 / tsconfig

- 前端 Bundler 解析：**导入不带 `.js` 后缀**（与后端 Node-ESM 相反）。跨层用 `@src/...`，页面内就近相对。
- tsconfig：`strictNullChecks:false` + `useDefineForClassFields:true` + `paths {@src/*}`（框架依赖，勿改）。

## 7. 后端对接

- api 在 **localhost:3001**，vite proxy `/api` → 3001（同源，httpOnly session cookie 自动带）。
- 后端错误形态 `{ error: { code, message, details? } }`，前端 `@src/api/client` 的 `ApiError` 统一解析。
