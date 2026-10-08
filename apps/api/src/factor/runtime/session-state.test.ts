import { afterEach, describe, expect, it } from 'vitest';
import { FactorRuntime } from './factor-runtime.js';
import type { FactorBar, FactorLanguage } from '@jixie/shared';
import type { ExecutableFactorKind, FactorValues } from './contract.js';

const previousPythonLocal = process.env.JIXIE_PYTHON_LOCAL;
const bar: FactorBar = {
  code: 'ETF',
  pe: null,
  peTtm: null,
  pb: null,
  ps: null,
  psTtm: null,
  dvRatio: null,
  dvTtm: null,
  totalMv: null,
  circMv: null,
  turnoverRate: null,
  netMain: null,
  netTotal: null,
  roe: null,
  roa: null,
  grossprofitMargin: null,
  debtToAssets: null,
};

function source(language: FactorLanguage, analysisKind: ExecutableFactorKind): string {
  if (language === 'python') {
    const declaration =
      analysisKind === 'cross_sectional'
        ? 'Factor.cross_sectional(name="stateful")'
        : `Factor.${analysisKind}(name="stateful", inputs=["etf.adjustedClose"], target_asset_classes=["equity"], window=2)`;

    return `
from jixie import Factor
factor = ${declaration}
callbacks = 0
@factor.compute
def compute(*args):
    global callbacks
    callbacks += 1
    return callbacks
`;
  }

  const declaration =
    analysisKind === 'cross_sectional'
      ? 'defineFactor({ name: "stateful", compute() { return ++callbacks; } })'
      : `defineFactorV2({ version: 2, name: "stateful", analysisKind: "${analysisKind}",
        outputScope: "asset", frequency: "daily", inputs: ["etf.adjustedClose"],
        targetAssetClasses: ["equity"], window: 2, compute() { return ++callbacks; } })`;

  return `let callbacks = 0; export default ${declaration};`;
}

async function runSession(
  language: FactorLanguage,
  analysisKind: ExecutableFactorKind,
): Promise<FactorValues[]> {
  const code = source(language, analysisKind);

  if (analysisKind === 'cross_sectional') {
    const runtime = await FactorRuntime.start({ language, analysisKind, code });
    try {
      return [
        await runtime.execute({ items: [{ bar }, { bar }] }),
        await runtime.execute({ items: [{ bar }] }),
      ];
    } finally {
      runtime.close();
    }
  }

  const runtime = await FactorRuntime.start({ language, analysisKind, code });
  const fields = { 'etf.adjustedClose': [1, 2] };
  try {
    return [
      await runtime.execute({ fields, indexes: [0, 1] }),
      await runtime.execute({ fields, indexes: [1] }),
    ];
  } finally {
    runtime.close();
  }
}

afterEach(() => {
  if (previousPythonLocal === undefined) {
    delete process.env.JIXIE_PYTHON_LOCAL;
  } else {
    process.env.JIXIE_PYTHON_LOCAL = previousPythonLocal;
  }
});

describe.each(['typescript', 'python'] as const)('%s factor sandbox session state', (language) => {
  it.each(['cross_sectional', 'time_series', 'panel'] as const)(
    'retains %s callback state across batches and starts fresh in a new session',
    async (analysisKind) => {
      if (language === 'python' && !process.env.JIXIE_SANDBOX_SOCKET) {
        process.env.JIXIE_PYTHON_LOCAL = '1';
      }
      const sessions: FactorValues[][] = [];

      for (let index = 0; index < 2; index++) {
        sessions.push(await runSession(language, analysisKind));
      }

      expect(sessions).toEqual([
        [[1, 2], [3]],
        [[1, 2], [3]],
      ]);
    },
  );
});
