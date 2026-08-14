import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const spec = {
  version: 1,
  source: { kind: 'equity_market', market: 'CN' },
  asOf: { kind: 'latest_available' },
  eligibility: { minimumListedDays: 0, suspension: 'exclude', riskWarning: 'include' },
  predicates: [{ measure: 'equity.pe_ttm', measureVersion: 1, op: '<', value: 20 }],
  missing: 'exclude',
  sort: {
    measure: 'equity.total_market_cap_cny_10k',
    measureVersion: 1,
    direction: 'desc',
  },
  select: [
    { measure: 'equity.close', measureVersion: 1 },
    { measure: 'equity.pe_ttm', measureVersion: 1 },
    { measure: 'equity.total_market_cap_cny_10k', measureVersion: 1 },
  ],
  limit: 20,
};

const relationshipPlan = {
  version: 1,
  question: {
    version: 1,
    kind: 'time_series_relationship',
    text: '沪深300和中证500的月收益是否正相关？',
    hypothesis: {
      estimand: 'regression_slope',
      direction: 'positive',
      nullValue: 0,
    },
  },
  start: '20200101',
  end: '20251231',
  inputs: [
    {
      type: 'series',
      id: 'csi300',
      source: { kind: 'instrument', assetType: 'index', id: '000300.SH' },
      measure: 'market.adjusted_close',
      transform: 'simple_return',
      label: '沪深300',
    },
    {
      type: 'series',
      id: 'csi500',
      source: { kind: 'instrument', assetType: 'index', id: '000905.SH' },
      measure: 'market.adjusted_close',
      transform: 'simple_return',
      label: '中证500',
    },
  ],
  alignment: { frequency: 'monthly', join: 'inner', partialPeriod: 'exclude' },
  protocol: {
    kind: 'time_series_relationship',
    version: 1,
    predictor: 'csi300',
    outcome: 'csi500',
    predictorLag: 0,
    correlations: ['pearson', 'spearman'],
    inference: { kind: 'newey_west', lag: 'automatic' },
    rollingWindow: 24,
  },
  outputs: [
    { kind: 'summary_table' },
    { kind: 'scatter' },
    { kind: 'rolling_relationship' },
    { kind: 'conclusion' },
    { kind: 'formula' },
    { kind: 'python_example' },
    { kind: 'documentation' },
  ],
};

const distributionPlan = {
  version: 1,
  question: {
    version: 1,
    kind: 'distribution_comparison',
    text: '沪深300成分股的市净率是否高于中证500成分股？',
    hypothesis: {
      estimand: 'mean_difference',
      direction: 'group_a_higher',
      nullValue: 0,
    },
  },
  inputs: [
    distributionUniverse('csi300', '沪深300成分股', '000300.SH'),
    distributionUniverse('csi500', '中证500成分股', '000905.SH'),
  ],
  protocol: {
    kind: 'distribution_comparison',
    version: 1,
    groupA: 'csi300',
    groupB: 'csi500',
    measure: { measure: 'equity.pb', measureVersion: 1 },
    inference: { kind: 'welch', confidenceLevel: 0.95 },
    sensitivity: { kind: 'winsorized_mean', tailFraction: 0.05 },
  },
  outputs: [
    { kind: 'summary_table' },
    { kind: 'distribution_boxplot' },
    { kind: 'sensitivity' },
    { kind: 'conclusion' },
    { kind: 'formula' },
    { kind: 'python_example' },
    { kind: 'documentation' },
  ],
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
      body: JSON.stringify({ email: 'e2e-research@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  const actual = await page.evaluate(async (input) => {
    const response = await fetch('/api/app/research/universe/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(body));
    }
    return body;
  }, spec);
  if (actual.total < 1 || actual.rows.length < 1 || actual.stages.length !== 5) {
    throw new Error(`invalid Universe result: ${JSON.stringify(actual)}`);
  }

  const actualRelationship = await page.evaluate(async (input) => {
    const response = await fetch('/api/app/research/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(body));
    }
    return body;
  }, relationshipPlan);
  if (
    actualRelationship.result.observations < 24 ||
    !actualRelationship.conclusion?.level ||
    actualRelationship.coverage.length !== 2 ||
    actualRelationship.fingerprints?.data.inputs.length !== 2
  ) {
    throw new Error(`invalid relationship result: ${JSON.stringify(actualRelationship)}`);
  }

  const actualDistribution = await page.evaluate(async (input) => {
    const response = await fetch('/api/app/research/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(body));
    }
    return body;
  }, distributionPlan);
  if (
    actualDistribution.result.kind !== 'distribution_comparison' ||
    actualDistribution.result.groups.some((group) => group.summary.count < 20) ||
    !actualDistribution.conclusion?.robustness ||
    actualDistribution.coverage.length !== 2 ||
    actualDistribution.fingerprints?.data.inputs.length !== 2
  ) {
    throw new Error(`invalid distribution result: ${JSON.stringify(actualDistribution)}`);
  }

  const eventEntities = [
    ...new Map(
      actualDistribution.result.groups
        .flatMap((group) => group.observations)
        .map((observation) => [observation.entity.id, observation.entity]),
    ).values(),
  ].slice(0, 120);
  const eventPlan = eventStudyPlan(eventEntities);
  const actualEvent = await page.evaluate(async (input) => {
    const response = await fetch('/api/app/research/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(body));
    }
    return body;
  }, eventPlan);
  if (
    actualEvent.result.kind !== 'event_study' ||
    actualEvent.result.observations < 20 ||
    actualEvent.result.path.length !== 11 ||
    !actualEvent.conclusion?.robustness ||
    actualEvent.coverage.length !== 2 ||
    actualEvent.fingerprints?.data.inputs.length !== 2
  ) {
    throw new Error(`invalid event-study result: ${JSON.stringify(actualEvent)}`);
  }

  const now = new Date().toISOString();
  const relationshipRecord = {
    version: 1,
    studyId: 'e2e-study-relationship',
    runId: 'e2e-run-relationship-1',
    sequence: 1,
    createdAt: now,
  };
  const universeConversation = {
    id: 'e2e-universe',
    title: '低估值大市值股票池',
    preview: 'UniverseSpec V1',
    createdAt: now,
    updatedAt: now,
  };
  const relationshipConversation = {
    id: 'e2e-relationship',
    title: '指数月收益关系',
    preview: 'ResearchPlanSpec V1',
    createdAt: now,
    updatedAt: now,
  };
  const distributionConversation = {
    id: 'e2e-distribution',
    title: '指数成分股市净率比较',
    preview: 'DistributionComparison V1',
    createdAt: now,
    updatedAt: now,
  };
  const eventConversation = {
    id: 'e2e-event-study',
    title: '分红预案公告事件研究',
    preview: 'EventStudy V1',
    createdAt: now,
    updatedAt: now,
  };
  await page.route('**/api/app/research/conversations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        eventConversation,
        distributionConversation,
        relationshipConversation,
        universeConversation,
      ]),
    }),
  );
  await page.route('**/api/app/agent/conversations/e2e-universe/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'text', text: '这是按明确时点、资格和指标口径运行的股票池。' },
              { type: 'universe', title: universeConversation.title, spec },
            ],
          },
        ],
      }),
    }),
  );
  await page.route('**/api/app/research/universe/run', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(actual) }),
  );
  await page.route('**/api/app/agent/conversations/e2e-relationship/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'text', text: '以下结论由固定研究协议计算，文字说明不能修改结论等级。' },
              {
                type: 'research',
                title: relationshipConversation.title,
                run: actualRelationship,
                record: relationshipRecord,
              },
            ],
          },
        ],
      }),
    }),
  );
  await page.route('**/api/app/agent/conversations/e2e-distribution/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'text',
                text: '两组按同一截面和资格口径解析，并同时报告均值差、排序证据与极端值敏感性。',
              },
              {
                type: 'research',
                title: distributionConversation.title,
                run: actualDistribution,
              },
            ],
          },
        ],
      }),
    }),
  );
  await page.route('**/api/app/agent/conversations/e2e-event-study/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'text',
                text: '预案公告日按交易日对齐，与沪深300比较得到市场调整异常收益，并排除同一标的的重叠窗口。',
              },
              {
                type: 'research',
                title: eventConversation.title,
                run: actualEvent,
              },
            ],
          },
        ],
      }),
    }),
  );
  let rerunPlan = null;
  let persistentRerunRequested = false;
  const relationshipAttempts = [];
  const relationshipRecords = [
    {
      ref: relationshipRecord,
      title: relationshipConversation.title,
      origin: 'agent',
      planHash: 'plan-1',
      resultHash: 'result-1',
      run: actualRelationship,
    },
  ];
  await page.route('**/api/app/research/studies/e2e-study-relationship/attempts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(relationshipAttempts),
    }),
  );
  await page.route('**/api/app/research/studies/e2e-study-relationship/runs', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(relationshipRecords),
      });
    }
    persistentRerunRequested = true;
    const body = route.request().postDataJSON();
    rerunPlan = body.plan;
    if (body.plan.protocol.predictorLag === 120) {
      relationshipAttempts.push({
        version: 1,
        id: 'e2e-attempt-relationship-1',
        studyId: relationshipRecord.studyId,
        parentRunId: body.parentRunId,
        origin: 'parameter_rerun',
        plan: body.plan,
        planHash: 'failed-plan-1',
        error: 'Insufficient aligned observations.',
        createdAt: new Date().toISOString(),
        planChanges: [{ path: 'protocol.predictorLag', before: '1', after: '120' }],
        planChangesTruncated: false,
      });
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'VALIDATION_FAILED', message: 'Insufficient aligned observations.' },
        }),
      });
    }
    const record = {
      ref: {
        version: 1,
        studyId: relationshipRecord.studyId,
        runId: `e2e-run-relationship-${relationshipRecords.length + 1}`,
        sequence: relationshipRecords.length + 1,
        createdAt: new Date(Date.now() + relationshipRecords.length * 1000).toISOString(),
      },
      title: relationshipConversation.title,
      origin: 'parameter_rerun',
      parentRunId: body.parentRunId,
      planHash: `plan-${relationshipRecords.length + 1}`,
      resultHash: `result-${relationshipRecords.length + 1}`,
      run: { ...actualRelationship, plan: body.plan },
      comparisonToParent: {
        version: 1,
        baseRunId: body.parentRunId,
        candidateRunId: `e2e-run-relationship-${relationshipRecords.length + 1}`,
        changes: ['parameters'],
        planChanges: [{ path: 'protocol.predictorLag', before: '0', after: '1' }],
        planChangesTruncated: false,
        resultChanged: false,
        conclusionChanged: false,
        attribution: 'parameters',
      },
    };
    relationshipRecords.push(record);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(record),
    });
  });
  await page.route('**/api/app/research/run', (route) => {
    rerunPlan = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        rerunPlan.protocol.kind === 'distribution_comparison'
          ? actualDistribution
          : rerunPlan.protocol.kind === 'event_study'
            ? actualEvent
            : actualRelationship,
      ),
    });
  });

  await page.goto(`${BASE}/research`, { waitUntil: 'networkidle' });
  await page.getByText(universeConversation.title, { exact: true }).click();
  await page
    .locator('.jx-universeSpecCard-table .ant-table-row')
    .first()
    .waitFor({ timeout: 20_000 });
  const screenLinks = await page.getByRole('link', { name: '选股看图' }).count();
  if (screenLinks !== 0) {
    throw new Error('legacy Screen navigation is still visible');
  }
  await page.screenshot({ path: `${SHOTS}research-universe-desktop.png`, fullPage: true });

  const [objectPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.jx-universeSpecCard-table tbody a').first().click(),
  ]);
  await objectPage.waitForLoadState('networkidle');
  await objectPage.locator('canvas').first().waitFor({ timeout: 20_000 });
  await objectPage.screenshot({ path: `${SHOTS}research-object-detail.png`, fullPage: true });
  await objectPage.close();

  await page.getByText(relationshipConversation.title, { exact: true }).click();
  await page.locator('.jx-researchResult-conclusion').waitFor({ timeout: 20_000 });
  await page.locator('.jx-researchRunHistory').waitFor({ timeout: 20_000 });
  await page.getByText('调整参数', { exact: true }).click();
  await page.locator('.jx-researchResult-controls .ant-input-number input').first().fill('1');
  await page.screenshot({ path: `${SHOTS}research-relationship-controls-zh.png`, fullPage: true });
  await page.getByText('按新参数重跑', { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.jx-researchResult-controls'));
  if (rerunPlan?.protocol?.predictorLag !== 1) {
    throw new Error(`research rerun did not preserve edited lag: ${JSON.stringify(rerunPlan)}`);
  }
  const runHistory = page.locator('.jx-researchRunHistory');
  const runHistoryAfterRerun = await runHistory.innerText();
  if (!persistentRerunRequested || !runHistoryAfterRerun.includes('#2')) {
    throw new Error(
      `persisted research rerun is missing from history (requested=${persistentRerunRequested}): ${runHistoryAfterRerun}`,
    );
  }
  await page.getByText('本次运行调整了研究口径或参数', { exact: true }).waitFor();
  await page
    .locator('.jx-researchRunComparison')
    .filter({ hasText: 'protocol.predictorLag：0 → 1' })
    .waitFor();
  await runHistory.click();
  await page.locator('.ant-select-item-option').filter({ hasText: '#1' }).click();
  if (!(await runHistory.innerText()).includes('#1')) {
    throw new Error('the first persisted research run could not be reopened');
  }
  await runHistory.click();
  await page.locator('.ant-select-item-option').filter({ hasText: '#2' }).click();
  await page.locator('.jx-researchResult-title').click();
  await page.locator('.ant-select-dropdown').waitFor({ state: 'hidden' });
  await page.getByText('调整参数', { exact: true }).click();
  await page.locator('.jx-researchResult-controls .ant-input-number input').first().fill('120');
  await page.getByText('按新参数重跑', { exact: true }).click();
  await page.getByText('已保留 1 次失败尝试', { exact: true }).waitFor();
  await page
    .locator('.jx-researchAttemptNotice')
    .filter({ hasText: 'protocol.predictorLag：1 → 120' })
    .waitFor();
  await page.getByText('调整参数', { exact: true }).click();
  await page.screenshot({ path: `${SHOTS}research-relationship-zh.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).click();
  await page.getByText('Data coverage', { exact: true }).click();
  await page.getByText('Observations loaded', { exact: true }).first().waitFor();
  await page.getByText('Method & reproduction', { exact: true }).click();
  await page.getByText('Method assumptions', { exact: true }).waitFor();
  await page.getByText('Core estimates', { exact: true }).waitFor();
  await page.getByText('Inference', { exact: true }).click();
  await page.getByText('Newey–West HAC covariance', { exact: true }).waitFor();
  await page.getByText('Robustness & effect size', { exact: true }).click();
  await page.getByText('Spearman rank correlation', { exact: true }).waitFor();
  await page.getByText('Variables', { exact: true }).first().waitFor();
  await page
    .locator('.jx-researchFormulae')
    .screenshot({ path: `${SHOTS}research-formulae-relationship-en.png` });
  await page.getByText('Run fingerprints', { exact: true }).scrollIntoViewIfNeeded();
  await page.getByText('Application revision', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}research-relationship-en.png`, fullPage: true });

  await page.getByText('中', { exact: true }).click();
  await page.getByText(distributionConversation.title, { exact: true }).click();
  await page.locator('.jx-distributionComparison-conclusion').waitFor({ timeout: 20_000 });
  await page.getByText('极端值敏感性', { exact: true }).click();
  await page.getByText('单侧缩尾比例', { exact: true }).first().waitFor();
  await page.screenshot({ path: `${SHOTS}research-distribution-zh.png`, fullPage: true });
  await page.getByText('调整参数', { exact: true }).click();
  await page.locator('.jx-distributionComparison-control input').fill('10');
  await page.getByText('按新参数重跑', { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.jx-distributionComparison-controls'));
  if (rerunPlan?.protocol?.sensitivity?.tailFraction !== 0.1) {
    throw new Error(
      `distribution rerun did not preserve winsorization: ${JSON.stringify(rerunPlan)}`,
    );
  }
  await page.getByText('EN', { exact: true }).click();
  await page.getByText('Method & reproduction', { exact: true }).click();
  await page.getByText('Method assumptions', { exact: true }).waitFor();
  await page.getByText('Core estimates', { exact: true }).waitFor();
  await page.getByText('Inference', { exact: true }).click();
  await page.getByText('Mann–Whitney rank test', { exact: true }).waitFor();
  await page.getByText('Robustness & effect size', { exact: true }).click();
  await page.locator('.jx-researchFormulae').getByText("Cliff's delta", { exact: true }).waitFor();
  await page
    .locator('.jx-researchFormulae')
    .screenshot({ path: `${SHOTS}research-formulae-distribution-en.png` });
  await page.getByText('Run fingerprints', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-distribution-en.png`, fullPage: true });

  await page.getByText('中', { exact: true }).click();
  await page.getByText(eventConversation.title, { exact: true }).click();
  await page.locator('.jx-eventStudy-conclusion').waitFor({ timeout: 20_000 });
  await page.getByText('事件样本', { exact: true }).click();
  await page.getByRole('columnheader', { name: '预案公告日' }).waitFor();
  await page.screenshot({ path: `${SHOTS}research-event-study-zh.png`, fullPage: true });
  await page.getByText('调整参数', { exact: true }).click();
  await page.locator('.jx-eventStudy-control input').first().fill('-3');
  await page.getByText('按新参数重跑', { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.jx-eventStudy-controls'));
  if (rerunPlan?.protocol?.eventWindow?.start !== -3) {
    throw new Error(`event-study rerun did not preserve window: ${JSON.stringify(rerunPlan)}`);
  }
  await page.getByText('EN', { exact: true }).click();
  await page.getByText('Method & reproduction', { exact: true }).click();
  await page.getByText('Method assumptions', { exact: true }).waitFor();
  await page.getByText('Core estimates', { exact: true }).waitFor();
  await page.getByText('Inference', { exact: true }).click();
  await page.getByText('Event-date clustered standard error', { exact: true }).waitFor();
  await page.getByText('Robustness & effect size', { exact: true }).click();
  await page.getByText('5% winsorized mean CAR', { exact: true }).waitFor();
  await page
    .locator('.jx-researchFormulae')
    .screenshot({ path: `${SHOTS}research-formulae-event-study-en.png` });
  await page.getByText('Run fingerprints', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-event-study-en.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileLayout = await page.evaluate(() => {
    const sidebar = document.querySelector('.jx-research-sidebar');
    const workspace = document.querySelector('.jx-research-workspace');
    const card = document.querySelector('.jx-eventStudy');
    if (!sidebar || !workspace || !card) {
      return null;
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      sidebarRight: sidebarRect.right,
      sidebarTransform: getComputedStyle(sidebar).transform,
      workspaceWidth: workspaceRect.width,
      cardWidth: cardRect.width,
    };
  });
  if (
    !mobileLayout ||
    mobileLayout.sidebarRight > 1 ||
    mobileLayout.workspaceWidth < 370 ||
    mobileLayout.cardWidth < 350
  ) {
    throw new Error(`Research mobile layout is still compressed: ${JSON.stringify(mobileLayout)}`);
  }
  await page.screenshot({ path: `${SHOTS}research-event-study-mobile.png`, fullPage: true });
  console.log(
    '[research-e2e] Universe API, relationship, distribution, and event-study protocols, parameter reruns, bilingual content, object detail, and responsive layout passed',
  );
} finally {
  await browser.close();
}

function distributionUniverse(id, label, indexCode) {
  return {
    type: 'universe',
    id,
    label,
    universe: {
      version: 1,
      source: { kind: 'index_members', indexCode },
      asOf: { kind: 'latest_available' },
      eligibility: {
        minimumListedDays: 365,
        suspension: 'exclude',
        riskWarning: 'exclude',
      },
      predicates: [],
      missing: 'exclude',
      select: [{ measure: 'equity.pb', measureVersion: 1 }],
    },
    measure: { measure: 'equity.pb', measureVersion: 1 },
  };
}

function eventStudyPlan(entities) {
  return {
    version: 1,
    question: {
      version: 1,
      kind: 'event_study',
      text: '分红预案首次公告附近是否存在正向异常收益？',
      hypothesis: {
        estimand: 'mean_cumulative_abnormal_return',
        direction: 'positive',
        nullValue: 0,
      },
    },
    start: '20200101',
    end: '20251231',
    inputs: [
      {
        type: 'event_set',
        id: 'dividendProposalEvents',
        source: { kind: 'dividend_proposal_announcement', entities },
        label: '分红预案首次公告',
      },
      {
        type: 'series',
        id: 'benchmark',
        source: { kind: 'instrument', assetType: 'index', id: '000300.SH' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
        label: '沪深300',
      },
    ],
    protocol: {
      kind: 'event_study',
      version: 1,
      eventSet: 'dividendProposalEvents',
      benchmark: 'benchmark',
      eventWindow: { start: -5, end: 5 },
      returnModel: 'market_adjusted',
      overlappingEvents: 'keep_first',
      inference: {
        kind: 'event_cluster_mean',
        clusterBy: 'event_trade_date',
        confidenceLevel: 0.95,
      },
    },
    outputs: [
      { kind: 'summary_table' },
      { kind: 'event_path' },
      { kind: 'event_table' },
      { kind: 'sensitivity' },
      { kind: 'conclusion' },
      { kind: 'formula' },
      { kind: 'python_example' },
      { kind: 'documentation' },
    ],
  };
}
