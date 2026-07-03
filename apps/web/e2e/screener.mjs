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
  log('shot 1: empty screener (hero)');

  // 2. Direct lookup (deterministic, no LLM): type a code/name in the hero box → that stock's snapshot row.
  const heroInput = page.locator('.jx-screen-hero textarea');
  await heroInput.waitFor();
  // Shift+Space inserts a newline (Enter would send); quick check, then replace with a clean code.
  await heroInput.click();
  await page.keyboard.type('a');
  await page.keyboard.press('Shift+Space');
  await page.keyboard.type('b');
  const draft = await heroInput.inputValue();
  if (draft !== 'a\nb') throw new Error(`Shift+Space 换行失败: ${JSON.stringify(draft)}`);
  await heroInput.fill('601398');
  await heroInput.press('Enter'); // 回车即发
  await page.waitForFunction(
    () => document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 0,
    { timeout: 15000 },
  );
  const lookedUp = ((await page.locator('.jx-screen-nameCode').first().textContent()) ?? '').trim();
  log('lookup 601398 →', lookedUp);
  if (!lookedUp.startsWith('601398')) throw new Error(`expected 601398.SH, got ${lookedUp}`);
  await page.screenshot({ path: `${SHOTS}1b-lookup.png` });
  log('shot 1b: direct code lookup (no LLM)');

  // 2b. The submitted prompt collapses to a read-only bubble; the edit pencil opens the frosted modal.
  await page.locator('.jx-screen-prompt').waitFor();
  await page.locator('.jx-screen-promptEdit').click();
  await page.locator('.ant-modal-title', { hasText: '选股 / 找标的' }).waitFor();
  const modalDraft = await page.locator('.ant-modal .jx-screen-modalField textarea').inputValue();
  if (modalDraft !== '601398') throw new Error(`edit modal not prefilled: ${JSON.stringify(modalDraft)}`);
  await page.waitForTimeout(450); // let the modal + frosted mask finish animating in
  await page.screenshot({ path: `${SHOTS}1c-edit-modal.png` });
  log('shot 1c: frosted edit modal');
  await page.keyboard.press('Escape');
  await page.locator('.ant-modal').waitFor({ state: 'hidden' });

  // 3. Example query → result table fills (examples live in both the hero and the working top bar).
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
  // delete it: open dropdown, click the trash icon → confirm in the popup → assert the server list is empty
  await page.getByRole('button', { name: /我的选股/ }).click();
  await page.locator('.ant-dropdown .jx-savedBar-del').first().click();
  await page.locator('.ant-modal-confirm .ant-btn-dangerous').click(); // 删除 confirm
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

  // 5. Seed a CODE strategy + a fake last-result via the API, then open it from the 我的策略 card grid.
  const seeded = await page.evaluate(async () => {
    const code =
      "let last=''; export default defineStrategy({ name:'e2e策略', watch:['600519.SH'], onBar(ctx){ const c='600519.SH'; const px=ctx.price(c); const w=ctx.history(c,'close',20); if(px==null||w.length<20) return; const ma=w.reduce((a,b)=>a+b,0)/w.length; if(px>ma&&ctx.shares(c)===0) ctx.order(c,100); else if(px<ma&&ctx.shares(c)>0) ctx.exit(c); } });";
    const r = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'e2e策略', start: '20200101', end: '20201231', initialCash: 1234567, code }),
    });
    // a small result so the card shows a sparkline
    const nav = Array.from({ length: 30 }, (_, i) => ({ date: '2020' + String(i), value: 1e6 * (1 + i * 0.01) }));
    await fetch('/api/app/strategies/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'e2e策略', result: { totalReturn: 0.29, sharpe: 1.4, trades: 25, tradeLog: [], nav } }),
    });
    return r.status;
  });
  log('seed code strategy status', seeded);

  // A brand-new strategy opens prompt-first (the hero, mirroring 选股看图) — not straight into the editor.
  await page.getByRole('link', { name: '回测工作台' }).click();
  await page.locator('.jx-lab-hero').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}4-lab-hero.png` });
  log('shot 4: new-strategy hero (prompt-first)');

  // Open 我的策略 (top bar, available from the hero) → the seeded card → it loads into the editor.
  await page.getByRole('button', { name: /我的策略/ }).click();
  await page.locator('.jx-sp-card', { hasText: 'e2e策略' }).waitFor({ timeout: 10000 }); // card grid (sparkline thumbnail)
  await page.screenshot({ path: `${SHOTS}4b-lab-cards.png` });
  log('shot 4b: 我的策略 卡片');
  await page.locator('.jx-sp-card', { hasText: 'e2e策略' }).click();
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 20000 }); // Monaco chunk + TS worker load
  await page.waitForFunction(
    () => {
      const name = document.querySelector('.jx-lab-field--name input');
      const ed = document.querySelector('.jx-lab-code .monaco-editor');
      return name && name.value === 'e2e策略' && ed && (ed.textContent || '').includes('600519');
    },
    { timeout: 15000 },
  );
  log('loaded saved code strategy into the editor (hero gave way to Monaco)');
  await page.screenshot({ path: `${SHOTS}4c-code-editor.png` });
  log('shot 4c: strategy code editor (Monaco)');

  // 新建 with unsaved edits → confirm-save prompt guards data loss; 取消 keeps the current strategy.
  await page.locator('.jx-lab-field--name input').fill('e2e策略改');
  await page.getByRole('button', { name: '新建' }).click();
  await page.getByText('当前策略尚未保存').waitFor({ timeout: 5000 });
  await page.waitForTimeout(300); // settle the modal open animation
  await page.screenshot({ path: `${SHOTS}4d-new-dirty-confirm.png` });
  log('shot 4d: 新建 dirty-guard confirm');
  // antd inserts a space between the two CJK glyphs ("取 消") → match with a tolerant regex.
  await page.locator('.ant-modal-footer').getByRole('button', { name: /取\s*消/ }).click();
  await page.getByText('当前策略尚未保存').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await page.locator('.jx-lab-field--name input').fill('e2e策略'); // restore so the optional run/cleanup match by name

  // 4c. (opt-in, costs an LLM call) NL→code: describe a strategy → server writes + compiles TS → it
  //     replaces the editor content. Gated by E2E_NL (needs DEEPSEEK_API_KEY).
  if (process.env.E2E_NL) {
    const before = (await page.locator('.jx-lab-code .monaco-editor').textContent()) ?? '';
    await page.locator('.jx-lab-nl textarea').fill('每月买入股息率最高的20只，等权持有');
    await page.getByRole('button', { name: 'AI 生成' }).click();
    await page.waitForFunction(
      (prev) => {
        const ed = document.querySelector('.jx-lab-code .monaco-editor');
        const t = ed ? ed.textContent || '' : '';
        return t !== prev && t.includes('defineStrategy');
      },
      before,
      { timeout: 60000 }, // DeepSeek round-trip + compile-repair
    );
    log('NL→code: editor replaced with generated strategy');
    await page.screenshot({ path: `${SHOTS}4c-nl-code.png` });
  }

  // 5b. (opt-in, runs a real ~1y backtest in the worker) Run it → the worker streams progress logs
  //     into the lab panel while it computes. Gated by E2E_BT so routine runs stay fast.
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
    await page.locator('.jx-lab-result canvas').first().waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400); // let echarts paint the equity curve
    await page.screenshot({ path: `${SHOTS}5-lab-result.png` });
    log('shot 5: code backtest result');

    // 5c. 交易详情 Modal — K线 + trade dots + list; the traded-instruments queue (chips, no filter).
    await page.getByRole('button', { name: /交易详情/ }).click();
    await page.locator('.jx-td-list .jx-td-row').first().waitFor({ timeout: 8000 });
    await page.locator('.jx-td-canvas canvas').first().waitFor({ timeout: 8000 });
    await page.locator('.jx-td-queue .jx-td-chip').first().waitFor({ timeout: 8000 }); // instrument queue
    await page.waitForTimeout(600); // let the scatter + slider paint
    const chipName = ((await page.locator('.jx-td-chip').nth(1).textContent()) ?? '').trim(); // [0] is 全部
    log('trade detail: rows', await page.locator('.jx-td-list .jx-td-row').count(), '| chip', chipName);
    await page.screenshot({ path: `${SHOTS}5c-trade-detail.png` });

    // 5c2. 全部 chip → every instrument's fills in one list (标的 name+code column) + portfolio return chart.
    await page.getByRole('button', { name: /^全部/ }).click();
    await page.locator('.jx-td-list--all .jx-td-row').first().waitFor({ timeout: 6000 });
    await page.waitForTimeout(400);
    log('全部 view: rows', await page.locator('.jx-td-list--all .jx-td-row').count());
    await page.screenshot({ path: `${SHOTS}5c2-trade-all.png` });
    await page.locator('.jx-td-chip').nth(1).click(); // back to a single instrument for the 页面打开 test

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
    await page.keyboard.press('Escape');
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

  // 7. 因子分析 (/factors): pick a factor from the catalog → set 频率/区间 → 运行 → decile chart + IC +
  //    long-short. Single-factor + on-the-fly; use a fundamental factor (ep, ~seconds) to keep e2e fast.
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.getByText('因子分析').first().waitFor();
  await page.locator('.jx-factor-listItem').first().waitFor({ timeout: 15000 });
  const factorCount = await page.locator('.jx-factor-listItem').count();
  log('factor catalog items:', factorCount);
  if (factorCount < 9) throw new Error(`因子目录数不足: ${factorCount}`);

  // select 盈利收益率 (ep, fundamental) → 运行/查看 → wait for the decile chart
  await page.locator('.jx-factor-listItem', { hasText: '盈利收益率' }).click();
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
  log('shot 7b: ep 周度分析 →', ((await page.locator('.jx-factor-sample').textContent()) ?? '').trim());
  await page.screenshot({ path: `${SHOTS}7b-factors-week.png` });

  // cleanup seeded + auto-saved strategies for this user
  await page.evaluate(async () => {
    const list = await (await fetch('/api/app/strategies')).json();
    for (const it of list) await fetch(`/api/app/strategies/${it.id}`, { method: 'DELETE' });
  });
  log('cleaned up strategies');

  // 6. (opt-in, costs an LLM call) NL→screen through the UI: needs DEEPSEEK_API_KEY. Run with E2E_NL=1.
  if (process.env.E2E_NL) {
    await page.getByRole('link', { name: '选股看图' }).click();
    await page.locator('.jx-screen-hero textarea').fill('市盈率低于10、股息率大于4%的股票，按股息率从高到低');
    await page.locator('.jx-screen-hero textarea').press('Enter'); // 回车即发
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.jx-screen-summary');
        return el && el.textContent && document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 0;
      },
      undefined,
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
