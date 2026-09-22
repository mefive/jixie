import { researchRuntimePool } from '../runtime/pool.js';
import { quantile, std } from '#math/stats.js';
import type { ResearchEmbeddedRunSummaryV1 } from '@jixie/shared';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-embedded-python-');
  writeFileSync(`${fixture.directory}/test.db`, '');
  return {
    prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${fixture.directory}/test.db` }),
  };
});
vi.mock('#infra/jobs/queue.js', () => ({ wakeJobQueue: vi.fn() }));

import { embeddedAnalysisTools } from '#agent/tools/run-embedded-analysis.js';
import {
  finishPersistentTurn,
  persistEmbeddedAnalysisPart,
  startPersistentTurn,
} from '#agent/turns/records.js';
import { prisma } from '#infra/database/prisma.js';
import { claimQueuedJob } from '#infra/jobs/records.js';
import { runResearchDocument } from '../document-runs/run-document.js';
import { getResearchDocument } from '../documents/read.js';
import { getResearchExecution } from '../evidence/execution-records.js';

import { replayResearchInput } from '../runtime/host/input-replay.js';
import { cancelEmbeddedRun } from './cancel.js';
import { captureEmbeddedContext } from './context.js';
import { changeEmbeddedInputMode, continueEmbeddedResearch } from './continuation.js';
import { executeEmbeddedRun } from './execute.js';
import { completeEmbeddedRun } from './finish.js';
import { getEmbeddedRun, getEmbeddedVersion } from './read.js';
import { submitEmbeddedRun } from './submit.js';
import { createEmbeddedAnalysis } from './versions.js';

let previousLocal: string | undefined;
const base = {
  title: 'Python evidence',
  host: { type: 'strategy' as const, id: 'strategy' },
  parameters: { value: 7, label: '中文\\n"quoted"', enabled: true, absent: null },
  inputScope: 'Explicit fixture data',
};

async function create(source: string) {
  const created = await createEmbeddedAnalysis('owner', { ...base, source });
  const run = await submitEmbeddedRun('owner', created.analysis.id, created.version.id, {
    requestId: 'first',
    expectedRevision: 1,
  });
  return { ...created, run };
}
async function execute(run: ResearchEmbeddedRunSummaryV1) {
  await claimQueuedJob(run.jobId);
  const output = await executeEmbeddedRun(run.runId, 'owner');
  await prisma.$transaction(async (transaction) => {
    await completeEmbeddedRun(transaction, output);
    await transaction.job.update({
      where: { id: run.jobId },
      data: { status: 'done', finishedAt: new Date() },
    });
  });
  return getEmbeddedRun('owner', run.analysisId, run.runId);
}

describe('embedded analysis with the real Research Python runtime', () => {
  beforeAll(() => {
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      { env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/test.db` }, stdio: 'pipe' },
    );
  }, 60_000);
  beforeEach(async () => {
    previousLocal = process.env.JIXIE_PYTHON_LOCAL;
    // A socket-backed post-review smoke can opt in without changing the product path.
    process.env.JIXIE_PYTHON_LOCAL = process.env.JIXIE_EMBEDDED_TEST_SOCKET === '1' ? '0' : '1';
    await prisma.user.create({ data: { id: 'owner', email: 'owner@fixture.invalid' } });
    await prisma.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: 'Strategy',
        config: { code: '# strategy', language: 'python' },
      },
    });
  });
  afterEach(async () => {
    for (const document of await prisma.researchDocument.findMany({ select: { id: true } })) {
      researchRuntimePool.close(document.id);
    }
    if (previousLocal === undefined) {
      delete process.env.JIXIE_PYTHON_LOCAL;
    } else {
      process.env.JIXIE_PYTHON_LOCAL = previousLocal;
    }
    await prisma.researchExecution.deleteMany();
    await prisma.researchEmbeddedAnalysisVersion.deleteMany();
    await prisma.researchEmbeddedAnalysis.deleteMany();
    await prisma.factorReport.deleteMany();
    await prisma.indexDaily.deleteMany();
    await prisma.finaIndicator.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('runs exact explicit parameters in a fresh environment on every rerun', async () => {
    const { run, analysis, version } = await create(
      'from __future__ import annotations\nassert parameters["enabled"] is True\nassert parameters["absent"] is None\nassert parameters["label"] == \'中文\\\\n"quoted"\'\nprior = globals().get("prior", 0) + parameters["value"]\nprior',
    );
    const first = await execute(run);
    expect(first).toMatchObject({ status: 'success', outputs: [{ type: 'value', value: 7 }] });
    expect(first.environment).toMatchObject({ runtime: 'research-py-v1' });
    const second = await submitEmbeddedRun('owner', analysis.id, version.id, {
      requestId: 'rerun',
      expectedRevision: 1,
    });
    expect((await execute(second)).outputs).toEqual(first.outputs);
    expect(await getEmbeddedRun('owner', analysis.id, run.runId)).toEqual(first);
  }, 30_000);

  it('retains an invalid Python attempt without freezing it', async () => {
    const { analysis, version, run } = await create('if');
    expect(await execute(run)).toMatchObject({
      status: 'error',
      errorCode: 'execution_failed',
      source: 'if',
    });
    expect((await getEmbeddedVersion('owner', analysis.id, version.id)).frozenAt).toBeNull();
  }, 30_000);

  it('captures report inputs and materializes a table and figure using existing output contracts', async () => {
    await prisma.factorReport.create({
      data: {
        id: 'report',
        userId: 'owner',
        factor: 'fixture',
        freq: 'month',
        start: '20200101',
        end: '20251231',
        payload: '{"observations":[1,2,null,4]}',
      },
    });
    const { run } = await create(
      'import pandas as pd\nimport matplotlib.pyplot as plt\nreport = results.factor_report("report")\nsample = pd.Series(report["report"]["observations"], dtype=float)\nplt.plot(sample.dropna())\npd.DataFrame({"count": [sample.count()], "mean": [sample.mean()]})',
    );
    const completed = await execute(run);
    expect(completed.status, completed.error ?? undefined).toBe('success');
    expect(completed.inputs[0]).toMatchObject({
      method: 'research_factor_report',
      status: 'received',
    });
    expect(completed.outputs.some((output) => output.type === 'table')).toBe(true);
    const image = completed.outputs.find((output) => output.type === 'image');
    expect(image).toMatchObject({ type: 'image', artifactId: expect.any(String) });
    const artifact = await prisma.researchArtifact.findFirstOrThrow();
    expect(artifact.data.byteLength).toBe(artifact.byteSize);
  }, 30_000);

  it('keeps missing-date alignment and undefined statistics explicit rather than turning them into zero', async () => {
    const { run } = await create(
      'import pandas as pd\nimport numpy as np\nleft = pd.Series([1.0, 2.0, np.nan], index=["2024-01-01", "2024-01-02", "2024-01-03"])\nright = pd.Series([2.0, 4.0, 8.0], index=["2024-01-02", "2024-01-03", "2024-01-04"])\npaired = pd.concat([left, right], axis=1, join="inner").dropna()\nassert len(paired) == 1\n{"paired_count": len(paired), "correlation": np.nan, "empty_count": int(left.iloc[:0].count())}',
    );
    const completed = await execute(run);
    expect(completed.status, completed.error ?? undefined).toBe('success');
    const text = completed.outputs.find((output) => output.type === 'text');
    expect(text?.type === 'text' ? JSON.parse(text.text) : null).toEqual({
      paired_count: 1,
      correlation: null,
      empty_count: 0,
    });
  }, 30_000);

  it('replaces chat statistics with SDK data, standard Python estimators and a retained rolling chart', async () => {
    const dates = ['20240101', '20240102', '20240103', '20240104', '20240105', '20240108'];
    const returns = [-0.02, 0.01, 0.03, -0.01, 0.04];
    for (const [tsCode, initial, changes] of [
      ['000300.SH', 100, returns],
      ['000852.SH', 200, returns.map((value) => 0.005 + 2 * value)],
    ] as const) {
      let close = initial;
      await prisma.indexDaily.createMany({
        data: dates.map((tradeDate, index) => {
          if (index > 0) {
            close *= 1 + changes[index - 1];
          }
          return { tsCode, tradeDate, close };
        }),
      });
    }
    await prisma.finaIndicator.createMany({
      data: [
        { tsCode: '600519.SH', endDate: '20221231', annDate: '20230330', roe: 20 },
        { tsCode: '600519.SH', endDate: '20231231', annDate: '20240330', roe: 99 },
      ],
    });
    const { run } = await create(`import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
left = data.series("index", "000300.SH", start="20240102", end="20240108", transform="simple_return")
right = data.series("index", "000852.SH", start="20240102", end="20240108", transform="simple_return")
paired = left.merge(right, on="date", how="inner", suffixes=("_left", "_right")).dropna()
assert len(paired) == 5
assert np.isnan(pd.Series(dtype=float).mean())
with np.errstate(divide="ignore", invalid="ignore"):
    assert np.isnan(np.corrcoef(np.ones(3), np.arange(3))[0, 1])
fit = sm.OLS(paired["value_right"], sm.add_constant(paired["value_left"]), missing="raise").fit()
rolling = paired[["date"]].copy()
rolling["correlation"] = paired["value_left"].rolling(3, min_periods=3).corr(paired["value_right"])
assert int(rolling["correlation"].count()) == 3
assert np.allclose(rolling["correlation"].dropna(), 1.0)
fundamentals = data.equity_fundamentals("600519.SH", start="20230101", end="20240108")
assert len(fundamentals) == 1
assert fundamentals["date"].dt.strftime("%Y%m%d").tolist() == ["20230330"]
summary = pd.DataFrame({
    "sample_count": [len(paired)],
    "pearson": [stats.pearsonr(paired["value_left"], paired["value_right"]).statistic],
    "spearman": [stats.spearmanr(paired["value_left"], paired["value_right"]).statistic],
    "alpha": [fit.params["const"]],
    "beta": [fit.params["value_left"]],
    "annual_volatility": [paired["value_left"].std(ddof=1) * np.sqrt(252)],
    "quantile_25": [paired["value_left"].quantile(0.25, interpolation="linear")],
    "roe_pct": [fundamentals["roe_pct"].iloc[0]],
})
print(summary.to_json(orient="records", double_precision=15))
charts.line(rolling, x="date", y="correlation", title="Three-observation return correlation")`);
    const completed = await execute(run);
    expect(completed.status, completed.error ?? undefined).toBe('success');
    const summaryText = completed.outputs.find(
      (output) => output.type === 'text' && output.text.includes('sample_count'),
    );
    expect(summaryText?.type).toBe('text');
    const summary = JSON.parse(summaryText?.type === 'text' ? summaryText.text : '[]')[0];
    expect(summary.sample_count).toBe(5);
    expect(summary.pearson).toBeCloseTo(1, 12);
    expect(summary.spearman).toBeCloseTo(1, 12);
    expect(summary.alpha).toBeCloseTo(0.005, 12);
    expect(summary.beta).toBeCloseTo(2, 12);
    expect(summary.annual_volatility).toBeCloseTo(std(returns) * Math.sqrt(252), 12);
    expect(summary.quantile_25).toBeCloseTo(quantile(returns, 0.25), 12);
    expect(summary.roe_pct).toBe(20);
    expect(completed.outputs.some((output) => output.type === 'chart')).toBe(true);
    expect(completed.inputs.map((input) => [input.method, input.status])).toEqual([
      ['research_series', 'received'],
      ['research_series', 'received'],
      ['research_equity_fundamentals', 'received'],
    ]);
  }, 30_000);

  it('stops an active Python session on cancellation and retains the submitted source', async () => {
    const { run, analysis, version } = await create('while True:\n    pass');
    await claimQueuedJob(run.jobId);
    const running = executeEmbeddedRun(run.runId, 'owner');
    await vi.waitFor(
      async () => {
        expect(
          (await prisma.researchExecution.findUniqueOrThrow({ where: { id: run.runId } }))
            .environmentSnapshot,
        ).not.toBeNull();
      },
      { timeout: 20_000 },
    );
    await cancelEmbeddedRun('owner', analysis.id, run.runId);
    await running;
    expect(await getEmbeddedRun('owner', analysis.id, run.runId)).toMatchObject({
      status: 'cancelled',
      source: 'while True:\n    pass',
    });
    expect((await getEmbeddedVersion('owner', analysis.id, version.id)).frozenAt).toBeNull();
  }, 30_000);
  it('continues with retained inputs, requires explicit current-data mode and preserves execution provenance', async () => {
    await prisma.factorReport.create({
      data: {
        id: 'report',
        userId: 'owner',
        factor: 'fixture',
        freq: 'month',
        start: '20200101',
        end: '20251231',
        payload: '{"observations":[1,2,null,4]}',
      },
    });
    const { run, analysis } = await create(
      'import pandas as pd\nreport = results.factor_report("report")\nsample = pd.Series(report["report"]["observations"], dtype=float)\nfloat(sample.dropna().mean())',
    );
    const original = await execute(run);
    expect(original.status, original.error ?? undefined).toBe('success');
    const copy = await continueEmbeddedResearch('owner', analysis.id, run.runId, 'en');
    expect(await continueEmbeddedResearch('owner', analysis.id, run.runId, 'en')).toEqual(copy);
    await expect(
      continueEmbeddedResearch('other', analysis.id, run.runId, 'en'),
    ).rejects.toMatchObject({ reason: 'embedded_not_found' });
    await prisma.factorReport.update({
      where: { id: 'report' },
      data: { payload: '{"observations":[10,20,null,40]}' },
    });
    const retained = await runResearchDocument('owner', copy.documentId, true);
    expect(retained?.execution?.status).toBe('success');
    expect(retained?.document.cells.at(-1)?.outputs).toEqual(original.outputs);
    expect(
      (await getResearchExecution('owner', retained!.execution!.id))?.cells.at(-1)?.inputSnapshot,
    ).toMatchObject({ runId: run.runId, inputMode: 'retained' });
    const changed = await changeEmbeddedInputMode('owner', copy.documentId, {
      inputMode: 'current',
      expectedRevision: retained!.document.contentRevision,
    });
    expect(
      changed?.cells
        .filter((cell) => cell.kind === 'python')
        .every((cell) => cell.status === 'stale'),
    ).toBe(true);
    const current = await runResearchDocument('owner', copy.documentId, true);
    expect(current?.execution?.status).toBe('success');
    expect(current?.document.cells.at(-1)?.outputs).not.toEqual(original.outputs);
    expect(
      (await getResearchExecution('owner', current!.execution!.id))?.cells.at(-1)?.inputSnapshot,
    ).toMatchObject({ runId: run.runId, inputMode: 'current' });
    expect(current?.execution?.sourceHash).not.toBe(retained?.execution?.sourceHash);
    await changeEmbeddedInputMode('owner', copy.documentId, {
      inputMode: 'retained',
      expectedRevision: current!.document.contentRevision,
    });
    await prisma.factorReport.delete({ where: { id: 'report' } });
    expect(
      (await runResearchDocument('owner', copy.documentId, true))?.document.cells.at(-1)?.outputs,
    ).toEqual(original.outputs);
    expect(
      await replayResearchInput(copy.documentId, {
        type: 'request',
        id: 1,
        method: 'research_factor_report',
        arguments: { report_id: 'different-report' },
      }),
    ).toMatchObject({ error: expect.stringContaining('no unambiguous retained response') });
    const input = await prisma.researchExecutionInput.findFirstOrThrow({
      where: { executionId: run.runId },
    });
    await prisma.researchExecutionInput.update({
      where: { id: input.id },
      data: { responseJson: '{}' },
    });
    await expect(
      replayResearchInput(copy.documentId, {
        type: 'request',
        id: 1,
        method: 'research_factor_report',
        arguments: input.arguments,
      }),
    ).rejects.toThrow('checksum mismatch');
    expect((await getResearchDocument('owner', copy.documentId))?.embeddedSource?.runId).toBe(
      run.runId,
    );
  }, 60_000);

  it('saves the tool run before the model answer and keeps it through cancellation', async () => {
    await startPersistentTurn({
      turnId: 'analysis-turn',
      userId: 'owner',
      entity: { kind: 'strategy', id: 'strategy' },
      history: [],
      message: 'Check this sample',
      model: 'fixture',
    });
    const source = await captureEmbeddedContext(prisma, 'owner', base.host);
    const tools = embeddedAnalysisTools({ userId: 'owner', source });
    const tool = tools.find((item) => item.name === 'runEmbeddedAnalysis')!;
    const result = await tool.run(
      {
        title: 'Sample check',
        source: 'parameters["value"] * 2',
        parameters: { value: 7 },
        inputScope: 'Explicit test sample',
      },
      {
        onEmbeddedAnalysis: async (part) => {
          await persistEmbeddedAnalysisPart('analysis-turn', part);
          const message = await prisma.agentMessage.findFirstOrThrow({
            where: { turnId: 'analysis-turn', role: 'assistant' },
          });
          expect(message.parts).toEqual([part]);
          await execute(
            await getEmbeddedRun('owner', part.reference.analysisId, part.reference.runId),
          );
        },
      },
    );
    const part = result.embeddedAnalysis!;
    expect(JSON.parse(result.observation)).toMatchObject({
      status: 'success',
      outputs: [{ type: 'value', value: 14 }],
    });
    await finishPersistentTurn({
      turnId: 'analysis-turn',
      status: 'cancelled',
      trace: { version: 1, steps: [], truncated: false },
    });
    expect(
      (
        await prisma.agentMessage.findMany({
          where: { turnId: 'analysis-turn', role: 'assistant' },
        })
      ).map((message) => message.parts),
    ).toEqual([[part]]);
    await expect(persistEmbeddedAnalysisPart('analysis-turn', part)).rejects.toThrow(
      'active persisted conversation',
    );
    const otherHostTools = embeddedAnalysisTools({
      userId: 'owner',
      source: { ...source, host: { type: 'strategy', id: 'different' } },
    });
    await expect(
      otherHostTools
        .find((item) => item.name === 'readEmbeddedAnalysis')!
        .run({ analysisId: part.reference.analysisId, runId: part.reference.runId }),
    ).rejects.toThrow('different Factor or Strategy');
  }, 30_000);

  it('refuses to continue a failed attempt and merges an early card with one final answer', async () => {
    const { run, analysis } = await create('raise ValueError("bad sample")');
    await execute(run);
    await expect(
      continueEmbeddedResearch('owner', analysis.id, run.runId, 'en'),
    ).rejects.toMatchObject({ reason: 'embedded_incomplete_run', embeddedCode: 'incomplete_run' });
    await startPersistentTurn({
      turnId: 'merge-turn',
      userId: 'owner',
      entity: { kind: 'strategy', id: 'strategy' },
      history: [],
      message: 'Check sample',
      model: 'fixture',
    });
    const part = {
      type: 'embedded_analysis' as const,
      title: 'Failed sample',
      reference: { analysisId: analysis.id, versionId: run.versionId, runId: run.runId },
    };
    await persistEmbeddedAnalysisPart('merge-turn', part);
    await persistEmbeddedAnalysisPart('merge-turn', part);
    await finishPersistentTurn({
      turnId: 'merge-turn',
      status: 'done',
      parts: [{ type: 'text', text: 'The sample failed.' }],
      trace: { version: 1, steps: [], truncated: false },
    });
    const messages = await prisma.agentMessage.findMany({
      where: { turnId: 'merge-turn', role: 'assistant' },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toEqual([{ type: 'text', text: 'The sample failed.' }, part]);
  }, 30_000);
});
