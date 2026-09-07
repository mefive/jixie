import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  EQUITY_FCFF_REPLAY_CASES,
  equityFcffParameterSource,
} from '../../api/src/research/equity-fcff-replay-cases.ts';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const ownerEmail = `e2e-research-fcff-reuse-${Date.now()}@test.com`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await context.newPage();
const documentIds = [];

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, ownerEmail);

  const results = [];
  for (const replayCase of EQUITY_FCFF_REPLAY_CASES) {
    const document = await api(page, '/api/app/research/documents', {
      method: 'POST',
      body: JSON.stringify({ template: 'equity_fcff_valuation' }),
    });
    documentIds.push(document.id);
    await api(page, `/api/app/research/conversations/${document.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: `${replayCase.companyName} FCFF 估值复盘` }),
    });
    const introduction = document.cells.find((cell) => cell.kind === 'markdown');
    if (!introduction) {
      throw new Error('Replay introduction is missing');
    }
    await api(page, `/api/app/research/cells/${introduction.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedRevision: introduction.revision,
        source: `# ${replayCase.companyName} FCFF 估值复盘

标的 ${replayCase.identifier}；经营形态：${replayCase.businessPattern}。
估值日 ${replayCase.valuationDate}，复查日 ${replayCase.reviewDate}。
本案例使用显式教学假设，不代表平台预测、目标价或买卖建议。`,
      }),
    });
    const parameterCell = document.cells.find(
      (cell) => cell.kind === 'python' && cell.source.includes('valuation_identifier'),
    );
    if (!parameterCell) {
      throw new Error(`${replayCase.companyName} parameter Cell is missing`);
    }
    await api(page, `/api/app/research/cells/${parameterCell.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        source: equityFcffParameterSource(replayCase),
        expectedRevision: parameterCell.revision,
      }),
    });

    const run = await api(page, `/api/app/research/documents/${document.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ clean: true }),
    });
    if (run.execution?.status !== 'success' || run.execution.executedCellCount !== 16) {
      throw new Error(
        `${replayCase.companyName} clean run failed: ${JSON.stringify(run.execution)}`,
      );
    }

    const scenarioCell = findCell(run.document.cells, 'scenario_valuation = scenario_forecasts');
    const reverseCell = findCell(run.document.cells, 'reverse_valuation = valuation.implied');
    const reviewCell = findCell(run.document.cells, 'narrative_review = pd.DataFrame');
    const scenarioOutput = tableOutput(scenarioCell);
    const reverseOutput = tableOutput(reverseCell);
    const reviewOutput = tableOutput(reviewCell);
    if (scenarioOutput.rowCount !== 3 || reverseOutput.rows[0]?.status !== 'solved') {
      throw new Error(`${replayCase.companyName} valuation outputs are invalid`);
    }
    if (
      reviewOutput.rowCount !== 4 ||
      !reviewOutput.rows.every((row) => row.review_report_period === '2025-12-31')
    ) {
      throw new Error(`${replayCase.companyName} next-report review is invalid`);
    }
    results.push({
      ...replayCase,
      documentId: document.id,
      executionId: run.execution.id,
      scenarioCellId: scenarioCell.id,
      reviewCellId: reviewCell.id,
      scenarioOutput,
      reverseOutput,
      reviewOutput,
    });
  }

  const midea = results.find((item) => item.identifier === '000333.SZ');
  if (!midea) {
    throw new Error('Midea replay result is missing');
  }
  await page.goto(`${BASE}/research?document=${encodeURIComponent(midea.documentId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  const scenarioElement = page.locator(`[data-cell-id="${midea.scenarioCellId}"]`);
  await scenarioElement.scrollIntoViewIfNeeded();
  await scenarioElement.screenshot({ path: `${SHOTS}research-fcff-reuse-midea-scenarios.png` });
  const reviewElement = page.locator(`[data-cell-id="${midea.reviewCellId}"]`);
  await reviewElement.scrollIntoViewIfNeeded();
  await reviewElement.screenshot({ path: `${SHOTS}research-fcff-reuse-midea-review.png` });

  const reviewTable = reviewElement.getByTestId('research-table-output');
  await reviewTable
    .getByRole('columnheader', { name: 'assessment', exact: true })
    .scrollIntoViewIfNeeded();
  await reviewTable.screenshot({ path: `${SHOTS}research-fcff-reuse-midea-assessments.png` });

  console.log(
    `[research-fcff-reuse-e2e] ${JSON.stringify(
      results.map((result) => ({
        company: result.companyName,
        identifier: result.identifier,
        executionId: result.executionId,
        scenarios: result.scenarioOutput.rows.map((row) => ({
          name: row.scenario,
          perShareValueCny: row.per_share_value_cny,
          diagnostics: row.diagnostics,
        })),
        impliedRevenueGrowth: result.reverseOutput.rows[0]?.implied_value,
        review: result.reviewOutput.rows.map((row) => ({
          assumption: row.assumption,
          actual: row.actual,
          assessment: row.assessment,
        })),
      })),
    )}`,
  );
} finally {
  for (const documentId of documentIds) {
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/research/conversations/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      }, documentId)
      .catch(() => {});
  }
  await context.close();
  await browser.close();
}

function findCell(cells, sourceFragment) {
  const cell = cells.find((candidate) => candidate.source.includes(sourceFragment));
  if (!cell) {
    throw new Error(`Research Cell not found for ${sourceFragment}`);
  }
  return cell;
}

function tableOutput(cell) {
  const output = cell.outputs.find((candidate) => candidate.type === 'table');
  if (!output) {
    throw new Error(`Research Cell ${cell.id} has no table output`);
  }
  return output;
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
