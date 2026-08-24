import { afterAll, describe, expect, it } from 'vitest';
import type { ResearchLanguageRequestV1 } from '@jixie/shared';
import { ResearchPythonLanguageService } from './pyright-language-service.js';

const service = new ResearchPythonLanguageService();
const cells = [
  {
    id: 'cell-a',
    source: [
      'window_size = 12',
      'frame = data.series(',
      '    "index", "000300.SH",',
      '    start="20200101", end="20251231",',
      ')',
    ].join('\n'),
  },
  {
    id: 'cell-b',
    source: [
      'rolling = frame["value"].rolling(window_size).mean()',
      'frame.',
      'missing_name + 1',
    ].join('\n'),
  },
];

function request(
  action: ResearchLanguageRequestV1['action'],
  position?: { line: number; character: number },
  newName?: string,
): ResearchLanguageRequestV1 {
  return {
    version: 1,
    documentId: 'document-a',
    cells,
    cellId: 'cell-b',
    action,
    ...(position ? { position } : {}),
    ...(newName ? { newName } : {}),
  };
}

describe('Research Pyright language service', () => {
  afterAll(async () => {
    await service.dispose();
  });

  it('provides pandas completion from the static research runtime stubs', async () => {
    const response = await service.request(
      'user-a:document-a',
      request('completion', { line: 1, character: 6 }),
    );
    expect(response.action).toBe('completion');
    if (response.action === 'completion') {
      expect(response.result.items.map((item) => item.label)).toContain('merge');
    }
  }, 20_000);

  it('provides SciPy and statsmodels completion from the fixed runtime stubs', async () => {
    const statisticsRequest: ResearchLanguageRequestV1 = {
      version: 1,
      documentId: 'statistics-1',
      cells: [
        {
          id: 'analysis',
          source: 'from scipy import stats\nimport statsmodels.api as sm\nstats.\nsm.',
        },
      ],
      cellId: 'analysis',
      action: 'completion',
      position: { line: 2, character: 6 },
    };
    const scipyResponse = await service.request('statistics-user:scipy', statisticsRequest);
    expect(scipyResponse.action).toBe('completion');
    if (scipyResponse.action === 'completion') {
      expect(scipyResponse.result.items.map((item) => item.label)).toContain('pearsonr');
    }

    const statsmodelsResponse = await service.request('statistics-user:statsmodels', {
      ...statisticsRequest,
      position: { line: 3, character: 3 },
    });
    expect(statsmodelsResponse.action).toBe('completion');
    if (statsmodelsResponse.action === 'completion') {
      expect(statsmodelsResponse.result.items.map((item) => item.label)).toContain('OLS');
    }
  }, 20_000);

  it('maps cross-Cell definitions and renames back to their source Cells', async () => {
    const definition = await service.request(
      'user-a:document-a',
      request('definition', { line: 0, character: 42 }),
    );
    expect(definition).toMatchObject({
      action: 'definition',
      result: [{ cellId: 'cell-a', range: { start: { line: 0, character: 0 } } }],
    });

    const rename = await service.request(
      'user-a:document-a',
      request('rename', { line: 0, character: 42 }, 'lookback'),
    );
    expect(rename.action).toBe('rename');
    if (rename.action === 'rename') {
      expect(rename.result.map((edit) => edit.cellId).sort()).toEqual(['cell-a', 'cell-b']);
      expect(rename.result.every((edit) => edit.newText === 'lookback')).toBe(true);
    }
  }, 20_000);

  it('provides the generated Python Factor SDK through the same Pyright service', async () => {
    const factorRequest: ResearchLanguageRequestV1 = {
      version: 1,
      documentId: 'factor-1',
      cells: [
        {
          id: 'definition',
          source:
            'from jixie import FactorBar\ndef compute(bar: FactorBar) -> float | None:\n    return bar.\n',
        },
      ],
      cellId: 'definition',
      action: 'completion',
      position: { line: 2, character: 15 },
    };
    const response = await service.request('factor-user', factorRequest);

    expect(response.action).toBe('completion');
    if (response.action === 'completion') {
      expect(response.result.items.map((item) => item.label)).toContain('pe_ttm');
    }
  }, 20_000);

  it('publishes static diagnostics without executing a Cell', async () => {
    const response = await service.request('user-a:document-a', request('diagnostics'));
    expect(response.action).toBe('diagnostics');
    if (response.action === 'diagnostics') {
      expect(response.result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cellId: 'cell-b',
            message: expect.stringContaining('missing_name'),
          }),
        ]),
      );
    }
  }, 20_000);
});
