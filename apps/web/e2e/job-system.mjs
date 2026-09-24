import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { executeCommand } from '../../../scripts/e2e/run.mjs';

// Browser journeys share only synthetic market data. Every task submission, status, log and result
// uses the real API and scheduler. Existing race/unsaved-draft injections remain local to their tests.
const apiDirectory = fileURLToPath(new URL('../../api/', import.meta.url));
const require = createRequire(new URL('../../api/package.json', import.meta.url));
const screenshots = fileURLToPath(new URL('../acceptance/', import.meta.url));
await mkdir(screenshots, { recursive: true });
const log = createWriteStream(`${screenshots}/job-system-server.log`);
const server = fork(`${apiDirectory}/tests/job-system-e2e-server.ts`, [], {
  cwd: apiDirectory,
  execArgv: ['--conditions=development', '--import', require.resolve('tsx')],
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
let ready;
let browser;
try {
  ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Job fixture startup timed out')), 120_000);
    server.on('message', (message) => {
      if (message.type === 'ready' || message.type === 'error') {
        clearTimeout(timer);
        if (message.type === 'error') {
          reject(new Error(message.message));
        } else {
          resolveReady(message);
        }
      }
    });
    server.once('error', reject);
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture exited: ${code}`));
    });
  });
  process.env.E2E_BASE = ready.base;
  process.env.DATABASE_URL = ready.databaseUrl;
  process.env.E2E_ISOLATED_DB = '1';
  // Selection supports rerunning a failing journey against a newly migrated, disposable database.
  const selected = process.env.JIXIE_JOB_E2E_ONLY?.split(',');
  for (const name of [
    'strategy-orchestration',
    'strategy-parameter-scan',
    'factor-report-history',
    'factor-correlation',
    'daily-signals',
    'backtest-report-history',
  ]) {
    if (selected && !selected.includes(name)) {
      continue;
    }
    const code = await executeCommand({ name, file: `apps/web/e2e/${name}.mjs` });
    assert.equal(code, 0, `${name} failed`);
    console.log(`[job-system] ${name}: passed`);
  }
  if (!selected || selected.includes('factor-analysis')) {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const login = await context.request.post(`${ready.base}/api/auth/dev/login`, {
        data: { email: 'jobs-factor-ui@example.invalid' },
      });
      assert.equal(login.status(), 200);
      await page.goto(`${ready.base}/factors?factor=ep`);
      await page.locator('.jx-factor-runButton').click();
      const card = page.locator('.jx-factor-researchModal');
      await card.getByText('纯探索', { exact: true }).click();
      const submitted = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/app/factors/analyses',
      );
      await card.getByRole('button', { name: '冻结研究卡并运行', exact: true }).click();
      const response = await submitted;
      assert.equal(response.status(), 200);
      const reference = await response.json();
      assert.ok(reference.jobId && reference.reportId);
      await page.locator('.jx-factor-methodology').waitFor({ timeout: 120_000 });
      const result = await (
        await context.request.get(
          `${ready.base}/api/app/factors/analysis-reports/${reference.reportId}`,
        )
      ).json();
      assert.equal(result.status, 'done', JSON.stringify(result.error));
      assert.ok(result.payload?.periods > 0);
      const job = await (
        await context.request.get(`${ready.base}/api/app/factors/analysis-jobs/${reference.jobId}`)
      ).json();
      assert.equal(job.status, 'done');
      assert.ok(job.logs.length > 0);
      await page.screenshot({
        path: `${screenshots}/job-system-factor-analysis.png`,
        fullPage: true,
      });
      await page.reload();
      await page.locator('.jx-factor-methodology').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('report'), reference.reportId);
      assert.deepEqual(errors, []);
      console.log(
        '[job-system] factor-analysis: UI research card, real Worker, logs, report and reload passed',
      );
    } catch (error) {
      await page
        .screenshot({ path: `${screenshots}/job-system-factor-error.png`, fullPage: true })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
      await browser.close();
      browser = undefined;
    }
  }
  if (!selected || selected.includes('research-curator')) {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });
    try {
      await page.goto(ready.base);
      const login = await context.request.post(`${ready.base}/api/auth/dev/login`, {
        data: { email: 'jobs-curator@example.invalid' },
      });
      assert.equal(login.status(), 200);
      await page.goto(`${ready.base}/research`);
      await page.getByRole('button', { name: '整理研究记录', exact: true }).click();
      const submitted = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/app/research/curator/runs',
      );
      await page.getByRole('button', { name: '开始整理', exact: true }).click();
      const reference = await (await submitted).json();
      assert.ok(reference.jobId);
      const card = page
        .locator('.jx-researchCurator-finding')
        .filter({ hasText: '复权收益与滚动相关研究模板' });
      await card.waitFor({ timeout: 30_000 });
      const result = await (
        await context.request.get(`${ready.base}/api/app/research/curator/runs/${reference.id}`)
      ).json();
      assert.equal(result.status, 'done');
      assert.equal(result.evidenceCount, 1);
      assert.equal(result.findingsCreated, 1);
      await card.getByRole('button', { name: '核验正确', exact: true }).click();
      await card.getByRole('button', { name: '接受', exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('.jx-researchCurator-finding button[aria-label="接受"]')?.disabled,
      );
      await page.locator('.jx-researchCurator-title').click({ trial: true });
      await page.locator('.jx-researchCurator .ant-drawer-body').evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `${screenshots}/job-system-curator-zh.png`,
        fullPage: true,
        animations: 'disabled',
      });
      const verificationNotes = card.locator('.jx-researchCurator-verificationNotes');
      assert.doesNotMatch(await verificationNotes.innerText(), /curator\.verificationNote\./);
      await verificationNotes.getByText('已匹配跨市场数据契约登记信息', { exact: false }).waitFor();
      await verificationNotes.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${screenshots}/job-system-curator-notes-zh.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.reload();
      await page.getByRole('button', { name: '整理研究记录', exact: true }).click();
      await card.waitFor();
      assert.equal(
        await card.getByRole('button', { name: '接受', exact: true }).isDisabled(),
        true,
      );
      await page
        .locator('.jx-researchCurator')
        .getByRole('button', { name: '关闭', exact: true })
        .click();
      await page.getByText('EN', { exact: true }).click();
      await page.getByRole('button', { name: 'Curate research records' }).click();
      await card.waitFor();
      await page.locator('.jx-researchCurator-title').click({ trial: true });
      await page.locator('.jx-researchCurator .ant-drawer-body').evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `${screenshots}/job-system-curator-en.png`,
        fullPage: true,
        animations: 'disabled',
      });
      assert.doesNotMatch(await verificationNotes.innerText(), /curator\.verificationNote\./);
      await verificationNotes
        .getByText('Matched a registered cross-market data contract', { exact: false })
        .waitFor();
      await verificationNotes.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${screenshots}/job-system-curator-notes-en.png`,
        fullPage: true,
        animations: 'disabled',
      });
      assert.deepEqual(errors, []);
      console.log(
        '[job-system] research-curator: submit, real lifecycle, finding transaction, review and reload passed',
      );
    } catch (error) {
      await page
        .screenshot({ path: `${screenshots}/job-system-curator-error.png`, fullPage: true })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
} catch (error) {
  console.error('[job-system] journey failed', error);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const closed = once(server, 'exit');
    server.send({ type: 'stop' });
    const timer = setTimeout(() => server.kill('SIGKILL'), 30_000);
    try {
      const [code, signal] = await closed;
      assert.equal(signal, null, 'Fixture did not stop cleanly');
      assert.equal(code, 0, 'Fixture cleanup failed');
    } finally {
      clearTimeout(timer);
    }
  }
  log.end();
  for (const base of [ready?.base, ready?.modelBase].filter(Boolean)) {
    await assert.rejects(
      new Promise((resolveConnected, reject) => {
        const socket = createConnection(Number(new URL(base).port), '127.0.0.1');
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
