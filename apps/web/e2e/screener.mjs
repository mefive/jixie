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
    // Clear cached factor runs so the factor page starts from a known baseline (no stale run gets
    // auto-restored on select, which would leave the params bar in an unexpected freq/neutral state).
    await fetch('/api/app/factor/runs', { method: 'DELETE' });
    const factors = await (await fetch('/api/app/factors/catalog')).json();
    for (const factor of factors) {
      if (factor.kind === 'custom' && factor.label.startsWith('e2e')) {
        await fetch(`/api/app/factors/custom/${factor.key}`, { method: 'DELETE' });
      }
    }
  });

  // 2. ChatGPT-style split workspace: history stays left, and initial load selects no conversation.
  await page.goto(`${BASE}/screen`, { waitUntil: 'networkidle' });
  await page.locator('.jx-screen-sidebar').waitFor();
  const selectedOnLoad = await page.locator('.jx-screen-historyItem--active').count();
  if (selectedOnLoad !== 0) {
    throw new Error(`首次进入不应选中历史对话: ${selectedOnLoad}`);
  }
  await page.locator('.jx-screen-chatHero').waitFor();
  await page.screenshot({ path: `${SHOTS}1-screen-empty.png` });
  log('shot 1: sidebar + unselected blank conversation');

  // 3. Seed a saved screen, then open it from the persistent sidebar.
  await page.evaluate(async () => {
    await fetch('/api/app/screens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e测试选股',
        spec: {
          filters: [
            { field: 'peTtm', op: '<', value: 15 },
            { field: 'dvRatio', op: '>', value: 3 },
          ],
          sort: { field: 'totalMv', dir: 'desc' },
          limit: 50,
        },
      }),
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.jx-screen-historyItem', { hasText: 'e2e测试选股' }).click();
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

  // 5. Saving keeps the query in the left sidebar; reopening it re-runs the deterministic screen.
  await page.locator('.jx-screen-nameInput').fill('e2e测试选股');
  await page.getByRole('button', { name: '保存筛选' }).click();
  await page.waitForFunction(
    async () => {
      const l = await (await fetch('/api/app/screens')).json();
      return Array.isArray(l) && l.length === 1;
    },
    { timeout: 10000 },
  );
  await page
    .locator('.jx-screen-historyItem', { hasText: 'e2e测试选股' })
    .waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}2c-saved-query-sidebar.png` });
  log('shot 2c: sidebar shows the saved screen');
  await page.locator('.jx-screen-historyItem', { hasText: 'e2e测试选股' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 0,
    { timeout: 10000 },
  );
  log('saved screen re-runs on open');

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

    // REFRESH MID-TURN. The turn keeps running server-side; reopening its sidebar history item
    // re-subscribes via the running-turn discovery.
    await page.reload({ waitUntil: 'networkidle' });
    const conversationItem = page
      .locator('.jx-screen-sidebarSection', { hasText: '历史对话' })
      .locator('.jx-screen-historyItem')
      .first();
    await conversationItem.waitFor({ timeout: 10000 });
    await conversationItem.click();
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

    // The sidebar keeps the session visible; reopen → conversation + card restored (the card re-runs).
    await page.screenshot({ path: `${SHOTS}2g-sidebar-both-items.png` });
    log('shot 2g: sidebar shows saved screen + conversation');
    await conversationItem.click();
    await page.locator('.jx-queryCard-table .ant-table-row').first().waitFor({ timeout: 30000 });
    log('session reopened — conversation restored, card re-ran');
    await page.screenshot({ path: `${SHOTS}2h-chat-reopened.png` });

    // Delete the conversation history item → the saved screen survives.
    await conversationItem.locator('.jx-screen-historyDelete').click();
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

    // Clean this conversation up so the sidebar state below matches the non-NL path.
    await page
      .locator('.jx-screen-sidebarSection', { hasText: '历史对话' })
      .locator('.jx-screen-historyDelete')
      .first()
      .click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();
    await page.waitForFunction(
      async () => {
        const l = await (await fetch('/api/app/screen/conversations')).json();
        return Array.isArray(l) && l.length === 0;
      },
      { timeout: 10000 },
    );
    log('chart conversation cleaned up');

    // 6d. analyzeData: a statistics question plain SQL can't answer — the agent packs SQL fetch +
    //     sandboxed JS (correlation) into ONE tool call; only the computed result reaches the reply.
    await page.getByRole('button', { name: '新对话' }).click();
    await composer.waitFor();
    await composer.fill('贵州茅台和五粮液最近一年的日收益相关性有多高?');
    await page.keyboard.press('Enter');
    await page
      .locator('.jx-screen-bubble--assistant:not(.jx-screen-bubble--thinking)', {
        hasText: /相关/,
      })
      .first()
      .waitFor({ timeout: 180000 });
    await page.screenshot({ path: `${SHOTS}2j-chat-analyze.png` });
    log('shot 2j: analyzeData statistics answer (correlation via sandboxed code)');
    await page
      .locator('.jx-screen-sidebarSection', { hasText: '历史对话' })
      .locator('.jx-screen-historyDelete')
      .first()
      .click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();
    await page.waitForFunction(
      async () => {
        const l = await (await fetch('/api/app/screen/conversations')).json();
        return Array.isArray(l) && l.length === 0;
      },
      { timeout: 10000 },
    );
    log('analyze conversation cleaned up');
  }

  // 7. Delete the saved screen from the sidebar → server list empty.
  await page
    .locator('.jx-screen-historyItem', { hasText: 'e2e测试选股' })
    .locator('.jx-screen-historyDelete')
    .click({ force: true });
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
  const seeded = await page.evaluate(async () => {
    // Clear any strategies left by a prior crashed run so the seed's name (and the 历史 card) is unique.
    const existing = await (await fetch('/api/app/strategies')).json();
    for (const it of existing) {
      await fetch(`/api/app/strategies/${it.id}`, { method: 'DELETE' });
    }

    const factorResponse = await fetch('/api/app/factors/custom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e编辑器因子',
        code: 'export default defineFactor({ name: "e2e editor factor", compute: (bar) => bar.peTtm });',
      }),
    });
    const factor = await factorResponse.json();
    if (!factorResponse.ok) {
      throw new Error(`factor seed failed: ${JSON.stringify(factor)}`);
    }

    const keyResponse = await fetch(`/api/app/factors/custom/${factor.id}/finalize-key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'e2e_editor_factor' }),
    });
    const finalized = await keyResponse.json();
    if (!keyResponse.ok) {
      throw new Error(`factor key finalization failed: ${JSON.stringify(finalized)}`);
    }

    const factorKey = finalized.strategyKey;
    const code = [
      "let last = '';",
      'export default defineStrategy({',
      "  name: 'e2e策略',",
      `  factors: ['${factorKey}'],`,
      "  watch: ['600519.SH'],",
      '  onBar(ctx) {',
      "    const code = '600519.SH';",
      `    const factorValue = ctx.factor('${factorKey}', code);`,
      "    const period = ctx.period('monthly');",
      '    if (factorValue != null && period !== last) {',
      '      last = period;',
      '      ctx.order(code, 100);',
      '    }',
      '  },',
      '});',
    ].join('\n');
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
    return { strategyId: (await r.json()).id, factorId: factor.id, factorKey };
  });
  log('seeded code strategy', seeded.strategyId);

  // A first visit with no recents opens the prompt-first hero (mirrors 选股看图), not the workbench.
  await page.getByRole('link', { name: '回测工作台' }).click();
  await page.locator('.jx-lab-hero').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}4-lab-hero.png` });
  log('shot 4: new-strategy hero (prompt-first)');

  // Open the seeded strategy by id → the agent-IDE workbench (3-column Splitter: Agent | 编辑器 | 结果).
  // The code loads into Monaco; there's no name field now — the name is pinned atop the Agent chat.
  await page.goto(`${BASE}/lab?id=${seeded.strategyId}`, { waitUntil: 'domcontentloaded' });
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

  // A custom factor literal carries catalog-backed navigation and hover metadata in Monaco.
  const factorLiteral = page
    .locator('.jx-lab-code .view-line span')
    .filter({ hasText: seeded.factorKey })
    .first();
  await factorLiteral.hover();
  const factorHover = page.locator('.monaco-hover', { hasText: 'e2e编辑器因子' });
  await factorHover.waitFor({ timeout: 10000 });
  const factorImplementationLink = factorHover.getByText('查看因子实现', { exact: true });
  const factorHref = await factorImplementationLink.getAttribute('data-href');
  if (!factorHref?.endsWith(`/factors?factor=${seeded.factorId}`)) {
    throw new Error(`factor hover link has unexpected target: ${factorHref}`);
  }
  await page.screenshot({ path: `${SHOTS}4c1-factor-hover.png` });
  log('shot 4c1: custom factor hover with implementation link');

  const [factorPage] = await Promise.all([
    page.context().waitForEvent('page'),
    factorImplementationLink.click(),
  ]);
  await factorPage.waitForLoadState('domcontentloaded');
  if (!factorPage.url().endsWith(`/factors?factor=${seeded.factorId}`)) {
    throw new Error(`factor hover link opened unexpected URL: ${factorPage.url()}`);
  }
  await factorPage.close();

  const [linkedFactorPage] = await Promise.all([
    page.context().waitForEvent('page'),
    factorLiteral.click({ modifiers: ['Meta'] }),
  ]);
  await linkedFactorPage.waitForLoadState('domcontentloaded');
  if (!linkedFactorPage.url().endsWith(`/factors?factor=${seeded.factorId}`)) {
    throw new Error(`factor Cmd+click opened unexpected URL: ${linkedFactorPage.url()}`);
  }
  await linkedFactorPage.close();

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
  // The docs language toggle now drives the app-wide localeStore (persisted), not a ?lang URL param.
  await page.getByRole('button', { name: 'EN' }).click();
  await page.locator('.jx-docs-langBtn--on', { hasText: 'EN' }).waitFor({ timeout: 4000 });
  await page.waitForFunction(() => localStorage.getItem('jx-locale') === 'en');
  await page.screenshot({ path: `${SHOTS}6b-sdk-docs-en.png` });
  log('shot 6b: SDK docs page (EN toggle)');
  // Reset to zh — locale is global/persisted now, so leave it Chinese for the remaining zh-selector steps.
  await page.getByRole('button', { name: '中' }).click();
  await page.waitForFunction(() => localStorage.getItem('jx-locale') === 'zh');

  // 7. 因子研究 (/factors): agent-IDE layout — the catalog lives in the 因子库 tab of the left Agent panel.
  //    Pick a preset (stays put — presets are analysis-only) → set 频率/区间 → 运行 → decile chart + IC +
  //    long-short. Single-factor + on-the-fly; use a fundamental factor (ep, ~seconds) to keep e2e fast.
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.locator('.jx-factor-libItem').first().waitFor({ timeout: 15000 });
  const factorCount = await page.locator('.jx-factor-libItem').count();
  log('factor catalog items:', factorCount);
  if (factorCount < 14) {
    // 9 original presets + the 3.5 menu additions + abnormal turnover.
    throw new Error(`因子目录数不足: ${factorCount}`);
  }

  // The textbook abnormal-turnover factor must be present as a built-in, read-only preset.
  const abnormalTurnoverItem = page.locator('.jx-factor-libItem', {
    hasText: '异常换手率(21日/252日)',
  });
  await abnormalTurnoverItem.scrollIntoViewIfNeeded();
  await abnormalTurnoverItem.click();
  await page.locator('.jx-factor-presetBar').waitFor({ timeout: 10000 });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}7f-abturn-builtin.png` });
  log('shot 7f: abnormal-turnover built-in preset exists and is read-only');

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
  const keyInput = page.locator('.jx-factor-keyInput input');
  await keyInput.fill('e2e_ep_copy');
  await page.getByRole('button', { name: '确认并锁定' }).click();
  await page.locator('.ant-modal-confirm-btns .ant-btn-primary').click();
  await page.locator('.jx-factor-keyValue', { hasText: 'custom:e2e_ep_copy' }).waitFor();
  await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' });
  await page.locator('.ant-message-notice').waitFor({ state: 'hidden', timeout: 5000 });
  await page.screenshot({ path: `${SHOTS}7c1-factor-key.png` });
  log('shot 7c1: custom factor strategy key finalized and locked');
  const collisionKey = await page.evaluate(async () => {
    const created = await (
      await fetch('/api/app/factors/custom', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'e2e重名因子',
          code: 'export default defineFactor({ name: "collision", compute: (bar) => bar.pb });',
        }),
      })
    ).json();
    const finalized = await (
      await fetch(`/api/app/factors/custom/${created.id}/finalize-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'e2e_ep_copy' }),
      })
    ).json();
    await fetch(`/api/app/factors/custom/${created.id}`, { method: 'DELETE' });
    return finalized.key;
  });
  if (collisionKey !== 'e2e_ep_copy_2') {
    throw new Error(`factor key collision did not append a suffix: ${collisionKey}`);
  }
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

  // Parameters live in the ellipsis popover: frequency is a Radio group, range is a DatePicker, and
  // neutralization is a Select. Re-open the popover only when it is not already visible.
  const openParams = async () => {
    if (!(await page.locator('.jx-factor-paramPopover:visible').count())) {
      await page.locator('.jx-factor-paramActions button').last().click();
      await page.locator('.jx-factor-paramPopover:visible').waitFor();
    }
  };
  const pickFreq = async (label) => {
    await openParams();
    await page.locator('.jx-factor-paramPopover:visible').getByText(label, { exact: true }).click();
  };
  const pickNeutral = async (label) => {
    await openParams();
    await page.locator('.jx-factor-paramPopover:visible .jx-factor-neutralSelect').click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: label })
      .click();
  };

  // Bound the window (2022→) up front so both the neutralized and weekly recomputes stay fast, then
  // dismiss the DatePicker panel (Escape) before touching the Selects (its popup would overlay them).
  await openParams();
  const startBox = page.locator('.jx-factor-paramPopover:visible .ant-picker input').first();
  await startBox.click();
  await startBox.fill('2022-01-01');
  await startBox.press('Enter');
  await page.keyboard.press('Escape');

  // 7d. Neutralization + net-of-cost (3.4), on monthly 2022→ (only the neutral Select changes — no freq
  //     switch to race). Reports were cleared at start, so this primary run is a FRESH compute (no cache)
  //     and carries lsNav — no 重算 needed. Exercises the SwIndustryMember PIT lookup + net-of-cost view.
  //     Wait for the sample to show the bounded window (2022) so we know the compute finished, not the
  //     stale full-range chart from shot 7.
  await pickNeutral('市值+行业');
  await page.locator('.jx-factor-params .ant-btn-primary').click();
  await page.waitForFunction(
    () => (document.querySelector('.jx-factor-sample')?.textContent ?? '').includes('2022'),
    undefined, // arg — the timeout belongs in the THIRD parameter (options), not here
    { timeout: 90000 },
  );
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  const neutralRun = ((await page.locator('.jx-factor-sample').textContent()) ?? '').trim();
  // The 已跑 chips should now include a neutralized run tagged 市值行业中性.
  const neutralChip = await page.locator('.jx-factor-chip', { hasText: '市值行业中性' }).count();
  if (neutralChip < 1) {
    throw new Error('中性化运行未出现在已跑 chips');
  }
  // Net-of-cost view (3.4): a fresh run carries lsNav, so the 费后净值 section (gross vs net line chart
  // + net metrics) renders. Centre it in the viewport and let its lazy echarts canvas paint before the
  // acceptance screenshot.
  const netSection = page.locator('.jx-factor-sectionTitle', { hasText: '费后' });
  await netSection.waitFor({ timeout: 10000 });
  await netSection.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  // The report now has multiple charts (decile + net NAV + IC decay); ≥2 canvases = the net chart drew.
  await page.waitForFunction(
    () => document.querySelectorAll('.jx-factor-chart canvas').length >= 2,
    undefined,
    { timeout: 10000 },
  );
  await page.waitForTimeout(600);
  log('shot 7d: ep 市值+行业中性化 + 费后净值 →', neutralRun);
  await page.screenshot({ path: `${SHOTS}7d-factors-neutral.png` });

  // 7e. Correlation matrix (3.4): open the modal from the 因子库 tab, pick 3 fast fundamentals (uses the
  //     current monthly 2022 window → fast), compute → heatmap. Textbook: ep~bp positive, all vs size.
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: '相关性矩阵' }).click();
  const corrSelect = page.locator('.jx-factor-corrSelect');
  await corrSelect.click();
  for (const name of ['盈利收益率', '账面市值比', '股息率']) {
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: name })
      .click();
  }
  // Close the option dropdown by clicking the modal's TITLE (above the select — the 13-item dropdown
  // extends downward and covers the hint text below). NOT Escape: antd Modal closes on Escape.
  await page.locator('.ant-modal-title', { hasText: '因子相关性矩阵' }).click();
  // The 计算 button by class, not name: antd inserts a space between the two CJK chars ("计 算").
  await page.locator('.jx-factor-corrControls .ant-btn-primary').click();
  await page.locator('.jx-factor-corrChart canvas').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(700);
  log('shot 7e: 相关性矩阵 (ep/bp/dv + size)');
  await page.screenshot({ path: `${SHOTS}7e-factors-correlation.png` });
  await page.keyboard.press('Escape'); // close the modal

  // 7b. Back to raw (neutral 无) + weekly horizon — reset neutral first so weekly + industry-neutral
  //     (whole-market panels + the industry table = slow) never runs.
  await pickNeutral('无');
  await pickFreq(/^周$/);
  await page.locator('.jx-factor-params .ant-btn-primary').click();
  await page.waitForFunction(
    () => (document.querySelector('.jx-factor-sample')?.textContent ?? '').includes('周'),
    undefined, // arg — the timeout belongs in the THIRD parameter (options), not here
    { timeout: 95000 },
  );
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  log(
    'shot 7b: ep 周度分析 →',
    ((await page.locator('.jx-factor-sample').textContent()) ?? '').trim(),
  );
  await page.screenshot({ path: `${SHOTS}7b-factors-week.png` });

  // 8. Factor→strategy closed loop (3.2 acceptance): create a custom factor, reference it from a
  //    strategy via ctx.factor('custom:<key>'), run a REAL short backtest through the walled worker,
  //    and confirm the result lands. API-level (the UI flows above already covered both editors).
  const loopResult = await page.evaluate(async () => {
    const factorRes = await fetch('/api/app/factors/custom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e闭环EP',
        code: 'export default defineFactor({ name: "e2e闭环EP", compute: (bar) => (bar.peTtm && bar.peTtm > 0 ? 1 / bar.peTtm : null) });',
      }),
    });
    const factor = await factorRes.json();
    if (!factorRes.ok) {
      return { error: `factor create failed: ${JSON.stringify(factor)}` };
    }

    const keyRes = await fetch(`/api/app/factors/custom/${factor.id}/finalize-key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'e2e_closed_loop_ep' }),
    });
    const finalized = await keyRes.json();
    if (!keyRes.ok) {
      return { error: `factor key finalization failed: ${JSON.stringify(finalized)}` };
    }
    const factorKey = finalized.strategyKey;

    const code = [
      "let last = '';",
      'export default defineStrategy({',
      "  name: 'e2e闭环策略',",
      `  factors: ['${factorKey}'],`,
      '  async onBar(ctx) {',
      "    if (ctx.period('monthly') === last) return;",
      "    last = ctx.period('monthly');",
      '    const picks = (await ctx.universe()).minListDays(365)',
      `      .rankBy((b, code) => ctx.factor('${factorKey}', code))`,
      '      .top(10);',
      '    if (picks.length) ctx.equalWeight(picks);',
      '  },',
      '});',
    ].join('\n');
    const strategyRes = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e闭环策略',
        start: '20240101',
        end: '20240331',
        initialCash: 1000000,
        code,
      }),
    });
    const strategy = await strategyRes.json();

    const submitRes = await fetch(`/api/app/strategy/backtest?strategyId=${strategy.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e闭环策略',
        start: '20240101',
        end: '20240331',
        initialCash: 1000000,
        code,
      }),
    });
    const { jobId } = await submitRes.json();
    if (!jobId) {
      return { error: 'backtest submit returned no jobId' };
    }

    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const job = await (await fetch(`/api/app/strategy/backtest/${jobId}?since=0`)).json();
      if (job.status === 'done') {
        const saved = await (await fetch(`/api/app/strategies/${strategy.id}`)).json();
        await fetch(`/api/app/factors/custom/${factor.id}`, { method: 'DELETE' });
        return { trades: saved.lastResult?.trades ?? 0 };
      }
      if (job.status === 'error' || job.status === 'stale') {
        return { error: `backtest ${job.status}: ${job.error ?? ''}` };
      }
    }
    return { error: 'backtest timed out' };
  });
  if (loopResult.error || !(loopResult.trades > 0)) {
    throw new Error(`因子→策略闭环失败: ${loopResult.error ?? 'no trades'}`);
  }
  log('factor→strategy closed loop: custom factor backtest done,', loopResult.trades, 'trades');

  // cleanup seeded + auto-saved strategies for this user
  await page.evaluate(async () => {
    const list = await (await fetch('/api/app/strategies')).json();
    for (const it of list) {
      await fetch(`/api/app/strategies/${it.id}`, { method: 'DELETE' });
    }
  });
  await page.evaluate(async (factorId) => {
    await fetch(`/api/app/factors/custom/${factorId}`, { method: 'DELETE' });
  }, seeded.factorId);
  log('cleaned up strategies');

  log('PASS — all steps completed');
} catch (e) {
  log('FAIL', e.message);
  await page.screenshot({ path: `${SHOTS}error.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
