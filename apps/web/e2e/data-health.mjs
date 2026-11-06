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
const issueTable = page.locator('.jx-dataHealth-issues');
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
let scenario = 'pending';
let candidate;
let detailsFail = false;
let detailCalls = 0;
let publisher = false;
let published = false;
let publicationActive = false;
let publicationReads = 0;
let publicationCalls = 0;
let rejectVersionOnce = true;
let candidateVersion = 'a'.repeat(64);
const candidateRunId = '01M6NTTSCH4423N5VQ2F2CG8R6';
const dividendHash = '56cce440712ebe1a91a0001efd0b7d279af61950f0a5f387bdb2a3fdf8da9cc0';
const dividendKey = JSON.stringify(JSON.stringify([dividendHash]));
const dividendMessage = `Duplicate or conflicting business key ${JSON.stringify([dividendHash])}`;
const priceKey = JSON.stringify({ tsCode: '000003.SZ', tradeDate: '19920131' });
const publishingStatus = { active: true, phase: 'publishing', retryAfterSeconds: 5 };
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
  runId: published ? candidateRunId : 'finished-run',
  kind: 'ingestion',
  targetDate: published ? '20190120' : '20181231',
  stage: null,
  startedAt: '2026-11-02T23:19:43Z',
  heartbeatAt: null,
  error: null,
  retryAfterSeconds: 0,
  revision: 34962,
  candidate,
  health: {
    latestRun: {
      id: published ? candidateRunId : 'finished-run',
      status: published ? 'completed' : 'completed_with_issues',
      targetDate: published ? '20190120' : '20181231',
      finishedAt: '2026-11-03T19:44:05Z',
      execution: published
        ? { succeeded: 835, partial: 0, failed: 0, rejected: 0 }
        : { succeeded: 32310, partial: 2, failed: 0, rejected: 6 },
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
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      if (publicationActive && url.pathname.startsWith('/api/app/')) {
        publicationReads++;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'Retry-After': '5' },
          body: JSON.stringify({
            error: { code: 'MAINTENANCE', message: '正在发布数据。', details: publishingStatus },
          }),
        });
        return;
      }

      let body;
      switch (url.pathname) {
        case '/api/auth/me':
          body = {
            user: {
              id: 'viewer',
              email: 'viewer@example.test',
              name: null,
              capabilities: { publishIngestion: publisher },
            },
          };
          break;
        case `/api/ingestion/runs/${candidateRunId}`:
          body = {
            runId: candidateRunId,
            targetDate: '20190120',
            phase: 'awaiting_publish',
            status: 'completed',
            pending: 0,
            candidateVersion,
            finishedAt: '2026-11-05T09:05:00Z',
            execution: {
              succeeded: 835,
              partial: 0,
              failed: 0,
              rejected: 0,
              issues: 0,
              warnings: 0,
            },
          };
          break;
        case `/api/ingestion/runs/${candidateRunId}/accept`: {
          publicationCalls++;
          assert.equal(route.request().method(), 'POST');
          assert.equal(route.request().postDataJSON().expectedCandidateVersion, candidateVersion);
          if (rejectVersionOnce) {
            rejectVersionOnce = false;
            candidateVersion = 'b'.repeat(64);
            await route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({
                error: { code: 'CONFLICT', message: '副本版本已变化，请重新核验。' },
              }),
            });
            return;
          }
          published = true;
          candidate = undefined;
          body = { mode: 'published', runId: candidateRunId, revision: 34963 };
          break;
        }
        case '/api/ingestion/status':
          body = publicationActive ? publishingStatus : status();
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
              scope: index < 3 ? '300587.SZ' : 'SSE,SZSE',
              period: index < 3 ? 'all' : '19920131',
              businessKey:
                index < 3 ? dividendKey : index === 3 ? JSON.stringify(priceKey) : priceKey,
              reasonCode: index < 3 ? 'conflicting_business_key' : 'ohlc_range_inconsistent',
              message: index < 3 ? dividendMessage : 'Inconsistent OHLC range',
              status:
                scenario !== 'pending' && index >= 3
                  ? 'resolved'
                  : allHandled()
                    ? 'accepted'
                    : 'pending',
              verification: scenario === 'repaired' && index >= 3 ? 'verified' : null,
              handlingReason:
                scenario !== 'pending' && index >= 3
                  ? '采用对齐口径的第三方实际报价'
                  : allHandled() && index < 3
                    ? '保留来源诊断，沿用已接纳的数据'
                    : null,
              resolvedAt:
                (scenario !== 'pending' && index >= 3) || (allHandled() && index < 3)
                  ? '2026-11-04T06:00:00Z'
                  : null,
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
    },
  );
  await page.goto(`${base}/strategy`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).waitFor();
  assert.equal(detailCalls, 0);
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).click();
  await page.getByText('待处理错误 3 · 待处理警告 8 · 已修复 0 · 确认保留 0').first().waitFor();
  await issueTable.getByText('OHLC 价格范围不一致', { exact: true }).last().waitFor();
  assert.equal(await issueTable.getByText('000003.SZ · 1992-01-31 · 股票行情').count(), 8);
  assert.equal(await issueTable.getByText(dividendHash, { exact: false }).count(), 0);
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
  const mobileDividend = issueTable
    .getByRole('row')
    .filter({ hasText: 'Conflicting business key' })
    .first();
  await mobileDividend
    .locator('.jx-dataHealth-issueTags')
    .getByText('Pending', { exact: true })
    .waitFor();
  await assertIssueTableFits();
  await mobileDividend.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/repaired-en-mobile.png`, animations: 'disabled' });
  await mobileDividend.locator('.ant-table-row-expand-icon').click();
  await issueTable.getByText(dividendMessage, { exact: true }).waitFor();
  await assertIssueTableFits();
  await issueTable.getByText(dividendMessage, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/issue-details-en-mobile.png`, animations: 'disabled' });
  await mobileDividend.locator('.ant-table-row-expand-icon').click();
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
  const desktopDividend = issueTable.getByRole('row').filter({ hasText: '业务键冲突' }).first();
  await desktopDividend.getByText('确认保留', { exact: true }).waitFor();
  await assertIssueTableFits();
  await desktopDividend.locator('.ant-table-row-expand-icon').click();
  await issueTable.getByText(dividendMessage, { exact: true }).waitFor();
  const key = issueTable.getByText(dividendKey, { exact: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await key.locator('.ant-typography-copy').click();
  await page.waitForFunction(
    async (value) => (await navigator.clipboard.readText()) === value,
    dividendKey,
  );
  await assertIssueTableFits();
  await key.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/issue-details-zh.png`, animations: 'disabled' });
  await page.locator('.ant-drawer-close').click();
  candidate = { runId: 'reviewed-candidate', targetDate: '20190120', phase: 'awaiting_publish' };
  await page.getByText('副本待接收', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).click();
  await page
    .getByText('工作副本 reviewed-candidate，目标日期 20190120。问题修复使用 CLI。', {
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: `${output}/candidate-review-zh.png`, animations: 'disabled' });
  assert.equal(await page.getByRole('button', { name: '接收副本', exact: true }).count(), 0);
  candidate = { runId: candidateRunId, targetDate: '20190120', phase: 'awaiting_repair' };
  publisher = true;
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).click();
  assert.equal(
    await page.getByRole('button', { name: '接收副本', exact: true }).isDisabled(),
    true,
  );
  candidate.phase = 'awaiting_publish';
  await page.getByRole('button', { name: '接收副本', exact: true }).click();
  const dialog = page.locator('.ant-modal');
  await dialog.getByText('成功 835 · 部分接纳 0 · 失败 0 · 未接纳记录 0').waitFor();
  await settleDialog();
  await page.screenshot({ path: `${output}/candidate-accept-zh.png`, animations: 'disabled' });
  await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.locator('.ant-drawer-close').click();
  await page.getByText('EN', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'View data updates and issue handling' }).click();
  await page.getByRole('button', { name: 'Accept candidate', exact: true }).click();
  await dialog.getByText('Succeeded 835 · Partial 0 · Failed 0 · Rejected records 0').waitFor();
  await settleDialog();
  await page.screenshot({
    path: `${output}/candidate-accept-en-mobile.png`,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.ant-drawer-close').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText('中', { exact: true }).click();
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).click();
  await page.getByRole('button', { name: '接收副本', exact: true }).click();
  const refreshedReview = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/ingestion/runs/${candidateRunId}` &&
      response.request().method() === 'GET',
  );
  await dialog.getByRole('button', { name: '接收并发布', exact: true }).click();
  await dialog.getByText('副本版本已变化，请重新核验。', { exact: true }).waitFor();
  await refreshedReview;
  await dialog.locator('.ant-btn-loading-icon').waitFor({ state: 'detached' });
  assert.equal(publicationCalls, 1);
  await settleDialog();
  await page.screenshot({
    path: `${output}/candidate-version-conflict-zh.png`,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: '接收并发布', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText(candidateRunId, { exact: true }).waitFor();
  assert.equal(publicationCalls, 2);
  await page.screenshot({ path: `${output}/candidate-published-zh.png`, animations: 'disabled' });

  await page.locator('.ant-drawer-close').click();
  const currentUrl = page.url();
  publicationActive = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '系统正在维护', exact: true }).waitFor();
  await page.getByText('发布新版市场数据', { exact: true }).waitFor();
  assert.equal(await page.getByText('服务暂时不可用', { exact: true }).count(), 0);
  await page.screenshot({ path: `${output}/publishing-refresh-zh.png`, animations: 'disabled' });

  const resumed = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  });
  publicationActive = false;
  await resumed;
  await page.getByRole('button', { name: '查看数据更新与问题处理进度' }).waitFor();
  await page.locator('.jx-maintenanceGate').waitFor({ state: 'detached' });
  assert.equal(page.url(), currentUrl);
  assert.equal(publicationReads, 0);
  await page.screenshot({ path: `${output}/publishing-recovered-zh.png`, animations: 'disabled' });

  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      output,
      screenshots: [
        'pending-zh.png',
        'repaired-zh.png',
        'repaired-en-mobile.png',
        'issue-details-en-mobile.png',
        'covered-history-zh.png',
        'issue-details-zh.png',
        'candidate-review-zh.png',
        'candidate-accept-zh.png',
        'candidate-accept-en-mobile.png',
        'candidate-version-conflict-zh.png',
        'candidate-published-zh.png',
        'publishing-refresh-zh.png',
        'publishing-recovered-zh.png',
      ],
      detailCalls,
    }),
  );
} catch (error) {
  console.error({
    url: page.url(),
    failures,
    visibleText: (await page.locator('body').innerText()).slice(0, 2000),
    dialogButtons: await page
      .locator('.ant-modal button')
      .evaluateAll((buttons) => buttons.map((button) => button.outerHTML)),
  });
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await context.close();
  await browser.close();
}

async function assertIssueTableFits() {
  await page.waitForFunction(() => {
    const drawer = document.querySelector('.ant-drawer-content-wrapper');

    return drawer && !/(?:appear|enter|leave)(?:-|\s|$)/.test(drawer.className);
  });
  const widths = await issueTable.locator('.ant-table-content').evaluate((element) => {
    const right = element.getBoundingClientRect().right;
    const drawerRight = element.closest('.ant-drawer-body').getBoundingClientRect().right;

    return {
      content: element.clientWidth,
      scroll: element.scrollWidth,
      overhang: Math.round(right - Math.min(drawerRight, document.documentElement.clientWidth)),
    };
  });
  assert.ok(
    widths.content > 0 && widths.scroll <= widths.content && widths.overhang <= 0,
    JSON.stringify(widths),
  );
}

// 等待弹窗进入动画结束，避免截图捕获透明的准备帧。
// Wait for modal entry motion to finish instead of capturing its transparent preparation frame.
async function settleDialog() {
  await page.waitForFunction(() => {
    const modal = document.querySelector('.ant-modal');
    if (!modal) {
      return false;
    }
    const moving = /(?:appear|enter|leave)(?:-|\s|$)/.test(modal.className);

    return !moving && getComputedStyle(modal).opacity === '1';
  });
}
