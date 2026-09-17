import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// A user asks for a report calculation, edits a derived analysis and continues it in Research.
// Real Web/API/SQLite/Python; synthetic report data and a controlled external model.
// Model judgment and the formal evaluator are outside this test.
const screenshots = fileURLToPath(new URL('../acceptance/', import.meta.url));
const apiDirectory = fileURLToPath(new URL('../../api/', import.meta.url));
const apiRequire = createRequire(new URL('../../api/package.json', import.meta.url));
await mkdir(screenshots, { recursive: true });
const log = createWriteStream(`${screenshots}/embedded-analysis-server.log`);
const server = fork(`${apiDirectory}/tests/factor-questions-e2e-server.ts`, [], {
  cwd: apiDirectory,
  env: { ...process.env, JIXIE_EMBEDDED_E2E: '1' },
  execArgv: ['--conditions=development', '--import', apiRequire.resolve('tsx')],
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
let browser;
let base;
let modelBase;

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

try {
  const ready = await receive('ready');
  base = ready.base;
  modelBase = ready.modelBase;
  browser = await chromium.launch({ headless: true });

  for (const locale of ['zh', 'en']) {
    const english = locale === 'en';
    const copy = english
      ? {
          question:
            'Plot the annual returns of the ten groups and calculate the highest group minus the lowest. Keep the saved report unchanged.',
          inspect: 'Code, sources and history',
          derive: 'Edit as a new version',
          parameters: 'Parameters (JSON object)',
          run: 'Create version and run',
          continue: 'Continue in Research',
          frozen: 'This version succeeded',
          strategy:
            'Using the saved backtest, plot account equity and calculate the change between the first and last value. Do not run another backtest.',
        }
      : {
          question: '画出十组年化收益，计算最高组与最低组的差距，保留原报告。',
          inspect: '查看代码、来源与历史',
          derive: '修改并创建新版',
          parameters: '参数（JSON 对象）',
          run: '创建新版并运行',
          continue: '继续到 Research',
          frozen: '此版本已成功运行',
          strategy: '用这份已保存回测画出账户净值，并计算首尾变化，不用重新回测。',
        };
    const context = await browser.newContext({ viewport: { width: 1600, height: 1080 } });
    await context.addInitScript((language) => localStorage.setItem('jx-locale', language), locale);
    await context.addCookies([{ name: 'sid', value: ready.sessions[locale].id, url: base }]);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
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
      await page.goto(`${base}/factors?factor=ep&report=${ready.sessions[locale].reportIds[0]}`);
      const composer = page.locator('.jx-factor-chatBox');
      await composer.fill(copy.question);
      await composer.press('Enter');
      const card = page.getByTestId('embedded-analysis-card');
      await card.getByTestId('research-table-output').getByText('0.108', { exact: true }).waitFor();
      await card.getByTestId('research-image-output').locator('img').waitFor();
      await card
        .getByTestId('research-image-output')
        .locator('img')
        .evaluate((image) => image.decode());
      await page.locator('.jx-agentPending-status').waitFor({ state: 'hidden' });
      await page.reload();
      await card.getByTestId('research-table-output').getByText('0.108', { exact: true }).waitFor();
      assert.equal(await card.count(), 1, 'Refreshing must restore exactly one original card');
      await page.locator('.jx-factor-editor .monaco-editor').waitFor();
      await assertValueInsideCard(card, '0.108');
      await page.screenshot({ path: `${screenshots}/embedded-analysis-factor-${locale}.png` });
      await card.getByRole('button', { name: copy.inspect, exact: true }).click();
      const detail = page.getByTestId('embedded-analysis-detail');
      await detail.getByText(copy.frozen, { exact: false }).waitFor();
      await detail.getByRole('button', { name: copy.derive, exact: true }).click();
      const editor = page.getByTestId('embedded-draft-editor');
      await editor
        .locator('label', { hasText: copy.parameters })
        .locator('textarea')
        .fill('{"upper_bucket":8}');
      await editor.getByRole('button', { name: copy.run, exact: true }).click();
      await detail
        .getByTestId('research-table-output')
        .getByText('0.096', { exact: true })
        .waitFor();
      await detail
        .locator('.jx-embedded-history')
        .filter({ hasText: english ? 'Succeeded' : '成功' })
        .waitFor();
      assert.equal(
        await card.getByTestId('research-table-output').getByText('0.108', { exact: true }).count(),
        1,
        'The original chat card must keep the old run',
      );
      await page.screenshot({ path: `${screenshots}/embedded-analysis-version-${locale}.png` });
      await detail.getByRole('button', { name: copy.continue, exact: true }).click();
      await page.waitForURL('**/research?document=*');
      await page.getByTestId('embedded-research-source').waitFor();
      await page.getByTestId('research-run-all').click();
      await page
        .locator('.jx-research-document')
        .getByTestId('research-table-output')
        .getByText('0.096', { exact: true })
        .waitFor();
      const documentId = new URL(page.url()).searchParams.get('document');
      const response = await context.request.get(
        `${base}/api/app/research/documents/${documentId}`,
      );
      assert.equal(response.status(), 200);
      const document = await response.json();
      assert.equal(document.embeddedSource.inputMode, 'retained');
      assert.ok(document.cells.some((cell) => cell.source.includes('upper_bucket')));
      assert.ok(document.cells[0].source.startsWith(`# ${document.title}\n`));
      assert.ok(!document.cells[0].source.includes(`{${document.embeddedSource.runId}}`));
      await page.screenshot({ path: `${screenshots}/embedded-analysis-research-${locale}.png` });
      // A second report is an explicit source for a normal comparison question.
      await page.goto(`${base}/factors?factor=ep&report=${ready.sessions[locale].reportIds[0]}`);
      await page
        .getByTestId('embedded-analysis-toolbar')
        .getByRole('button', { name: english ? 'Reference data' : '引用数据', exact: true })
        .click();
      const catalog = page.locator('.jx-researchDataCatalog');
      await catalog.getByText(english ? 'Factor reports' : 'Factor 报告', { exact: true }).click();
      await catalog
        .getByTestId(`research-data-catalog-report-${ready.sessions[locale].reportIds[1]}`)
        .click();
      await catalog.getByTestId('research-data-catalog-insert').click();
      const compareQuestion = english
        ? 'Compare the group return spread in the selected report with the report I referenced. Calculate their difference.'
        : '比较当前报告与我引用的另一份报告，计算两份报告的最高组减最低组收益差有多大变化。';
      await page.locator('.jx-factor-chatBox').fill(compareQuestion);
      await page.locator('.jx-factor-chatBox').press('Enter');
      await page
        .getByTestId('embedded-analysis-card')
        .last()
        .getByTestId('research-table-output')
        .getByText('0.045', { exact: true })
        .waitFor();
      await page.locator('.jx-agentPending-status').waitFor({ state: 'hidden' });
      assert.equal(await page.getByTestId('embedded-analysis-card').count(), 2);
      await page.screenshot({ path: `${screenshots}/embedded-analysis-reference-${locale}.png` });
      await page.goto(
        `${base}/strategy?id=embeddedstrategy${locale}&report=embedded-backtest-${locale}`,
      );
      await page.locator('.jx-strategy-chatBox').fill(copy.strategy);
      await page.locator('.jx-strategy-chatBox').press('Enter');
      await card.getByTestId('research-table-output').getByText('0.1', { exact: true }).waitFor();
      await assertValueInsideCard(card, '0.1');
      await card.getByTestId('research-image-output').locator('img').waitFor();
      await card
        .getByTestId('research-image-output')
        .locator('img')
        .evaluate((image) => image.decode());
      await page.locator('.jx-agentPending-status').waitFor({ state: 'hidden' });
      await page.screenshot({ path: `${screenshots}/embedded-analysis-strategy-${locale}.png` });
      // Open an existing conversation, then refresh it: old charts still re-query safely.
      const chartResponses = [];
      const collectChartResponse = (response) => {
        if (/\/api\/app\/agent\/(sql-queries|chart-computations)$/.test(response.url())) {
          chartResponses.push(response.json());
        }
      };
      page.on('response', collectChartResponse);
      await page.goto(`${base}/strategy?id=legacycharts${locale}`);
      const legacy = page.locator('.jx-chatChart');
      await legacy.first().locator('canvas').waitFor();
      await legacy.nth(1).locator('canvas').waitFor();
      await legacy
        .nth(2)
        .getByText(english ? 'No data' : '暂无数据', { exact: true })
        .waitFor();
      assert.equal(await legacy.count(), 3);
      assert.equal(await legacy.locator('.jx-chatChart-sourceNote').count(), 3);
      assert.ok((await legacy.first().innerText()).includes(english ? 'current data' : '当前数据'));
      const replayRows = (await Promise.all(chartResponses)).map((response) => response.rows);
      assert.ok(
        replayRows.some((rows) => rows.length === 3 && rows.every((row) => row.close === 10)),
      );
      assert.ok(
        replayRows.some((rows) => rows.length === 3 && rows.every((row) => row.value === 100)),
      );
      assert.ok(replayRows.some((rows) => rows.length === 0));
      await page.reload();
      await legacy.nth(1).locator('canvas').waitFor();
      await legacy
        .nth(2)
        .getByText(english ? 'No data' : '暂无数据', { exact: true })
        .waitFor();
      assert.equal(await legacy.count(), 3);
      await page.locator('.jx-strategy-editor .monaco-editor').waitFor();
      await legacy.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${screenshots}/embedded-analysis-history-${locale}.png` });
      await legacy.nth(2).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${screenshots}/embedded-analysis-history-empty-${locale}.png`,
      });
      page.off('response', collectChartResponse);
      assert.deepEqual(errors, []);
      console.log(
        `[embedded-analysis:${locale}] report → Python table/chart → revised version → retained Research → Strategy → historical charts: passed`,
      );
    } catch (error) {
      await page
        .screenshot({ path: `${screenshots}/embedded-analysis-failure-${locale}.png` })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
} catch (error) {
  console.error('Embedded analysis journey failed:', error);
  throw error;
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

async function assertValueInsideCard(card, value) {
  const cardBounds = await card.boundingBox();
  const valueBounds = await card
    .getByTestId('research-table-output')
    .getByText(value, { exact: true })
    .boundingBox();
  assert.ok(cardBounds && valueBounds);
  assert.ok(
    valueBounds.x >= cardBounds.x &&
      valueBounds.x + valueBounds.width <= cardBounds.x + cardBounds.width,
    'A small result table must show its value inside the chat card without horizontal scrolling',
  );
}
