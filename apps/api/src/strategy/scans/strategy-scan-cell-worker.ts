import type { BacktestConfig, Locale, StrategyParamValue } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import type { CustomFactorModule } from '../../engine/factors/custom-factor.js';
import { prismaDataPort } from '../../engine/adapters/prisma-port.js';
import { runWalledBacktest } from '../runtime/typescript/walled-run.js';

interface CellRequest {
  config: BacktestConfig;
  customFactors: CustomFactorModule[];
  paramOverrides: Record<string, StrategyParamValue>;
  locale: Locale;
}

process.once('message', async (data: CellRequest) => {
  try {
    const { config, customFactors, paramOverrides, locale } = data;
    const result = await runWalledBacktest(
      {
        ...config,
        customFactors,
        paramOverrides,
        locale,
      },
      prismaDataPort,
    );
    process.send?.({ type: 'done', result });
  } catch (error) {
    process.send?.({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await prisma.$disconnect();
    process.disconnect();
  }
});
