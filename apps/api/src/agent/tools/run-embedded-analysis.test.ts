import type { ResearchEmbeddedContextV1 } from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const operations = vi.hoisted(() => ({
  create: vi.fn(),
  derive: vi.fn(),
  update: vi.fn(),
  submit: vi.fn(),
  analysis: vi.fn(),
  version: vi.fn(),
  run: vi.fn(),
}));

vi.mock('#research/embedded/versions.js', () => ({
  createEmbeddedAnalysis: operations.create,
  deriveEmbeddedVersion: operations.derive,
  updateEmbeddedVersion: operations.update,
}));
vi.mock('#research/embedded/submit.js', () => ({ submitEmbeddedRun: operations.submit }));
vi.mock('#research/embedded/read.js', () => ({
  getEmbeddedAnalysis: operations.analysis,
  getEmbeddedVersion: operations.version,
  getEmbeddedRun: operations.run,
}));
vi.mock('#research/embedded/cancel.js', () => ({ cancelEmbeddedRun: vi.fn() }));

import { embeddedAnalysisTools } from './run-embedded-analysis.js';

const source: ResearchEmbeddedContextV1 = {
  host: { type: 'factor', id: 'factor' },
  name: 'Factor',
  code: 'factor code',
  codeHash: 'hash',
  language: 'typescript',
  capturedAt: '2026-09-17T00:00:00.000Z',
};
const draft = { source: 'print(1)', parameters: {}, inputScope: '  Test data  ' };
const version = { id: 'version', number: 1, revision: 2, frozenAt: null };

function runTool(context = source) {
  return embeddedAnalysisTools({ userId: 'owner', source: context }).find(
    (tool) => tool.name === 'runEmbeddedAnalysis',
  )!;
}

describe('embedded analysis tool input boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    operations.create.mockResolvedValue({ analysis: { id: 'analysis' }, version });
    operations.derive.mockResolvedValue(version);
    operations.update.mockResolvedValue(version);
    operations.submit.mockResolvedValue({ runId: 'run' });
    operations.analysis.mockResolvedValue({ host: source.host });
    operations.version.mockResolvedValue(version);
    operations.run.mockResolvedValue({
      analysisId: 'analysis',
      versionId: 'version',
      runId: 'run',
      status: 'success',
      revision: 2,
      source: draft.source,
      parameters: {},
      inputScope: 'Test data',
      inputs: [],
      outputs: [],
    });
  });

  it('normalizes assembled host and report context before creation and submission', async () => {
    const context = {
      ...source,
      host: { ...source.host, id: '  factor  ' },
      report: { type: 'factor' as const, id: '  report  ', contentHash: 'hash' },
    };
    const onEmbeddedAnalysis = vi.fn().mockResolvedValue(undefined);

    await runTool(context).run({ ...draft, title: '  Inspect data  ' }, { onEmbeddedAnalysis });

    expect(operations.create).toHaveBeenCalledExactlyOnceWith(
      'owner',
      {
        ...draft,
        title: 'Inspect data',
        inputScope: 'Test data',
        reportId: 'report',
        host: source.host,
      },
      context,
    );
    expect(operations.submit).toHaveBeenCalledExactlyOnceWith('owner', 'analysis', 'version', {
      requestId: expect.any(String),
      expectedRevision: 2,
    });
    expect(onEmbeddedAnalysis).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'validates composed input when repairing or deriving (frozen=%s)',
    async (frozen) => {
      operations.version.mockResolvedValue({ ...version, frozenAt: frozen ? 'frozen' : null });
      const context = {
        ...source,
        report: { type: 'factor' as const, id: '  report  ', contentHash: 'hash' },
      };

      await runTool(context).run(
        {
          ...draft,
          title: 'Inspect',
          parent: { analysisId: 'analysis', versionId: 'version', expectedRevision: 2 },
        },
        { onEmbeddedAnalysis: vi.fn() },
      );

      const normalized = { ...draft, inputScope: 'Test data', reportId: 'report' };
      if (frozen) {
        expect(operations.derive).toHaveBeenCalledExactlyOnceWith(
          'owner',
          'analysis',
          { parentVersionId: 'version', draft: normalized },
          context,
        );
        expect(operations.update).not.toHaveBeenCalled();
      } else {
        expect(operations.update).toHaveBeenCalledExactlyOnceWith(
          'owner',
          'analysis',
          'version',
          { ...normalized, expectedRevision: 2 },
          context,
        );
        expect(operations.derive).not.toHaveBeenCalled();
      }
    },
  );

  it('rejects malformed model input and invalid assembled context before writes', async () => {
    await expect(
      runTool().run({ ...draft, title: '   ' }, { onEmbeddedAnalysis: vi.fn() }),
    ).rejects.toThrow();
    await expect(
      runTool({ ...source, host: { ...source.host, id: '' } }).run(
        { ...draft, title: 'Inspect' },
        { onEmbeddedAnalysis: vi.fn() },
      ),
    ).rejects.toThrow();

    expect(operations.create).not.toHaveBeenCalled();
    expect(operations.submit).not.toHaveBeenCalled();
  });
});
