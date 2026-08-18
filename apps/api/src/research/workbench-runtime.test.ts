import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESEARCH_SERIES_SDK_CONTRACT_V1 } from '@jixie/shared';
import {
  ResearchPythonExecutionError,
  ResearchPythonInterruptionError,
  researchRuntimeManager,
} from './workbench-runtime.js';

const DOCUMENT_ID = 'research-runtime-test';
let previousLocal: string | undefined;

describe('research workbench Python runtime', () => {
  beforeEach(() => {
    previousLocal = process.env.JIXIE_PYTHON_LOCAL;
    process.env.JIXIE_PYTHON_LOCAL = '1';
  });

  afterEach(() => {
    researchRuntimeManager.close(DOCUMENT_ID);
    if (previousLocal === undefined) {
      delete process.env.JIXIE_PYTHON_LOCAL;
    } else {
      process.env.JIXIE_PYTHON_LOCAL = previousLocal;
    }
  });

  it('derives definitions and references from Python AST', async () => {
    const analysis = await researchRuntimeManager.analyze(DOCUMENT_ID, [
      { id: 'load', source: 'monthly = [1, 2, 3]' },
      { id: 'summary', source: 'average = sum(monthly) / len(monthly)\naverage' },
    ]);

    expect(analysis).toEqual([
      { cellId: 'load', definitions: ['monthly'], references: [] },
      { cellId: 'summary', definitions: ['average'], references: ['average', 'monthly'] },
    ]);
  });

  it('keeps document-level state and returns typed outputs', async () => {
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'upstream',
      source: 'returns = [0.01, -0.02, 0.03]',
    });
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'downstream',
      source: 'cumulative = sum(returns)\ncumulative',
    });

    expect(result.outputs).toEqual([{ type: 'value', value: 0.019999999999999997 }]);
    expect(result.definitions).toEqual(['cumulative']);
    expect(result.references).toContain('returns');
    expect(result.environmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns a bounded table preview for record rows', async () => {
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'large-table',
      source:
        'rows = [{"row": index, "value": index / 10, "note": "x" * 300} for index in range(260)]\nrows',
    });

    const output = result.outputs[0];
    expect(output).toMatchObject({
      type: 'table',
      columns: ['row', 'value', 'note'],
      rowCount: 260,
      columnCount: 3,
      truncated: true,
      truncatedColumns: false,
      truncatedCells: true,
      limits: { rows: 200, columns: 64, cellCharacters: 256 },
    });
    if (output?.type !== 'table') {
      throw new Error('Expected a table output');
    }
    expect(output.rows).toHaveLength(200);
    expect(output.rows[0]?.note).toMatch(/\[truncated\]$/);

    const wideResult = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'wide-table',
      source: 'wide = [{f"column_{index}": index for index in range(70)}]\nwide',
    });
    const wideOutput = wideResult.outputs[0];
    expect(wideOutput).toMatchObject({
      type: 'table',
      rowCount: 1,
      columnCount: 70,
      truncated: false,
      truncatedColumns: true,
    });
    if (wideOutput?.type !== 'table') {
      throw new Error('Expected a wide table output');
    }
    expect(wideOutput.columns).toHaveLength(64);
  });

  it('keeps the Python data API signature aligned with the public SDK contract', async () => {
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'signature',
      source: 'import inspect\n",".join(inspect.signature(data.series).parameters.keys())',
    });

    expect(result.outputs).toEqual([
      {
        type: 'value',
        value: RESEARCH_SERIES_SDK_CONTRACT_V1.parameters
          .map((parameter) => parameter.name)
          .join(','),
      },
    ]);
  });

  it('returns native histogram, boxplot, heatmap, and event-path artifacts', async () => {
    const histogram = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'histogram',
      source:
        'observations = [{"return": -0.02}, {"return": -0.01}, {"return": 0.01}, {"return": 0.03}]\ncharts.histogram(observations, column="return", bins=2, title="Return distribution")',
    });
    expect(histogram.outputs[0]).toMatchObject({
      type: 'chart',
      kind: 'histogram',
      x: 'bin',
      title: 'Return distribution',
      series: [{ column: 'count', label: 'return' }],
    });
    const histogramOutput = histogram.outputs[0];
    if (histogramOutput?.type !== 'chart') {
      throw new Error('Expected a histogram chart output');
    }
    expect(histogramOutput.rows.reduce((total, row) => total + Number(row.count), 0)).toBe(4);

    const boxplot = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'boxplot',
      source: 'charts.boxplot(observations, y="return")',
    });
    expect(boxplot.outputs[0]).toMatchObject({
      type: 'chart',
      kind: 'boxplot',
      x: 'category',
      rows: [{ category: 'return', min: -0.02, median: 0, max: 0.03 }],
    });

    const heatmap = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'heatmap',
      source:
        'matrix = [{"month": "Jan", "asset": "CSI 300", "corr": 0.4}, {"month": "Feb", "asset": "CSI 300", "corr": 0.6}]\ncharts.heatmap(matrix, x="month", y="asset", value="corr")',
    });
    expect(heatmap.outputs[0]).toMatchObject({
      type: 'chart',
      kind: 'heatmap',
      x: 'month',
      y: 'asset',
      series: [{ column: 'corr', label: 'corr' }],
    });

    const eventPath = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'event-path',
      source:
        'event_returns = [{"event_day": -1, "car": -0.01}, {"event_day": 0, "car": 0.02}, {"event_day": 1, "car": 0.03}]\ncharts.event_path(event_returns, x="event_day", y="car")',
    });
    expect(eventPath.outputs[0]).toMatchObject({
      type: 'chart',
      kind: 'event_path',
      x: 'event_day',
      series: [{ column: 'car', label: 'car' }],
    });

    const projectedLine = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'projected-line',
      source:
        'charts.line([{"date": "2026-01", "nav": 1.1, "unused": "not persisted"}], x="date", y="nav")',
    });
    expect(projectedLine.outputs[0]).toMatchObject({
      type: 'chart',
      rows: [{ date: '2026-01', nav: 1.1 }],
    });
  });

  it('rejects invalid chart parameters and ambiguous heatmap coordinates', async () => {
    await expect(
      researchRuntimeManager.execute(DOCUMENT_ID, {
        id: 'invalid-histogram',
        source: 'charts.histogram([{"value": 1}], column="value", bins=0)',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ResearchPythonExecutionError>>({
        message: expect.stringContaining('bins must be an integer from 1 to 100'),
      }),
    );

    await expect(
      researchRuntimeManager.execute(DOCUMENT_ID, {
        id: 'duplicate-heatmap',
        source:
          'charts.heatmap([{"x": "a", "y": "b", "value": 1}, {"x": "a", "y": "b", "value": 2}], x="x", y="y", value="value")',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ResearchPythonExecutionError>>({
        message: expect.stringContaining('requires unique x/y coordinates'),
      }),
    );

    await expect(
      researchRuntimeManager.execute(DOCUMENT_ID, {
        id: 'oversized-chart',
        source: 'charts.line([{"x": index, "y": index} for index in range(5001)], x="x", y="y")',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ResearchPythonExecutionError>>({
        message: expect.stringContaining('accepts at most 5000 rows'),
      }),
    );
  });

  it('rejects a Cell output that exceeds the persisted artifact budget', async () => {
    await expect(
      researchRuntimeManager.execute(DOCUMENT_ID, {
        id: 'oversized-output',
        source: '"x" * (9 * 1024 * 1024)',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ResearchPythonExecutionError>>({
        message: expect.stringContaining('persisted artifact limit'),
      }),
    );
  });

  it('interrupts active code and starts the next execution in a fresh session', async () => {
    const execution = researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'infinite',
      source: 'while True:\n    pass',
    });
    await waitForActiveExecution();

    expect(researchRuntimeManager.interrupt(DOCUMENT_ID)).toBe('infinite');
    await expect(execution).rejects.toBeInstanceOf(ResearchPythonInterruptionError);

    const recovered = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'recovered',
      source: '21 * 2',
    });
    expect(recovered.outputs).toEqual([{ type: 'value', value: 42 }]);
  });
});

async function waitForActiveExecution(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (researchRuntimeManager.activeCellId(DOCUMENT_ID) === 'infinite') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Research execution did not start');
}
