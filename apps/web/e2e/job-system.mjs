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
const compiled = process.env.JIXIE_TEST_COMPILED === '1';
const fixtureEntry = compiled
  ? 'dist/tests/job-system-e2e-server.js'
  : 'tests/job-system-e2e-server.ts';
const server = fork(`${apiDirectory}/${fixtureEntry}`, [], {
  cwd: apiDirectory,
  execArgv: compiled ? [] : ['--conditions=development', '--import', require.resolve('tsx')],
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
    'research-executions',
    'research-mobile',
    'research-autosave',
    'strategy-orchestration',
    'mixed-futures',
    ...(selected?.includes('python-strategy') ? ['python-strategy'] : []),
    ...[
      'factor-publication',
      'python-factor',
      'strategy-factor-dependency',
      'market-weather-retirement',
      'research-extension-retirement',
      'research-financial-help',
      'maintenance-fallback',
    ].filter((name) => selected?.includes(name)),
    'strategy-parameter-scan',
    'factor-report-history',
    'backtest-latest-result',
    'research-backtest-report-catalog',
  ]) {
    if (selected && !selected.includes(name)) {
      continue;
    }
    const file = name === 'research-executions' ? 'research-execution' : name;
    const code = await executeCommand({ name, file: `apps/web/e2e/${file}.mjs` });
    assert.equal(code, 0, `${name} failed`);
    console.log(`[job-system] ${name}: passed`);
  }
  if (selected?.includes('docs-help')) {
    const code = await executeCommand({ name: 'docs-help', file: 'apps/docs/e2e/help.mjs' });
    assert.equal(code, 0, 'docs-help failed');
    console.log('[job-system] docs-help: passed');
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
      const submitted = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/app/factors/analyses',
      );
      await page.locator('.jx-factor-runButton').click();
      const response = await submitted;
      assert.equal(response.status(), 200);
      const reference = await response.json();
      assert.ok(reference.jobId && reference.reportId);
      assert.equal(await page.locator('.jx-factor-researchModal').count(), 0);
      assert.equal(await page.locator('.jx-factor-researchBar').count(), 0);
      await page.locator('.jx-factor-methodology').waitFor({ timeout: 120_000 });
      const result = await (
        await context.request.get(
          `${ready.base}/api/app/factors/analysis-reports/${reference.reportId}`,
        )
      ).json();
      assert.equal(result.status, 'done', JSON.stringify(result.error));
      assert.equal(result.spec.end, '20261231');
      for (const field of ['phase', 'sealed', 'researchIntent', 'holdout', 'canReveal']) {
        assert.equal(Object.hasOwn(result, field), false, field);
      }
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
      await page.evaluate(() => localStorage.setItem('jx-locale', 'en'));
      await page.reload();
      await page.locator('.jx-factor-methodology').waitFor();
      await page
        .locator('.jx-factor-runButton')
        .getByText(/Run analysis|Rerun/)
        .waitFor();
      assert.equal(await page.locator('.jx-factor-researchModal').count(), 0);
      assert.equal(await page.locator('.jx-factor-researchBar').count(), 0);
      await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
      await page.screenshot({
        path: `${screenshots}/job-system-factor-analysis-en.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      console.log(
        '[job-system] factor-analysis: direct UI analysis, real Worker, logs, report and reload passed',
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
