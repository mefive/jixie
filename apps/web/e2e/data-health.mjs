import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// 仅在审阅后运行：浏览器接口使用确定性夹具，不访问工作库或真实来源。
// Post-review only: deterministic browser API fixtures never access the working database or providers.
const base = process.env.E2E_BASE ?? 'http://127.0.0.1:5186';
const output = resolve(process.env.E2E_OUTPUT ?? '/private/tmp/jixie-data-health-e2e');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
let scenario = 'pending';
let candidate;
let detailsFail = false;
let detailCalls = 0;
const allHandled = () => scenario === 'review' || scenario === 'archived';
const counts = () => ({
  pending: { error: allHandled() ? 0 : 3, warning: scenario === 'pending' ? 8 : 0 },
  resolved: { error: 0, warning: scenario === 'pending' ? 0 : 8 },
  accepted: { error: allHandled() ? 3 : 0, warning: 0 },
});
const status = () => ({
  active: false,
  running: false,
  phase: 'idle',
  runId: 'finished-run',
  kind: 'ingestion',
  targetDate: '20181231',
  stage: null,
  startedAt: '2026-11-02T23:19:43Z',
  heartbeatAt: null,
  error: null,
  retryAfterSeconds: 0,
  revision: 34962,
  candidate,
  health: {
    latestRun: {
      id: 'finished-run',
      status: 'completed_with_issues',
      targetDate: '20181231',
      finishedAt: '2026-11-03T19:44:05Z',
      execution: { succeeded: 32310, partial: 2, failed: 0, rejected: 6 },
      handling: counts(),
    },
    handling: counts(),
    unknownValidity: scenario === 'review' ? 1 : 0,
    coveredHistorical: allHandled() ? 20 : 0,
    missingResolutionRecords: 0,
  },
});

try {
  await page.addInitScript(() => localStorage.setItem('jx-locale', 'zh'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body;
    switch (url.pathname) {
      case '/api/auth/me':
        body = { user: { id: 'viewer', email: 'viewer@example.test', name: null } };
        break;
      case '/api/ingestion/status':
        body = status();
        break;
      case '/api/ingestion/version':
        body = { revision: 'reviewed-fixture' };
        break;
      case '/api/ingestion/issues':
        detailCalls++;
        if (detailsFail) {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'INTERNAL', message: 'fixture failure' } }),
          });
          return;
        }
        body = {
          total: 11,
          offset: 0,
          limit: 20,
          items: Array.from({ length: 11 }, (_value, index) => ({
            id: `issue-${index}`,
            runId: 'finished-run',
            targetDate: '20181231',
            severity: index < 3 ? 'error' : 'warning',
            dataset: index < 3 ? 'dividends' : 'stock-prices',
            scope: index < 3 ? '300587.SZ' : '000003.SZ',
            period: '19920131',
            businessKey: index < 3 ? '20181231' : '19920131',
            reasonCode: index < 3 ? 'conflicting_business_key' : 'ohlc_range_inconsistent',
            message: index < 3 ? 'Conflicting cash values' : 'Inconsistent OHLC range',
            status:
              scenario !== 'pending' && index >= 3
                ? 'resolved'
                : allHandled()
                  ? 'accepted'
                  : 'pending',
            verification: scenario === 'repaired' && index >= 3 ? 'verified' : null,
            handlingReason:
              scenario === 'repaired' && index >= 3 ? '采用对齐口径的第三方实际报价' : null,
            resolvedAt: scenario === 'repaired' && index >= 3 ? '2026-11-04T06:00:00Z' : null,
          })),
        };
        break;
      default:
        body = [];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto(`${base}/strategy`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).waitFor();
  assert.equal(detailCalls, 0);
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).click();
  await page.getByText('待处理错误 3 · 待处理警告 8 · 已修复 0 · 确认保留 0').first().waitFor();
  await page.getByText('Inconsistent OHLC range', { exact: true }).last().waitFor();
  await page.screenshot({ path: `${output}/pending-zh.png`, animations: 'disabled' });
  scenario = 'repaired';
  await page.getByRole('button', { name: /^刷\s*新$/ }).click();
  await page.getByText('已修复', { exact: true }).first().waitFor();
  await page
    .getByText('待处理错误 3 · 待处理警告 0 · 已修复 8 · 确认保留 0')
    .first()
    .waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${output}/repaired-zh.png`, animations: 'disabled' });
  detailsFail = true;
  await page.getByRole('button', { name: /^刷\s*新$/ }).click();
  await page.getByText('问题详情加载失败，请刷新重试。', { exact: true }).waitFor();
  detailsFail = false;
  await page.getByRole('button', { name: /^刷\s*新$/ }).click();
  await page.getByText('已修复', { exact: true }).first().waitFor();
  await page.locator('.ant-drawer-close').click();
  await page.getByText('EN', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'View data updates and issue handling' }).click();
  await page
    .getByText('Pending errors 3 · Pending warnings 0 · Repaired 8 · Accepted 0')
    .first()
    .waitFor();
  await page.screenshot({ path: `${output}/repaired-en-mobile.png`, animations: 'disabled' });
  await page.locator('.ant-drawer-close').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText('中', { exact: true }).click();
  scenario = 'review';
  await page.getByText('数据 · 1 项待复核', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).click();
  await page.getByText('待复核 1 项，覆盖证据尚不足。', { exact: true }).waitFor();
  await page.getByText('待处理错误 0 · 待处理警告 0 · 已修复 8 · 确认保留 3').first().waitFor();
  await page.locator('.ant-drawer-close').click();
  scenario = 'archived';
  await page.getByText('数据已更新', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).click();
  await page.getByText('后续采集已覆盖 20 条历史诊断。', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/covered-history-zh.png`, animations: 'disabled' });
  await page.locator('.ant-drawer-close').click();
  candidate = { runId: 'reviewed-candidate', targetDate: '20190120', phase: 'awaiting_publish' };
  await page.getByText('副本待接收', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).click();
  await page
    .getByText('工作副本 reviewed-candidate，目标日期 20190120。审核和修复使用 CLI。', {
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: `${output}/candidate-review-zh.png`, animations: 'disabled' });
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      output,
      screenshots: [
        'pending-zh.png',
        'repaired-zh.png',
        'repaired-en-mobile.png',
        'covered-history-zh.png',
        'candidate-review-zh.png',
      ],
      detailCalls,
    }),
  );
} catch (error) {
  console.error({
    url: page.url(),
    failures,
    visibleText: (await page.locator('body').innerText()).slice(0, 2000),
  });
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
