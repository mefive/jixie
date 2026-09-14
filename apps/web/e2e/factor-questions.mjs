import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// A user reads an existing report, asks what its result means, returns after refresh,
// then opens a different report and follows up. No application HTTP response is mocked.
// Seeded reports and the external model are controlled; calculation/LLM quality are not tested.
const screenshots = fileURLToPath(new URL('../acceptance/', import.meta.url));
const apiDirectory = fileURLToPath(new URL('../../api/', import.meta.url));
const apiRequire = createRequire(new URL('../../api/package.json', import.meta.url));
await mkdir(screenshots, { recursive: true });
const log = createWriteStream(`${screenshots}/factor-questions-server.log`);
const server = fork(`${apiDirectory}/tests/factor-questions-e2e-server.ts`, [], {
  cwd: apiDirectory,
  execArgv: ['--conditions=development', '--import', apiRequire.resolve('tsx')],
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
let browser;
let base;
let modelBase;
let requestId = 0;

function receive(type, id) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(
      () => fail(new Error(`Fixture timed out waiting for ${type}`)),
      45_000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      server.off('message', message);
      server.off('exit', exited);
      server.off('error', fail);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const exited = (code) => fail(new Error(`Fixture exited before ${type}: ${code}`));
    const message = (value) => {
      if (value.type === 'error') {
        fail(new Error(value.message));
      } else if (value.type === type && (id === undefined || value.requestId === id)) {
        cleanup();
        resolveMessage(value);
      }
    };
    server.on('message', message);
    server.on('exit', exited);
    server.on('error', fail);
  });
}

async function captureReport(page, path) {
  await page
    .locator('.monaco-editor .view-lines')
    .getByText('export default defineFactor', { exact: false })
    .waitFor();
  await page.locator('.jx-factor-chart canvas').first().waitFor();
  // Let the existing ECharts entrance animation finish before capturing the visible report.
  await page.waitForTimeout(1_100);
  await page.screenshot({ path });
}

try {
  const ready = await receive('ready');
  base = ready.base;
  modelBase = ready.modelBase;
  browser = await chromium.launch({ headless: true });
  for (const locale of ['zh', 'en']) {
    const copy =
      locale === 'zh'
        ? {
            first: '这份报告的 Rank IC 均值 0.04 是什么意思？能说明因子稳定有效吗？',
            second: '这份较新的报告与刚才那份相比，能看出什么变化？',
            firstAnswer: '仅凭均值不能证明稳定有效或能够盈利',
            secondAnswer: '仅凭两个区间不能断言因子衰减',
            sourceChanged: '本轮使用的报告与当前页面选择不同，回答仍保留原来的来源。',
          }
        : {
            first: 'What does the mean Rank IC of 0.04 mean? Does it establish factor stability?',
            second: 'How does this more recent report compare with the earlier one?',
            firstAnswer: 'That mean alone does not establish stability or profitability.',
            secondAnswer: 'Different sample periods alone do not establish factor decay',
            sourceChanged:
              'This question used a different report from the current selection. Its answer retains the original source.',
          };
    const context = await browser.newContext({ viewport: { width: 1600, height: 1080 } });
    await context.addInitScript((language) => localStorage.setItem('jx-locale', language), locale);
    await context.addCookies([{ name: 'sid', value: ready.sessions[locale].id, url: base }]);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin !== base) {
        errors.push(`Unexpected external request: ${route.request().url()}`);
        return route.abort();
      }
      return route.continue();
    });
    try {
      await page.goto(`${base}/factors?factor=ep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.jx-factor-historyTrigger').click();
      await page.locator('.jx-factor-historyItem', { hasText: '2020-01-01' }).click();
      await page.waitForURL(`**report=${ready.sessions[locale].reportIds[0]}`);
      await page.locator('.jx-factor-metrics').getByText('0.0400', { exact: true }).waitFor();
      await page.locator('.jx-factor-chart canvas').first().waitFor();

      const composer = page.locator('.jx-factor-chatBox');
      await composer.fill(copy.first);
      await composer.press('Enter');
      const chat = page.locator('.jx-factor-chatLog');
      await chat.getByText(copy.first, { exact: true }).waitFor();
      await chat.getByText(copy.firstAnswer, { exact: false }).waitFor();
      await page.locator('.jx-agentPending-status').waitFor({ state: 'hidden' });
      assert.equal(await chat.locator('.jx-factor-bubble--assistant').count(), 1);
      assert.equal(await chat.locator('details[open]').count(), 0);
      assert.match(await chat.innerText(), /0\.0400/);
      await captureReport(page, `${screenshots}/factor-questions-report-${locale}.png`);

      // Returning to the page must retain a completed question and its answer exactly once.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await chat.getByText(copy.firstAnswer, { exact: false }).waitFor();
      assert.equal(await chat.getByText(copy.first, { exact: true }).count(), 1);
      assert.equal(await chat.locator('.jx-factor-bubble--assistant').count(), 1);

      await page.locator('.jx-factor-historyTrigger').click();
      await page.locator('.jx-factor-historyItem', { hasText: '2023-01-01' }).click();
      await page.waitForURL(`**report=${ready.sessions[locale].reportIds[1]}`);
      await page.locator('.jx-factor-metrics').getByText('0.0150', { exact: true }).waitFor();
      const firstSource = chat.getByTestId('factor-question-context').first();
      await firstSource.locator('summary').first().click();
      await firstSource.getByText(copy.sourceChanged, { exact: true }).waitFor();
      assert.match(await firstSource.innerText(), /20200101/);
      await firstSource.locator('summary').first().click();

      await composer.fill(copy.second);
      await composer.press('Enter');
      await chat.getByText(copy.second, { exact: true }).waitFor();
      // A reader reloads while the second answer is pending; the real backend keeps that turn.
      await page.locator('.jx-agentPending-stop').waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.jx-agentPending-stop').waitFor();
      server.send({ type: 'resume-answer', locale });
      await chat.getByText(copy.secondAnswer, { exact: false }).waitFor();
      await page.locator('.jx-agentPending-status').waitFor({ state: 'hidden' });
      assert.equal(await chat.getByText(copy.second, { exact: true }).count(), 1);
      assert.equal(await chat.locator('.jx-factor-bubble--assistant').count(), 2);
      const answer = chat.locator('.jx-factor-bubble--assistant').last();
      assert.match(await answer.innerText(), /0\.0150/);
      assert.match(await answer.innerText(), /0\.0400/);
      assert.equal(await chat.locator('details[open]').count(), 0);
      await captureReport(page, `${screenshots}/factor-questions-compare-${locale}.png`);

      const id = ++requestId;
      const inspected = receive('inspection', id);
      server.send({ type: 'inspect', requestId: id, locale });
      const stored = await inspected;
      assert.deepEqual(stored.failures, []);
      assert.equal(stored.factorUnchanged, true);
      assert.equal(stored.conversation.messages.length, 4);
      assert.equal(stored.conversation.turns.length, 2);
      assert.ok(stored.conversation.turns.every((turn) => turn.status === 'done'));
      assert.deepEqual(
        stored.conversation.turns.map((turn) => turn.contextSnapshot.report.id),
        ready.sessions[locale].reportIds,
      );
      const calls = stored.modelRequests.filter((call) =>
        call.context.report.id.endsWith(`-${locale}`),
      );
      assert.equal(calls.length, 2, 'Refreshing must not submit another model request.');
      assert.deepEqual(
        calls.map((call) => call.context.report.id),
        ready.sessions[locale].reportIds,
      );
      assert.deepEqual(errors, []);
      console.log(
        `[factor-questions:${locale}] report → question → answer → refresh → compare: passed`,
      );
    } catch (error) {
      await page
        .screenshot({ path: `${screenshots}/factor-questions-journey-failure-${locale}.png` })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const closed = once(server, 'exit');
    if (server.connected) {
      server.send({ type: 'stop' });
    } else {
      server.kill('SIGTERM');
    }
    const timeout = setTimeout(() => server.kill('SIGKILL'), 10_000);
    try {
      const [code, signal] = await closed;
      assert.equal(signal, null, 'The fixture did not shut down cleanly.');
      assert.equal(code, 0, 'The fixture failed during cleanup.');
    } finally {
      clearTimeout(timeout);
    }
  }
  log.end();
  for (const listener of [base, modelBase].filter(Boolean)) {
    await assert.rejects(
      new Promise((resolveConnected, reject) => {
        const socket = createConnection(Number(new URL(listener).port), '127.0.0.1');
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.destroy();
          resolveConnected();
        });
      }),
      { code: 'ECONNREFUSED' },
    );
  }
}
