import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const now = new Date().toISOString();
const finding = {
  version: 1,
  id: 'curator-finding-1',
  runId: 'curator-run-1',
  category: 'method_candidate',
  title: '沉淀月度复权收益研究方法模板',
  summary: '多次研究都需要月度复权收益、滚动相关和 Newey–West 回归。',
  evidence: [
    {
      id: 'message:evidence-1',
      sourceType: 'message',
      sourceId: 'evidence-1',
      conversationId: 'conversation-1',
      occurredAt: now,
      excerpt: '沪深300和中证500过去五年的月收益相关吗？请给出滚动相关和回归结果。',
      signals: ['method'],
    },
  ],
  verification: {
    status: 'verified',
    matches: [{ kind: 'research_measure', id: 'market.adjusted_close' }],
    notes: ['local_capability_match'],
    evidence: [
      {
        stance: 'supports',
        kind: 'catalog',
        reference: 'research-measure:market.adjusted_close',
        detailZh: '研究能力目录已有“复权收盘价”指标。',
        detailEn: 'The research capability catalog already contains adjusted close.',
      },
      {
        stance: 'supports',
        kind: 'repository',
        reference: 'apps/docs/src/content/help/zh/basics/time-series-relationships.md:8',
        detailZh: '帮助中心已有时间序列关系研究说明。',
        detailEn: 'The help center contains a time-series relationship guide.',
      },
    ],
  },
  confidence: 0.91,
  expectedValue: '把重复需求变为确定、可测试、可重跑的通用研究流程。',
  changeSurface: ['研究方法模板', 'Research Agent'],
  suggestedAction: '人工评审后形成透明的 Markdown 与 Python 研究模板。',
  fingerprint: 'curator-fingerprint-1',
  disposition: 'pending',
  createdAt: now,
};

const runningRun = {
  version: 1,
  id: 'curator-run-1',
  jobId: 'curator-job-1',
  status: 'running',
  trigger: 'manual',
  cursorTo: now,
  evidenceCount: 0,
  findingsCreated: 0,
  duplicatesSkipped: 0,
  quality: {
    totalFindings: 0,
    pending: 0,
    deferred: 0,
    reviewed: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    duplicatesSkipped: 0,
    acceptanceRate: null,
    duplicateRate: null,
    verificationAssessments: 0,
    verificationErrors: 0,
    verificationErrorRate: null,
    evaluationReady: false,
    minimumReviewedFindings: 20,
    minimumVerificationAssessments: 20,
  },
  findings: [],
  createdAt: now,
};

const doneRun = {
  ...runningRun,
  status: 'done',
  evidenceCount: 7,
  findingsCreated: 1,
  duplicatesSkipped: 2,
  quality: {
    ...runningRun.quality,
    totalFindings: 1,
    pending: 1,
    duplicatesSkipped: 2,
    duplicateRate: 2 / 3,
  },
  findings: [finding],
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-research-curator@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  let latestRun = null;
  let pollCount = 0;
  await page.route('**/api/app/research/conversations', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/app/research/curator/runs/latest', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(latestRun),
    }),
  );
  await page.route('**/api/app/research/curator/runs', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    latestRun = runningRun;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(runningRun),
    });
  });
  await page.route('**/api/app/research/curator/runs/curator-run-1', (route) => {
    pollCount++;
    latestRun = pollCount >= 2 ? doneRun : runningRun;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(latestRun),
    });
  });
  await page.route('**/api/app/research/curator/findings/curator-finding-1', (route) => {
    const input = route.request().postDataJSON();
    if (input.disposition) {
      finding.disposition = input.disposition;
      doneRun.quality = {
        ...doneRun.quality,
        pending: 0,
        reviewed: 1,
        accepted: input.disposition === 'accepted' ? 1 : 0,
        rejected: input.disposition === 'rejected' ? 1 : 0,
        acceptanceRate: input.disposition === 'accepted' ? 1 : 0,
      };
    }
    if (input.verificationAssessment) {
      finding.verificationAssessment = input.verificationAssessment;
      doneRun.quality = {
        ...doneRun.quality,
        verificationAssessments: 1,
        verificationErrors: input.verificationAssessment === 'incorrect' ? 1 : 0,
        verificationErrorRate: input.verificationAssessment === 'incorrect' ? 1 : 0,
      };
    }
    doneRun.findings = [finding];
    latestRun = doneRun;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(finding),
    });
  });

  await page.goto(`${BASE}/research`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '整理研究记录' }).click();
  await page.getByText('只读分析', { exact: false }).waitFor();
  if ((await page.getByText(/转因子/).count()) !== 0) {
    throw new Error('factor-conversion controls must not appear in the research curator');
  }
  await page.getByRole('button', { name: '开始整理' }).click();
  const card = page.locator('.jx-researchCurator-finding').filter({ hasText: finding.title });
  await card.waitFor({ timeout: 10_000 });
  await card.getByRole('button', { name: '核验正确' }).click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('button')];
    return (
      buttons.some(
        (button) => button.getAttribute('aria-label') === '核验正确' && button.disabled,
      ) &&
      buttons.some((button) => button.getAttribute('aria-label') === '核验有误' && !button.disabled)
    );
  });
  if (!(await card.getByRole('button', { name: '核验正确' }).isDisabled())) {
    throw new Error('Curator verification assessment was not retained');
  }
  await card.getByRole('button', { name: '接受' }).click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('button')];
    return (
      buttons.some((button) => button.getAttribute('aria-label') === '接受' && button.disabled) &&
      buttons.some((button) => button.getAttribute('aria-label') === '拒绝' && !button.disabled)
    );
  });
  if (!(await card.getByRole('button', { name: '接受' }).isDisabled())) {
    throw new Error('accepted Curator disposition was not retained');
  }
  const drawerBody = page.locator('.jx-researchCurator .ant-drawer-body');
  await drawerBody.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}research-curator-summary-zh.png`, fullPage: true });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-curator-zh.png`, fullPage: true });

  await page.getByLabel('Close').click();
  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('button', { name: 'Curate research records' }).click();
  await page.getByText('Read-only analysis', { exact: false }).waitFor();
  await page.getByText('Source evidence', { exact: true }).last().waitFor();
  await page.locator('.jx-researchCurator').waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}research-curator-en.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(650);
  const drawerBox = await page.locator('.jx-researchCurator').boundingBox();
  if (!drawerBox || drawerBox.width > 392 || drawerBox.x < -2) {
    throw new Error(
      `research Curator drawer overflows mobile viewport: ${JSON.stringify(drawerBox)}`,
    );
  }
  await page.locator('.jx-researchCurator .ant-drawer-body').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: `${SHOTS}research-curator-mobile.png`, fullPage: true });

  console.log(
    '[research-curator-e2e] manual run, polling, quality, verification evidence, assessment, disposition, and bilingual guardrails passed',
  );
} finally {
  await browser.close();
}
