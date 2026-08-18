import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESEARCH_SERIES_SDK_CONTRACT_V1 } from '@jixie/shared';
import { ResearchPythonInterruptionError, researchRuntimeManager } from './workbench-runtime.js';

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
