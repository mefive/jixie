import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  cleanupResearchClarificationFixture,
  RESEARCH_CLARIFICATION_FIXTURE as fixture,
  seedResearchClarificationFixture,
} from './research-clarification-fixture.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

await seedResearchClarificationFixture();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, fixture.email);
  await openFixture(page);

  const card = page.getByTestId(`research-clarification-${fixture.clarificationId}`);
  await card.waitFor({ timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  await card.getByText('待确认', { exact: true }).waitFor();
  const composer = page.locator('.jx-research-agentPrompt');
  if (!(await composer.isDisabled())) {
    throw new Error('The free-form composer must pause while a Research clarification is pending.');
  }
  await page.mouse.move(40, 40);
  await page.screenshot({ path: `${SHOTS}research-clarification-pending.png` });

  await card.getByText('沪金主力连续', { exact: true }).click();
  await card.getByRole('button', { name: '确认选择' }).click();
  await card.getByText('已确认', { exact: true }).waitFor({ timeout: 30_000 });
  await waitForPersistedAnswer(page);
  const stop = page.getByRole('button', { name: '停止', exact: true });
  if (await stop.isVisible()) {
    await stop.click();
    await stop.waitFor({ state: 'detached', timeout: 30_000 });
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(fixture.title, { exact: true }).first().click();
  const refreshed = page.getByTestId(`research-clarification-${fixture.clarificationId}`);
  await refreshed.getByText('已确认', { exact: true }).waitFor({ timeout: 30_000 });
  await refreshed.scrollIntoViewIfNeeded();
  await page.mouse.move(40, 40);
  await page.screenshot({ path: `${SHOTS}research-clarification-answered.png` });

  console.log(
    '[research-clarification-e2e] pending=durable composer=blocked answer=persisted refresh=answered',
  );
} finally {
  await context.close();
  await browser.close();
  await cleanupResearchClarificationFixture();
}

async function openFixture(page) {
  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(fixture.title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
}

async function waitForPersistedAnswer(page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const document = await api(page, `/api/app/research/documents/${fixture.documentId}`);
    const persisted = document.messages
      .flatMap((message) => message.parts)
      .find(
        (part) =>
          part.type === 'research_clarification' &&
          part.clarification.id === fixture.clarificationId,
      );
    if (persisted?.clarification.status === 'answered') {
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error('Clarification answer was not persisted into the source message.');
}

async function api(page, path, init) {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        headers: { 'content-type': 'application/json' },
        ...requestInit,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(JSON.stringify(body));
      }
      return body;
    },
    { requestPath: path, requestInit: init },
  );
}

async function devLogin(page, email) {
  const status = await page.evaluate(async (loginEmail) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail }),
    });
    return response.status;
  }, email);
  if (status !== 200) {
    throw new Error(`dev login failed for ${email}: ${status}`);
  }
}
