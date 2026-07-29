import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
const ONLY_ETF = process.env.HELP_SCREEN_LIVE_ONLY_ETF === '1';
const KEEP_ON_FAILURE = process.env.HELP_SCREEN_LIVE_KEEP_ON_FAILURE === '1';
const DATA_DATE = /20\d{2}\s*(?:[-年/]\s*)?\d{1,2}/;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-screen-live-e2e]', ...args);
let completed = false;

try {
  await login();
  await cleanup();
  await page.goto(`${BASE}/screen`, { waitUntil: 'networkidle' });

  if (!ONLY_ETF) {
    const composer = page.locator('.jx-screen-chatHero textarea');
    await composer.fill('查询贵州茅台（600519.SH）当前市盈率，并说明数据日期');
    await composer.press('Enter');
    const firstReply = await waitForAssistantTurn(0);
    assertContains(firstReply, /贵州茅台|600519/, 'direct stock reply has no instrument');
    assertContains(firstReply, /市盈率|PE/i, 'direct stock reply has no PE');
    assertContains(firstReply, DATA_DATE, 'direct stock reply has no data date');
    await page.screenshot({ path: `${SHOTS}10c-screen-direct-query-live.png` });
    log('direct stock query passed');

    const followupComposer = page.locator('.jx-screen-chatComposer textarea');
    await followupComposer.fill('继续查询五粮液的当前市盈率，也注明证券代码和数据日期');
    await followupComposer.press('Enter');
    const followupReply = await waitForAssistantTurn(1);
    assertContains(followupReply, /五粮液|000858/, 'follow-up reply has no instrument');
    assertContains(followupReply, /市盈率|PE/i, 'follow-up reply has no PE');
    assertContains(followupReply, DATA_DATE, 'follow-up reply has no data date');
    if ((await page.locator('.jx-screen-historyItem--active').count()) !== 1) {
      throw new Error('follow-up did not remain in the active conversation');
    }
    await page.screenshot({ path: `${SHOTS}10d-screen-followup-live.png` });
    log('conversation follow-up passed');
  }

  await page.getByRole('button', { name: '新对话' }).click();
  const etfComposer = page.locator('.jx-screen-chatHero textarea');
  await etfComposer.fill('比较沪深300ETF和黄金ETF近一年表现，并注明证券代码和数据截止日期');
  await etfComposer.press('Enter');
  const etfReply = await waitForAssistantTurn(0);
  assertContains(etfReply, /沪深300|300ETF/, 'ETF reply has no CSI 300 ETF');
  assertContains(etfReply, /黄金|Gold/i, 'ETF reply has no gold ETF');
  assertContains(etfReply, /ETF/i, 'ETF reply does not identify the instrument type');
  assertContains(etfReply, DATA_DATE, 'ETF reply has no data date');
  await page.screenshot({ path: `${SHOTS}10e-screen-etf-comparison-live.png` });
  log('ETF comparison passed');
  completed = true;
} finally {
  if (completed || !KEEP_ON_FAILURE) {
    await cleanup().catch((error) => log('cleanup failed:', error.message));
  } else {
    log('preserving failed conversation for trace inspection');
  }
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return response.status;
  });
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function waitForAssistantTurn(previousCount) {
  const thinking = page.locator('.jx-screen-bubble--thinking');
  await thinking.waitFor({ timeout: 15_000 });
  await thinking.waitFor({ state: 'detached', timeout: 180_000 });
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('.jx-screen-bubble--assistant:not(.jx-screen-bubble--thinking)')
        .length > count,
    previousCount,
    { timeout: 15_000 },
  );
  const replies = page.locator('.jx-screen-bubble--assistant:not(.jx-screen-bubble--thinking)');
  const reply = ((await replies.last().textContent()) ?? '').trim();
  if (!reply) {
    throw new Error('assistant reply is empty');
  }
  return reply;
}

function assertContains(value, pattern, message) {
  if (!pattern.test(value)) {
    throw new Error(`${message}: ${JSON.stringify(value)}`);
  }
}

async function cleanup() {
  await page.evaluate(async () => {
    const screens = await (await fetch('/api/app/screens')).json();
    for (const screen of screens) {
      await fetch(`/api/app/screens/${screen.id}`, { method: 'DELETE' });
    }
    const conversations = await (await fetch('/api/app/screen/conversations')).json();
    for (const conversation of conversations) {
      await fetch(`/api/app/screen/conversations/${conversation.id}`, { method: 'DELETE' });
    }
  });
}
