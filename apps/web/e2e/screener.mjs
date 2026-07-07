import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Headless e2e for the frontend — acceptance screenshots. The standing rule: every frontend change
 * finishes by running this and reviewing apps/web/e2e/shots/*.png.
 *
 * Prereqs: api on :3001 and web on :5173 must be running, e.g.
 *   pnpm --filter api dev        (terminal 1, NODE_ENV=development)
 *   pnpm --filter web dev        (terminal 2)
 * then: pnpm --filter web test:e2e
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
// Acceptance screenshots — gitignored; the user reviews these after each frontend change.
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log('[e2e]', ...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  // 1. Load app then dev-login (sets the session cookie; dev/login is dev-only).
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return r.status;
  });
  log('dev login status', status);

  // 1b. Idempotency: purge this user's saved screens + conversations left by prior runs.
  await page.evaluate(async () => {
    const screens = await (await fetch('/api/app/screens')).json();
    for (const s of screens) {
      await fetch(`/api/app/screens/${s.id}`, { method: 'DELETE' });
    }
    const conversations = await (await fetch('/api/app/screen/conversations')).json();
    for (const conversation of conversations) {
      await fetch(`/api/app/screen/conversations/${conversation.id}`, { method: 'DELETE' });
    }
  });

  // 2. The card wall (full reload → authStore.load sees the cookie).
  await page.goto(`${BASE}/screen`, { waitUntil: 'networkidle' });
  await page.locator('.jx-screen-wallBar').waitFor();
  await page.screenshot({ path: `${SHOTS}1-wall.png` });
  log('shot 1: card wall');

  // 3. Example chip → the query view: editable chips + fresh result table.
  await page.getByRole('button', { name: '低PE高股息大盘' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 5,
    { timeout: 15000 },
  );
  const rows = await page.locator('.jx-screen-table tbody tr.ant-table-row').count();
  const summary = ((await page.locator('.jx-screen-summary').textContent()) ?? '').trim();
  log('result rows', rows, '|', summary);
  await page.screenshot({ path: `${SHOTS}2-query-view.png` });
  log('shot 2: query view (example spec, rows rendered)');

  // 3b. Edit a condition chip (remove the 股息率 filter) → deterministic re-query (no LLM).
  const sumBefore = ((await page.locator('.jx-screen-summary').textContent()) ?? '').trim();
  await page.locator('.jx-chips-chip').nth(1).getByTitle('移除条件').click();
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('.jx-screen-summary');
      return el && el.textContent && el.textContent.trim() !== prev;
    },
    sumBefore,
    { timeout: 10000 },
  );
  log('after chip edit:', ((await page.locator('.jx-screen-summary').textContent()) ?? '').trim());
  await page.screenshot({ path: `${SHOTS}2b-chips-edit.png` });
  log('shot 2b: condition chips re-query');

  // 4. Click first row → opens the stock detail in a NEW TAB (K线/PE/量), list stays intact.
  const [stockPage] = await Promise.all([
    page.context().waitForEvent('page'),
    page.locator('.jx-screen-table tbody tr.ant-table-row').first().click(),
  ]);
  await stockPage.waitForLoadState('networkidle');
  await stockPage.locator('canvas').first().waitFor({ timeout: 15000 });
  await stockPage.waitForTimeout(800); // let echarts paint
  log(
    'stock page:',
    ((await stockPage.locator('.jx-stock-title').textContent()) ?? '').trim(),
    stockPage.url(),
  );
  await stockPage.screenshot({ path: `${SHOTS}3-stock-detail.png` });
  log('shot 3: stock detail (前复权 default, linear, PE on right axis)');

  // 4b. 不复权 (raw) — shows ex-div jumps vs the adjusted default.
  await stockPage.getByText('不复权', { exact: true }).click();
  await stockPage.waitForTimeout(500);
  await stockPage.screenshot({ path: `${SHOTS}3c-stock-raw.png` });
  log('shot 3c: stock detail (不复权 raw)');

  // 4c. Back to 前复权 + log price axis.
  await stockPage.getByText('前复权', { exact: true }).click();
  await stockPage.getByText('对数', { exact: true }).click();
  await stockPage.waitForTimeout(600);
  await stockPage.screenshot({ path: `${SHOTS}3b-stock-log.png` });
  await stockPage.close();
  log('shot 3b: stock detail (log price axis)');

  // 5. Pin the query to the wall under a name → back on the wall a QUERY card shows; reopen re-runs it.
  await page.locator('.jx-screen-nameInput').fill('e2e测试选股');
  await page.getByRole('button', { name: '钉到墙上' }).click();
  await page.waitForFunction(
    async () => {
      const l = await (await fetch('/api/app/screens')).json();
      return Array.isArray(l) && l.length === 1;
    },
    { timeout: 10000 },
  );
  await page.getByRole('button', { name: '卡片墙' }).click();
  await page
    .locator('.jx-screen-card--query .jx-screen-cardTitle', { hasText: 'e2e测试选股' })
    .waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}2c-wall-query-card.png` });
  log('shot 2c: wall shows the pinned query card');
  await page.locator('.jx-screen-card--query', { hasText: 'e2e测试选股' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 0,
    { timeout: 10000 },
  );
  log('query card re-runs on open');
  await page.getByRole('button', { name: '卡片墙' }).click();
  await page.locator('.jx-screen-wall').waitFor();

  // 6. 新对话 → the chat view. Shift+Space inserts a newline (Enter would send) — check on the composer.
  await page.getByRole('button', { name: '新对话' }).click();
  const composer = page.locator('.jx-screen-chatComposer textarea');
  await composer.waitFor();
  await composer.click();
  await page.keyboard.type('a');
  await page.keyboard.press('Shift+Space');
  await page.keyboard.type('b');
  const draft = await composer.inputValue();
  if (draft !== 'a\nb') {
    throw new Error(`Shift+Space 换行失败: ${JSON.stringify(draft)}`);
  }
  await composer.fill('');
  await page.screenshot({ path: `${SHOTS}2e-chat-empty.png` });
  log('shot 2e: empty conversation');

  // 6b. (opt-in, costs LLM calls) A REAL agent turn — STREAMED (SSE), and refresh-resumable: send,
  //     watch the pending bubble stream, then RELOAD mid-turn and reopen the session card — the
  //     client re-subscribes (snapshot replay) and the reply still lands with its query card.
  //     Gated by E2E_NL (needs DEEPSEEK_API_KEY).
  if (process.env.E2E_NL) {
    await composer.fill('筛市盈率TTM低于15、股息率大于3%的股票,按市值从大到小取前10');
    await page.keyboard.press('Enter');
    // The streaming pending bubble appears immediately (tool phase notes / streamed text).
    await page.locator('.jx-screen-bubble--thinking').waitFor({ timeout: 15000 });
    await page.waitForTimeout(2500); // let some stream accumulate for the screenshot
    await page.screenshot({ path: `${SHOTS}2f0-chat-streaming.png` });
    log('shot 2f0: streaming pending bubble (SSE)');

    // REFRESH MID-TURN. The turn keeps running server-side; the wall's session card already holds
    // the persisted user message; reopening it re-subscribes via the running-turn discovery.
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.jx-screen-card--chat').first().waitFor({ timeout: 10000 });
    await page.locator('.jx-screen-card--chat').first().click();
    await page.locator('.jx-queryCard').first().waitFor({ timeout: 120000 }); // resumed or already-done turn
    await page.locator('.jx-queryCard-table .ant-table-row').first().waitFor({ timeout: 30000 });
    const bubbleRoles = await page.evaluate(() =>
      [...document.querySelectorAll('.jx-screen-bubble')].map((el) =>
        el.className.includes('--user') ? 'user' : 'assistant',
      ),
    );
    if (!bubbleRoles.includes('user') || !bubbleRoles.includes('assistant')) {
      throw new Error(`刷新续接后消息不完整: ${JSON.stringify(bubbleRoles)}`);
    }
    await page.screenshot({ path: `${SHOTS}2f-chat-card.png` });
    log('shot 2f: refresh mid-turn → resumed stream → reply + query card landed');

    // back on the wall → a session card; reopen → conversation + card restored (the card re-runs).
    await page.getByRole('button', { name: '卡片墙' }).click();
    await page.locator('.jx-screen-card--chat').first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${SHOTS}2g-wall-both-cards.png` });
    log('shot 2g: wall shows query + session cards');
    await page.locator('.jx-screen-card--chat').first().click();
    await page.locator('.jx-queryCard-table .ant-table-row').first().waitFor({ timeout: 30000 });
    log('session reopened — conversation restored, card re-ran');
    await page.screenshot({ path: `${SHOTS}2h-chat-reopened.png` });
    await page.getByRole('button', { name: '卡片墙' }).click();

    // delete the session card → the pinned QUERY card survives.
    await page.locator('.jx-screen-card--chat').first().locator('.jx-screen-cardDelete').click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();
    await page.waitForFunction(
      async () => {
        const l = await (await fetch('/api/app/screen/conversations')).json();
        return Array.isArray(l) && l.length === 0;
      },
      { timeout: 10000 },
    );
    const querySurvives = await page.evaluate(async () => {
      const l = await (await fetch('/api/app/screens')).json();
      return l.length;
    });
    if (querySurvives !== 1) {
      throw new Error('删会话把查询卡片带没了 — 违反解耦设计');
    }
    log('session card deleted; query card survives (decoupled)');

    // 6c. Chart card: a NEW conversation asking for a trend chart — the agent goes through the
    //     sqlQuery/renderChart tools and the reply carries a chart part (echarts canvas in the bubble;
    //     the persisted part stores the SQL and re-runs on render, same contract as query cards).
    await page.getByRole('button', { name: '新对话' }).click();
    await composer.waitFor();
    await composer.fill('用图表画出沪深300指数(000300.SH)最近一年的收盘价走势');
    await page.keyboard.press('Enter');
    await page.locator('.jx-chatChart canvas').first().waitFor({ timeout: 180000 });
    await page.waitForTimeout(800); // let echarts paint
    await page.screenshot({ path: `${SHOTS}2i-chat-chart.png` });
    log('shot 2i: chart card rendered (renderChart tool → SQL re-run → echarts)');

    // clean this conversation up so the wall state below matches the non-NL path.
    await page.getByRole('button', { name: '卡片墙' }).click();
    await page.locator('.jx-screen-card--chat').first().locator('.jx-screen-cardDelete').click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();
    await page.waitForFunction(
      async () => {
        const l = await (await fetch('/api/app/screen/conversations')).json();
        return Array.isArray(l) && l.length === 0;
      },
      { timeout: 10000 },
    );
    log('chart conversation cleaned up');
  } else {
    await page.getByRole('button', { name: '卡片墙' }).click();
  }

  // 7. Delete the pinned query card from the wall → server list empty.
  await page.locator('.jx-screen-card--query', { hasText: 'e2e测试选股' }).hover();
  await page
    .locator('.jx-screen-card--query', { hasText: 'e2e测试选股' })
    .locator('.jx-screen-cardDelete')
    .click();
  await page.locator('.ant-popconfirm .ant-btn-primary').click();
  await page.waitForFunction(
    async () => {
      const l = await (await fetch('/api/app/screens')).json();
      return Array.isArray(l) && l.length === 0;
    },
    { timeout: 10000 },
  );
  log('deleted query card → server list empty');

  // 7b. Owner-scoping / not-found: a bogus saved id 404s on GET and DELETE.
  const notFound = await page.evaluate(async () => {
    const g = await fetch('/api/app/screens/nope', { method: 'GET' });
    const d = await fetch('/api/app/strategies/nope', { method: 'DELETE' });
    const cg = await fetch('/api/app/screen/conversations/nope', { method: 'GET' });
    return { get: g.status, del: d.status, conv: cg.status };
  });
  log('bogus id statuses', JSON.stringify(notFound));
  if (notFound.get !== 404 || notFound.del !== 404 || notFound.conv !== 404) {
    throw new Error(`expected 404s, got ${JSON.stringify(notFound)}`);
  }

  // 5. Seed a CODE strategy via the API. There's no fake-result seed anymore (the /result route is gone —
  // a last-result only comes from a real worker run, exercised below under E2E_BT). We open it by id.
  const seededId = await page.evaluate(async () => {
    // Clear any strategies left by a prior crashed run so the seed's name (and the 历史 card) is unique.
    const existing = await (await fetch('/api/app/strategies')).json();
    for (const it of existing) {
      await fetch(`/api/app/strategies/${it.id}`, { method: 'DELETE' });
    }
    const code =
      "let last=''; export default defineStrategy({ name:'e2e策略', watch:['600519.SH'], onBar(ctx){ const c='600519.SH'; const px=ctx.price(c); const w=ctx.history(c,'close',20); if(px==null||w.length<20) return; const ma=w.reduce((a,b)=>a+b,0)/w.length; if(px>ma&&ctx.shares(c)===0) ctx.order(c,100); else if(px<ma&&ctx.shares(c)>0) ctx.exit(c); } });";
    const r = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e策略',
        start: '20200101',
        end: '20201231',
        initialCash: 1000000,
        code,
      }),
    });
    return (await r.json()).id;
  });
  log('seeded code strategy', seededId);

  // A first visit with no recents opens the prompt-first hero (mirrors 选股看图), not the workbench.
  await page.getByRole('link', { name: '回测工作台' }).click();
  await page.locator('.jx-lab-hero').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}4-lab-hero.png` });
  log('shot 4: new-strategy hero (prompt-first)');

  // Open the seeded strategy by id → the agent-IDE workbench (3-column Splitter: Agent | 编辑器 | 结果).
  // The code loads into Monaco; there's no name field now — the name is pinned atop the Agent chat.
  await page.goto(`${BASE}/lab?id=${seededId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 20000 }); // Monaco chunk + TS worker
  await page.waitForFunction(
    () => {
      const name = document.querySelector('.jx-lab-agentName');
      const ed = document.querySelector('.jx-lab-code .monaco-editor');
      return (
        name &&
        (name.textContent || '').trim().startsWith('e2e策略') &&
        ed &&
        (ed.textContent || '').includes('600519')
      );
    },
    { timeout: 15000 },
  );
  log('loaded saved strategy into the workbench (name pinned in Agent, code in Monaco)');
  await page.screenshot({ path: `${SHOTS}4c-code-editor.png` });
  log('shot 4c: strategy code editor (Monaco)');

  // 历史 tab (inside the Agent panel) lists this user's strategies as cards — the seeded one shows up.
  await page.locator('.jx-lab-agent').getByRole('tab', { name: '历史' }).click();
  await page
    .locator('.jx-lab-history .jx-sp-card', { hasText: 'e2e策略' })
    .waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}4b-lab-cards.png` });
  log('shot 4b: 历史 tab 策略卡片');
  await page.locator('.jx-lab-agent').getByRole('tab', { name: 'Agent' }).click();

  // Unrun edits guard: change 资金 (万) → 新建 warns before discarding; 取消 keeps the current strategy.
  // (Code/params only commit on a run, so an edit + 新建/切策略 would drop them — hence the confirm.)
  const cashInput = page.locator('.jx-lab-runConfig .ant-input-number-input');
  await cashInput.fill('200'); // 200万 ≠ the seeded 100万 → edited
  await cashInput.blur();
  await page.getByRole('button', { name: '新建' }).click();
  await page.getByText('有改动尚未运行').waitFor({ timeout: 5000 });
  await page.waitForTimeout(300); // settle the modal open animation
  await page.screenshot({ path: `${SHOTS}4d-new-dirty-confirm.png` });
  log('shot 4d: 新建 dirty-guard confirm');
  // antd inserts a space between the two CJK glyphs ("取 消") → match with a tolerant regex.
  await page
    .locator('.ant-modal-footer')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await page
    .getByText('有改动尚未运行')
    .waitFor({ state: 'detached', timeout: 5000 })
    .catch(() => {});
  await cashInput.fill('100'); // restore 100万 → not edited, so leaving for /docs·/factors won't beforeunload
  await cashInput.blur();

  // 4e. (opt-in, costs an LLM call) Agent chat: send a turn → the assistant replies (and may rewrite the
  //     code in the editor). 回车发送, no button. Gated by E2E_NL (needs DEEPSEEK_API_KEY).
  if (process.env.E2E_NL) {
    const before = await page.locator('.jx-lab-bubble--assistant').count();
    const chatBox = page.locator('.jx-lab-chatInput textarea');
    await chatBox.fill('把持有条件改成收盘价站上 5 日均线');
    await chatBox.press('Enter');
    await page.waitForFunction(
      (prev) => document.querySelectorAll('.jx-lab-bubble--assistant').length > prev,
      before,
      { timeout: 60000 }, // DeepSeek round-trip + compile-repair
    );
    log('agent turn: assistant replied');
    await page.screenshot({ path: `${SHOTS}4e-agent-chat.png` });
  }

  // 5b. (opt-in, runs a real ~1y backtest in the worker) Run it → the worker streams progress logs into
  //     the 日志 dock while it computes. A never-run strategy is dirty → 运行回测 enabled. Gated by E2E_BT.
  if (process.env.E2E_BT) {
    await page.getByRole('button', { name: '运行回测' }).click();
    // The code strategy compiles + runs in the worker. A fast single-name run finishes within one poll
    // (the live log just flashes), so assert on the final result — proves it ran end-to-end and rendered.
    await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 60000 });
    const cum = (
      (await page
        .locator('.jx-lab-metric', { hasText: '累计收益' })
        .locator('.jx-lab-metricValue')
        .textContent()) ?? ''
    ).trim();
    log('code backtest done, 累计收益', cum);
    await page
      .locator('.jx-lab-result canvas')
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => {});
    await page.waitForTimeout(400); // let echarts paint the equity curve
    await page.screenshot({ path: `${SHOTS}5-lab-result.png` });
    log('shot 5: code backtest result');

    // 5c. 交易明细 tab (appears once a run has trades) — K线 over the trade table, in place (no modal).
    await page
      .locator('.jx-lab-resultTabs')
      .getByRole('tab', { name: /交易明细/ })
      .click();
    await page
      .locator('.jx-lab-tradesTab .jx-td-list .jx-td-row')
      .first()
      .waitFor({ timeout: 8000 });
    await page.locator('.jx-lab-tradesTab .jx-td-canvas canvas').first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(600); // let the scatter + slider paint
    log(
      'trade detail: rows',
      await page.locator('.jx-lab-tradesTab .jx-td-list .jx-td-row').count(),
    );
    await page.screenshot({ path: `${SHOTS}5c-trade-detail.png` });

    // 5d. 页面打开 → the standalone /trades page (new tab) renders the same K线 + list.
    const [tradePage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('button', { name: /页面打开/ }).click(),
    ]);
    await tradePage.waitForLoadState('domcontentloaded');
    await tradePage.locator('.jx-td-canvas canvas').first().waitFor({ timeout: 12000 });
    await tradePage.waitForTimeout(600);
    log('trade page:', tradePage.url());
    await tradePage.screenshot({ path: `${SHOTS}5d-trade-page.png` });
    await tradePage.close();
  }

  // 6. SDK 文档 standalone page (/docs) — bilingual reference generated from sdk-reference; anchored per method.
  await page.goto(`${BASE}/docs#universe`, { waitUntil: 'networkidle' });
  await page.locator('#universe .jx-docs-symName').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}6-sdk-docs.png` });
  log('shot 6: SDK docs page (zh)');
  await page.getByRole('button', { name: 'EN' }).click();
  await page.waitForFunction(() => location.search.includes('lang=en'));
  await page.locator('.jx-docs-langBtn--on', { hasText: 'EN' }).waitFor({ timeout: 4000 });
  await page.screenshot({ path: `${SHOTS}6b-sdk-docs-en.png` });
  log('shot 6b: SDK docs page (EN toggle)');

  // 7. 因子研究 (/factors): agent-IDE layout — the catalog lives in the 因子库 tab of the left Agent panel.
  //    Pick a preset (stays put — presets are analysis-only) → set 频率/区间 → 运行 → decile chart + IC +
  //    long-short. Single-factor + on-the-fly; use a fundamental factor (ep, ~seconds) to keep e2e fast.
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.locator('.jx-factor-libItem').first().waitFor({ timeout: 15000 });
  const factorCount = await page.locator('.jx-factor-libItem').count();
  log('factor catalog items:', factorCount);
  if (factorCount < 9) {
    throw new Error(`因子目录数不足: ${factorCount}`);
  }

  // select 盈利收益率 (ep, fundamental) → the right column's 运行/查看 → wait for the decile chart
  await page.locator('.jx-factor-libItem', { hasText: '盈利收益率' }).click();

  // 7a. Presets are seeded READ-ONLY code rows now: the middle editor shows the code under a lock
  //     bar with 复制为自定义 (fork). Verify the bar, fork, land on an editable custom copy, delete it.
  await page.locator('.jx-factor-presetBar').waitFor({ timeout: 10000 });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}7c-preset-readonly.png` });
  log('shot 7c: preset factor readonly code + fork bar');
  await page.getByRole('button', { name: '复制为自定义' }).click();
  await page.waitForFunction(() => !document.querySelector('.jx-factor-presetBar'), {
    timeout: 15000,
  });
  const forkedName = ((await page.locator('.jx-factor-agentNameText').textContent()) ?? '').trim();
  if (!forkedName.includes('副本')) {
    throw new Error(`fork 后未切到副本因子: ${forkedName}`);
  }
  log('preset forked into editable copy:', forkedName);
  await page.evaluate(async () => {
    // delete the forked copy (cleanup) — presets themselves must reject deletion server-side.
    const catalog = await (await fetch('/api/app/factors/catalog')).json();
    for (const item of catalog.filter((f) => f.kind === 'custom')) {
      await fetch(`/api/app/factors/custom/${item.key}`, { method: 'DELETE' });
    }
    const rejected = await fetch('/api/app/factors/custom/ep', { method: 'DELETE' });
    if (rejected.ok) {
      throw new Error('预置因子删除竟然成功了 — 只读守卫失效');
    }
  });
  log('forked copy cleaned up; preset delete correctly rejected');

  // back to the preset for the analysis shots below — reload first so the catalog drops the deleted
  // fork (otherwise 「盈利收益率」matches both the preset and the stale 副本 entry).
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.locator('.jx-factor-libItem').first().waitFor({ timeout: 15000 });
  await page.locator('.jx-factor-libItem', { hasText: '盈利收益率' }).click();
  await page.locator('.jx-factor-params .ant-btn-primary').click();
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 60000 }); // fundamental ~seconds cold
  await page.waitForTimeout(500); // let echarts paint
  log('shot 7: ep 月度分析 →', ((await page.locator('.jx-factor-dir').textContent()) ?? '').trim());
  await page.screenshot({ path: `${SHOTS}7-factors.png` });

  // Bound the window (2022→) so the weekly recompute stays fast + deterministic (full-range weekly over
  // ~570 weeks is slow/flaky; 4yr ≈ 200 weeks finishes well under the timeout).
  const startBox = page.locator('.jx-factor-params .ant-picker input').first();
  await startBox.click();
  await startBox.fill('2022-01-01');
  await startBox.press('Enter');
  // switch frequency to 周 and re-run → the same factor at weekly horizon
  await page.locator('.jx-factor-params .ant-select').click();
  await page.locator('.ant-select-item-option', { hasText: /^周$/ }).click();
  await page.locator('.jx-factor-params .ant-btn-primary').click();
  await page.waitForFunction(
    () => (document.querySelector('.jx-factor-sample')?.textContent ?? '').includes('周'),
    { timeout: 95000 },
  );
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  log(
    'shot 7b: ep 周度分析 →',
    ((await page.locator('.jx-factor-sample').textContent()) ?? '').trim(),
  );
  await page.screenshot({ path: `${SHOTS}7b-factors-week.png` });

  // cleanup seeded + auto-saved strategies for this user
  await page.evaluate(async () => {
    const list = await (await fetch('/api/app/strategies')).json();
    for (const it of list) {
      await fetch(`/api/app/strategies/${it.id}`, { method: 'DELETE' });
    }
  });
  log('cleaned up strategies');

  log('PASS — all steps completed');
} catch (e) {
  log('FAIL', e.message);
  await page.screenshot({ path: `${SHOTS}error.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
