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

  // 2. Screener page (full reload → authStore.load sees the cookie).
  await page.goto(`${BASE}/screen`, { waitUntil: 'networkidle' });
  await page.getByText('选股看图').first().waitFor();
  await page.screenshot({ path: `${SHOTS}1-screen-empty.png` });
  log('shot 1: empty screener');

  // 3. Example query → result table fills.
  await page.getByRole('button', { name: '低PE高股息大盘' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 5,
    { timeout: 15000 },
  );
  const rows = await page.locator('.jx-screen-table tbody tr.ant-table-row').count();
  const summary = ((await page.locator('.jx-screen-summary').textContent()) ?? '').trim();
  log('result rows', rows, '|', summary);
  await page.screenshot({ path: `${SHOTS}2-screen-results.png` });
  log('shot 2: results table');

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

  // 3c. Save the current screen (manual) → it shows up under 我的选股 → reopen it → delete it.
  // (antd inserts a space between two CJK chars, so the OK button reads "保 存" — target it by class.)
  await page.getByRole('button', { name: '保存选股' }).click();
  await page.locator('.ant-modal input').fill('e2e测试选股');
  await page.locator('.ant-modal-footer .ant-btn-primary').click();
  await page.locator('.ant-modal').waitFor({ state: 'hidden' });
  // open the 我的选股 dropdown → the saved item is listed
  await page.getByRole('button', { name: /我的选股/ }).click();
  await page.locator('.ant-dropdown .jx-savedBar-itemName', { hasText: 'e2e测试选股' }).waitFor();
  log('saved screen listed under 我的选股');
  await page.screenshot({ path: `${SHOTS}2d-saved-screen.png` });
  log('shot 2d: 我的选股 dropdown');
  // reopen it (click the item) → spec reloads and re-runs
  await page.locator('.ant-dropdown .jx-savedBar-itemName', { hasText: 'e2e测试选股' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 0,
    { timeout: 10000 },
  );
  log('reopened saved screen → table repopulated');
  // delete it: open dropdown, click the trash icon → assert the server list is now empty
  await page.getByRole('button', { name: /我的选股/ }).click();
  await page.locator('.ant-dropdown .jx-savedBar-del').first().click();
  await page.waitForFunction(
    async () => {
      const l = await (await fetch('/api/app/screens')).json();
      return Array.isArray(l) && l.length === 0;
    },
    { timeout: 10000 },
  );
  log('deleted saved screen → server list empty');
  await page.keyboard.press('Escape'); // close the dropdown before the next step

  // 3d. Owner-scoping / not-found: a bogus saved id 404s on GET and DELETE.
  const notFound = await page.evaluate(async () => {
    const g = await fetch('/api/app/screens/nope', { method: 'GET' });
    const d = await fetch('/api/app/strategies/nope', { method: 'DELETE' });
    return { get: g.status, del: d.status };
  });
  log('bogus id statuses', JSON.stringify(notFound));
  if (notFound.get !== 404 || notFound.del !== 404) throw new Error(`expected 404s, got ${JSON.stringify(notFound)}`);

  // 4. Click first row → opens the stock detail in a NEW TAB (K线/PE/量), list stays intact.
  const [stockPage] = await Promise.all([
    page.context().waitForEvent('page'),
    page.locator('.jx-screen-table tbody tr.ant-table-row').first().click(),
  ]);
  await stockPage.waitForLoadState('networkidle');
  await stockPage.locator('canvas').first().waitFor({ timeout: 15000 });
  await stockPage.waitForTimeout(800); // let echarts paint
  log('stock page:', ((await stockPage.locator('.jx-stock-title').textContent()) ?? '').trim(), stockPage.url());
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

  // 5. Seed a strategy via the API (auto-save would otherwise need a full ~30s backtest run), then
  //    nav to the workbench → 我的策略 dropdown lists it → click to load it into the form.
  const seeded = await page.evaluate(async () => {
    const r = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e策略',
        start: '20200101',
        end: '20201231',
        initialCash: 1234567,
        strategy: {
          schedule: 'monthly',
          stages: [
            { kind: 'universe', source: { type: 'all' } },
            { kind: 'select', score: { kind: 'field', name: 'peTtm' }, side: 'low', pick: { by: 'quantile', value: 0.1 } },
            { kind: 'sizing', method: { kind: 'equal' } },
          ],
        },
      }),
    });
    return r.status;
  });
  log('seed strategy status', seeded);

  await page.getByRole('link', { name: '回测工作台' }).click();
  await page.getByText('策略配置').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /我的策略/ }).click();
  await page.locator('.ant-dropdown .jx-savedBar-itemName', { hasText: 'e2e策略' }).waitFor();
  await page.screenshot({ path: `${SHOTS}4-lab.png` });
  log('shot 4: backtest workbench + 我的策略 dropdown');
  // load it → the strategy-name input reflects the saved name
  await page.locator('.ant-dropdown .jx-savedBar-itemName', { hasText: 'e2e策略' }).click();
  await page.waitForFunction(
    () => {
      const inputs = [...document.querySelectorAll('.jx-lab-field input')];
      return inputs.some((i) => i.value === 'e2e策略');
    },
    { timeout: 10000 },
  );
  log('loaded saved strategy into the form');

  // 5a. The right area defaults to the 流程图 view — the IR rendered as an editable pipeline. Editing a
  //     node writes through the same store as the form, so the two views stay in sync (one source of truth).
  await page.locator('.jx-flow-node').first().waitFor({ timeout: 10000 });
  log('flowchart nodes:', await page.locator('.jx-flow-node').count());
  await page.screenshot({ path: `${SHOTS}4b-strategy-flow.png` });
  log('shot 4b: strategy flowchart');
  await page.locator('.jx-flow-node', { hasText: '选择' }).click();
  await page.locator('.jx-flow-editorTitle', { hasText: '选择' }).waitFor();
  // the merged 打分·选择 editor has [打分因子, 方向] selects — 方向 is the 2nd
  await page.locator('.jx-flow-editor .ant-select').nth(1).click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('买高分位').click();
  await page.locator('.jx-lab-form').getByText('买高分位').waitFor({ timeout: 5000 }); // form reflects the flow edit
  log('flow→form sync ok (方向 → 买高分位)');

  // 4c. Enable timing via the 择时 node → a general condition editor (no preset); node shows the condition.
  await page.locator('.jx-flow-node', { hasText: '择时' }).click();
  await page.locator('.jx-flow-editorTitle', { hasText: '择时' }).waitFor();
  await page.locator('.jx-flow-editor .ant-select').first().click(); // 启用择时 on/off
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('启用条件').click();
  await page.locator('.jx-flow-cond').first().waitFor({ timeout: 5000 }); // condition editor (operand·op·operand)
  await page.locator('.jx-flow-node', { hasText: '新高' }).waitFor({ timeout: 5000 }); // node shows the entry condition
  log('timing enabled → general condition editor (no preset)');
  await page.screenshot({ path: `${SHOTS}4c-timing.png` });
  log('shot 4c: pipeline with timing condition editor');

  // 5b. (opt-in, runs a real ~1y backtest in the worker) Run it → the worker streams progress logs
  //     into the lab panel while it computes. Gated by E2E_BT so routine runs stay fast.
  if (process.env.E2E_BT) {
    await page.getByRole('button', { name: '运行回测' }).click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.jx-lab-log');
        return el && /调仓|开始回测/.test(el.textContent || '');
      },
      { timeout: 60000 },
    );
    log('backtest worker streaming logs into the panel');
    await page.screenshot({ path: `${SHOTS}5-lab-running.png` });
    log('shot 5: live backtest progress log');
  }

  // cleanup seeded + auto-saved strategies for this user
  await page.evaluate(async () => {
    const list = await (await fetch('/api/app/strategies')).json();
    for (const it of list) await fetch(`/api/app/strategies/${it.id}`, { method: 'DELETE' });
  });
  log('cleaned up strategies');

  // 6. (opt-in, costs an LLM call) NL→screen through the UI: needs DEEPSEEK_API_KEY. Run with E2E_NL=1.
  if (process.env.E2E_NL) {
    await page.getByRole('link', { name: '选股看图' }).click();
    const before = ((await page.locator('.jx-screen-summary').textContent().catch(() => '')) ?? '').trim();
    await page.locator('.jx-screen-bar textarea').fill('市盈率低于10、股息率大于4%的股票，按股息率从高到低');
    await page.getByRole('button', { name: 'AI 选股' }).click();
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('.jx-screen-summary');
        return el && el.textContent && el.textContent.trim() !== prev && document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 0;
      },
      before,
      { timeout: 45000 }, // DeepSeek round-trip
    );
    log('NL search summary:', ((await page.locator('.jx-screen-summary').textContent()) ?? '').trim());
    await page.screenshot({ path: `${SHOTS}5-nl-screen.png` });
    log('shot 5: NL→screen result (real DeepSeek)');
  }

  log('PASS — all steps completed');
} catch (e) {
  log('FAIL', e.message);
  await page.screenshot({ path: `${SHOTS}error.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
