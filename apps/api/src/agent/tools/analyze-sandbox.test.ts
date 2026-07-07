import { describe, expect, it } from 'vitest';
import { runAnalysisCode } from './analyze-sandbox.js';

const DATA = {
  a: [
    { tradeDate: '20240101', close: 100 },
    { tradeDate: '20240102', close: 110 },
    { tradeDate: '20240103', close: 121 },
  ],
};

describe('runAnalysisCode(analyzeData sandbox)', () => {
  it('runs the module and injects data and stats', async () => {
    const result = await runAnalysisCode(
      `export default ({ data, stats }) => {
         const closes = data.a.map((row) => row.close);
         const returns = closes.slice(1).map((close, i) => close / closes[i] - 1);
         return { meanReturn: stats.mean(returns), n: returns.length };
       }`,
      DATA,
    );
    expect(result).toEqual({ meanReturn: expect.closeTo(0.1, 10), n: 2 });
  });

  it('tolerates TS type annotations and async modules', async () => {
    const result = await runAnalysisCode(
      `export default async ({ data }: { data: any }): Promise<number> => data.a.length;`,
      DATA,
    );
    expect(result).toBe(3);
  });

  it('reports a readable error when the default export is missing', async () => {
    await expect(runAnalysisCode(`export const x = 1;`, DATA)).rejects.toThrow(/export default/);
  });

  it('surfaces the error message when the code throws at runtime', async () => {
    await expect(
      runAnalysisCode(`export default () => { throw new Error('boom'); }`, DATA),
    ).rejects.toThrow(/boom/);
  });

  it('rejects importing external modules (an unused import is dropped by esbuild, so the case must actually use it)', async () => {
    await expect(
      runAnalysisCode(
        `import fs from 'fs'; export default () => fs.readFileSync('/etc/hosts');`,
        DATA,
      ),
    ).rejects.toThrow(/cannot import external module/);
  });

  it('reports a compilation failure on a syntax error', async () => {
    await expect(runAnalysisCode(`export default ({) => 1`, DATA)).rejects.toThrow(
      /compilation failed/,
    );
  });

  it('prototype-chain escape cannot reach the host (no process/require in the isolate global)', async () => {
    const result = await runAnalysisCode(
      `export default () => {
         const escaped = ({}).constructor.constructor('return globalThis.process')();
         return { processType: typeof escaped, requireType: typeof globalThis.require };
       }`,
      DATA,
    );
    expect(result).toEqual({ processType: 'undefined', requireType: 'undefined' });
  });

  it('kills an infinite loop via the CPU timeout', async () => {
    await expect(
      runAnalysisCode(`export default () => { for (;;) {} }`, DATA, { timeoutMs: 500 }),
    ).rejects.toThrow(/execution error/);
  }, 15000);
});
