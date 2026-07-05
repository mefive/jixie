# 页面刷新/导航「闪一下」问题调查

> 交给下一位排查。以下是症状、已做的尝试、逐帧数据、当前假设、复现方式、涉及文件。
> **状态:✅ 已解决(2026-07-05)。** 修法 = 下文「建议修法」1+2 的变体,共三处:
>
> 1. `LoaderModel` 加 `markLoaded()`(同步置 loaded,不走 microtask);
> 2. `BaseStore` 构造器只在子类**真的覆盖了 `prepare()`** 时才 `prepareLoader.run()`,否则 `markLoaded()`(本项目所有 store 都没覆盖,原来那半个门纯属白等一个 microtask);
> 3. `ComplexRoute` 的**首次 `setup()` 移到首次 render 期同步执行**(与 `createInstance` 同一时机),layout effect 只管参数变更重 setup、StrictMode 重挂重 setup、卸载 cleanup。
>
> 注意:单独把 `useEffect` 改 `useLayoutEffect` 不够 —— 导航(离散事件,SyncLane)确实 paint 前 flush,但整页 reload 的初次 mount 是 DefaultLane(scheduler 任务),layout effect 里触发的重渲染排到下一个任务,中间仍被 paint 一帧白身子(逐帧实测剩 1 帧)。render 期同步 setup 后不依赖任何 lane 优先级,逐帧探针(reload /factors /factors?factor= /screen /lab + 导航×4)全部 0 app-noBody 帧。
>
> 另:e2e `screener.mjs` 的 lab 段(「我的策略」按钮、`jx-lab-field--name`、`jx-lab-nl`)在 `c845382` lab agent-IDE 重构后已过期,与本修复无关,待另行重写。
>
> **lab 的挂载闪(导航到 /lab、刷新 /lab 都闪)也已解决(2026-07-05)**:lab 特有,与 Splitter 无关。原序列 = 整页 `jx-lab-boot`(spinner 350ms 延迟淡入,实际视觉是**空白身子** ~100ms,等 openSaved 拉初始策略)→ 工作台壳弹出 → 编辑器面板再空 ~300ms 等 Monaco 懒加载 chunk → Monaco 弹入,且两段等待是**串行**的(Monaco 的 import 要等 boot 分支结束才触发)。修法对齐 factor:删掉整页 boot 分支,`initializing` 期间直接渲染工作台壳 —— 面板铬架首帧即出,Monaco chunk 与策略 fetch 并行;聊天空态提示与结果面板空态提示在 `initializing` 时静默(避免提示文案闪一下再换成真数据)。hero(全新用户无 recents)路径不受影响,逐帧验证 hero 前无工作台闪帧。
>
> **症状 B(Splitter 宽度抖动)也已解决(2026-07-05)**:根因不是「回流」,而是 antd Splitter 要靠 ResizeObserver 才知道容器宽,首帧 paint 时 px 型 `defaultSize` 面板 + 无 size 面板只能按「px flex-basis + 内容撑开」渲染(实测首帧 340/577/523,内容不同每次都不同),测量后的精确宽度(340/550/550)落在**下一帧** → 可见的宽度跳变。修法:三栏全部给**百分比** `defaultSize`(首帧就能当 flex-basis 用,不需要容器宽),用 `splitterDefaults(leftPx)` 按视口宽把「左栏固定 px、其余对半」预折算成百分比 → 首帧宽度 == 测量后宽度,零跳动。factor.tsx 与 lab.tsx 都已应用(lab 内嵌的纵向 Splitter 是「一固定% + 一 grow」两栏,首帧即终值,无需处理)。逐帧宽度探针(scratchpad `splitter-probe.mjs` / `lab-splitter-probe.mjs`)验证通过。

## 技术栈(相关部分)

- React 18 + Vite + react-router v6(`BrowserRouter` + `<Routes>`),SPA,**无 SSR**。
- antd 6:布局用 `Splitter`(可拖拽分栏)。
- MobX + 自研「complex」框架(`@src/lib`:每页一个 store,`ComplexRoute` 把 store 生命周期接进 react-router)。
- 入口 `apps/web/src/app-routes.tsx`;`main.tsx` 里 `await authStore.load()` **在首次 render 之前**完成(所以不是登录态未定导致的闪)。

## 症状

1. **导航闪**:在 `/factors` ↔ `/screen` ↔ `/lab` 之间点顶部导航切换,**连顶部导航条 TopNav 都会闪一下**。
2. **刷新闪**:F5 刷新 `/factors`(尤其带 `?factor=...` 的已选因子 URL)时,页面工作区闪一下;而 **`/screen` 刷新原本完全不闪**。

## 根因分析(两个独立的闪)

### A. 导航闪 —— TopNav 是「每页各自渲染」的

原本每个页面组件(Factor / Screen / Lab / Stock / TradePage)自己在顶部渲染 `<TopNav/>`。react-router 的 `<Routes>` 一次只渲染一个匹配路由的 element;URL 变化 = 把整个 element 从「factor 子树」换成「screen 子树」。两个 `<TopNav/>` 在不同子树的不同位置,**React 的 reconciliation 不会跨路由复用它们** → 卸载旧的、挂载新的 → TopNav 闪。

### B. 刷新闪(factor 有、screen 无)—— antd Splitter 挂载回流

factor 用 `Splitter`,挂载时要用 ResizeObserver 测容器宽度算百分比,首帧有一次布局回流;screen 是纯 flex 布局,无回流,所以不闪。

## 已做的尝试

1. **移植 `LoadingArea` 组件**(`apps/web/src/components/loading-area.tsx`,从 bcloud-med 移植):loading 指示器**延迟 150ms 才显示**(`useDelayed`),快加载不闪 spinner;`everLoaded` 追踪保留旧内容(silent refresh)。→ **有效**:catalog(~130ms)加载不再闪 spinner。
2. **setup 里同步设 `selectedKey`**(factor-store):reload 带 `?factor=` 时首帧就选中,不再闪「选一个因子」空态。→ **有效**。
3. **factor Splitter 首帧挂载**:把 Splitter 从「catalog 加载后才渲染」改成**无条件首帧渲染**,catalog 加载只 gate「因子库」列表那一小块(`FactorLibrary` 内包 `LoadingArea`)。→ 让 Splitter 尽早挂载、回流发生在空面板时。
4. **TopNav 提到共享 layout**(app-routes.tsx):新增 `AuthedLayout`(`RequireAuth` + `<TopNav/>` + `<div class=jx-app-body><Suspense fallback={null}><Outlet/></Suspense></div>`),把 `/lab /screen /factors /stock /trades` 包进一个 layout route。→ **TopNav 现在跨导航常驻不再闪(已验证 DOM 节点复用)**,但是 ⚠️ **引入了新问题**:见下。

## ⚠️ 最后一次尝试让情况变糟

TopNav 提 layout 后,`<Outlet/>` 外面包了 `<Suspense fallback={null}>`。逐帧采样(full reload `/factors?factor=ep...`):

```
+24ms  blank            (浏览器重载白屏)
+98ms  app-noBody       (jx-app 布局已渲染=TopNav 可见,但 jx-factor-body/Splitter 还没有 → 下方一片白)
+152ms splitter(empty)  (Splitter 挂上了,内容空)
+202ms report           (报告出来)
```

**关键:`+98ms → +152ms` 有个 ~54ms 的 `app-noBody` 窗口** —— 布局(含 TopNav)先渲染了一个 commit,页面内容(Outlet)在**后一个 commit**才出现。表现为「TopNav + 白身子」闪一下再弹出工作区。**这个 gap 现在对所有页面(含 screen)都存在**,所以 screen 也开始闪了。

## ✅ 已定位到真正的根因(complex 框架的 null-render 门)

**不是 Suspense。** 是自研 complex 框架:`complex.render`(`src/lib/react/core/complex.tsx` 第 41-56 行)在 store 未 ready 前**返回 `null`**:

```js
// complex.tsx
return (
  <Observer>{() => {
    if (store && !(store.prepareLoader.loaded && store?.ready)) {
      return null;   // ← store 没 ready 就整页 null
    }
    return <Provider value={{ store }}>{element}</Provider>;
  }}</Observer>
);
```

门里两个条件:
- **`store.ready`**(`base-model.ts`):只有 `setup()` 里 `runInAction(() => this.ready = true)` 才置 true。而 `setup()` 是 `ComplexRoute` 在 **`useEffect`** 里调的(`app-routes.tsx`)—— `useEffect` 在**首帧 paint 之后**才跑。
- **`store.prepareLoader.loaded`**(`base-store.ts`):构造器里 `prepareLoader.run(this.prepare())`,`prepare()` 默认 async no-op,`LoaderModel.run` 经一个 microtask 才 `loaded=true`。

所以时序:**render #1 → 门为 false → 返回 null(body 空)→ paint(空身子)→ useEffect 跑 setup() → ready=true(+prepareLoader microtask)→ render #2 → 出内容 → paint(内容)**。中间那帧空身子 = `app-noBody` gap。

**为什么之前不闪、现在闪:** 之前 `<TopNav/>` 写在页面组件里、是传给 `render()` 的 `element` 的一部分 → 门返回 null 时 **TopNav 也一起 null**(整页空 → 整页一起出现,看起来只是「晚一点出现」,没有中间态)。我把 TopNav 提到 layout(在 complex.render 外面)后,门只挡住 body → 变成「TopNav 已出 + body 空」的可见中间态 → 新的闪。**本质:complex 的 null-render gap 一直存在,只是以前被 TopNav 一起藏住了,现在暴露出来。**

## 建议修法(按推荐度)

1. **让 `setup()` 在 paint 前跑**:`ComplexRoute` 的 `useEffect(() => store.setup(...))` 改 **`useLayoutEffect`**(`app-routes.tsx` 约 162 行)。useLayoutEffect 在 render 后、paint 前同步跑 → `ready` 在首次 paint 前就 true → render #1 的 null 不会被 paint。⚠️ 但 `prepareLoader.loaded` 走 microtask,可能仍慢一帧 —— 需一起解决第 2 点。
2. **让 `prepareLoader` 同步 loaded**:默认 `prepare()` 是 no-op,却要经 `LoaderModel.run` 一个 microtask 才 loaded。可在 `base-store.ts` 里:`prepare()` 无覆盖时不走 loader(直接视作 loaded),或 complex.render 的门放宽成「只看 ready、prepareLoader 仅在真的 override 了 prepare 时才等」。
3. **render 首帧不返回 null,而返回一个撑满高度的骨架/占位**:改 `complex.render` 的 `return null` 为一个占位(至少 body 不塌成空白)。最不动框架语义但仍消除白身子中间态。
4. **兜底(不改框架)**:回退 TopNav 提 layout(`git checkout apps/web/src && rm apps/web/src/app-layout.css`)—— 回到「TopNav 跟 body 一起 null 一起出现」,导航闪回来但刷新不闪。**属于两害取其轻,不推荐**,除非框架改动风险太大。

full reload 的纯白屏(0→~24ms)是浏览器重载本身,SPA 去不掉,不用管。要消除的只是 `app-noBody` 这段「TopNav 已出、body 还空」的中间态,即上面的 complex null-render gap。

## 关键文件(修这里)

- `src/lib/react/core/complex.tsx` 第 41-56 `render()` —— null-render 门(第 48 行)
- `src/lib/react/core/base-store.ts` 第 12-21 —— `prepareLoader` / `prepare()`
- `src/lib/models/base-model.ts` 第 26-34 `setup()` —— `ready=true`
- `src/app-routes.tsx` `ComplexRoute` 的 `useEffect` 调 setup(约 162 行)—— 改 useLayoutEffect 的地方

## 复现

```
pnpm --filter api dev      # :3001
pnpm --filter web dev      # :5173
# 浏览器登录(dev):POST /api/auth/dev/login {email:'e2e@test.com'}
# 1) 导航闪:/factors ↔ /screen 点顶部导航来回切
# 2) 刷新闪:/factors 选个预设因子跑一次分析(URL 带 ?factor=),F5 刷新
```

逐帧采样脚本思路(playwright):`addInitScript` 里 `requestAnimationFrame` 循环记录每帧可见的顶层视图(`.jx-app` / `.jx-factor-body` / `.jx-factor-metrics` 是否存在、`.jx-loadingArea` 的 computed opacity),reload 后 dump。

## 涉及文件

- `apps/web/src/app-routes.tsx` —— 路由 + `AuthedLayout`(TopNav + Suspense + Outlet)+ `ComplexRoute` + `RequireAuth`
- `apps/web/src/app-layout.css` —— `.jx-app` / `.jx-app-body`(新增,未提交)
- `apps/web/src/components/loading-area.tsx` / `.css` —— 移植的延迟 loading 组件
- `apps/web/src/components/top-nav.tsx` —— TopNav(有 `border-b`)
- `apps/web/src/complex/factor/factor.tsx` —— factor 页(Splitter 首帧挂载 + FactorLibrary 内 LoadingArea + FactorResult/ReportBody)
- `apps/web/src/complex/factor/factor-store.ts` —— setup 同步 selectedKey
- `apps/web/src/complex/{lab,screen,stock}/*.tsx` + `lab/trade-page.tsx` —— 已删各自的 `<TopNav/>`
- `apps/web/src/lib/react/core/complex.tsx` + `.../react-utils.tsx` —— complex 框架的 render / observer
- `apps/web/src/main.tsx` —— `await authStore.load()` 后才 render

## 基线

上一个干净 commit:`4a2b18e feat(web): 因子页交互打磨 + 移植 LoadingArea 防闪`。
本轮(TopNav 提 layout + factor 首帧挂载)**未提交**;若要回到「只有 factor 闪、screen 不闪」的状态:`git checkout apps/web/src && rm apps/web/src/app-layout.css`。
