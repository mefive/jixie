# apps/web — 前端协作约定

> 前端硬约定（对齐 fangtu `apps/web`，本项目前缀 `jx-`）。全仓库通用约定见根 `CLAUDE.md`。
> 架构与组件库对齐 fangtu / marginalia：**antd 6 作组件库 + Tailwind 布局/样式**（二者共存），
> **不引 less**（自写组件样式走具名 class + `@apply`，见 §3；组件库/弹层选型见 §8）。
> `@src` 别名指向 `apps/web/src`（见 `vite.config.ts` 与 `tsconfig.json` paths）。

## 1. 架构：页面 = complex(MobX)

- `@src/lib` 是从 marginalia 拷来的 **antd-free 框架核心**（complex/store 生命周期本身不依赖 antd）：
  `Complex` / `BaseStore` / `BaseModel` / `LoaderModel` / `ModalModel` / `reactUtils.observer` /
  `dataUtils`。**不要绕过它们另造**。（交互原语 Select/Input/Button 等用 antd 6，见 §8。）
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

## 8. 组件库：antd 6（对齐 fangtu）

- **组件库 = antd 6**。`Select` / `Input` / `InputNumber` / `Button` / `Modal` / `Table` / `Tooltip`
  等**用 antd，不手写**。antd 是 cssinjs，**无需 import CSS**。
- `ConfigProvider` 在 `main.tsx` 顶层，主题 token 调**墨黑**（`colorPrimary/colorLink: #111827`、
  `colorLinkHover: #374151`、`borderRadius: 8`，借自 marginalia），**别露默认 antd 蓝**。
- 自写视觉（布局、卡片、图表）走 §3 的具名 class + `@apply`；**antd 组件的样式由 antd 自己管**，
  不去深改其内部 class。需让 antd 控件撑满容器时给个 `width:100%` 的 class（如 `jx-lab-control`）。
- antd 没有的（数据图表用 ECharts；锚在移动元素上的弹层用 `@floating-ui/react`，非 antd Popover）才手写。

## 9. 多语言（i18n，中英双语）

> 全量详设见根 `docs/design/i18n.md`；这里只列前端硬约定。

- **UI 文案不硬编码中文**，一律走 **react-i18next**。组件里 `const { t } = useTranslation('<ns>')`；MobX store 等非组件里用 `import i18n from '@src/i18n'` 的 `i18n.t(...)`。
- 资源在 `src/i18n/locales/<lng>/<namespace>.ts`，**一页一命名空间**（`common` 放共享 chrome）。**zh 文件是形状真相源**，en 用 `typeof zhX` 约束结构一致（漏 key 直接编译报错）。加命名空间要同时改两个 `locales/<lng>/index.ts`。
- **切换语言只经 `localeStore`（`src/i18n/locale-store.ts`）**：它 `setLocale()` 持久化到 localStorage + `i18n.changeLanguage` + 更新 `document.lang`，并驱动 `main.tsx` 顶层 `ConfigProvider` 的 antd locale（zhCN/enUS）。默认中文，顶栏 `Segmented` 切换。
- api client（`src/api/client.ts`）每请求带 `Accept-Language: localeStore.locale`——后端据此本地化报错、Agent 据此选回复语言。
- key 命名语义分层小驼峰（`nav.backtest`、`error.saveFailed`），带变量用 `{{count}}` 插值。**别把 LLM prompt 文本抽进 i18n**（prompt 在后端，是静态英文串，不走 i18n）。
