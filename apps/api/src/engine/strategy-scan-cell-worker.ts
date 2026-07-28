import type { BacktestConfig, Locale } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import type { CustomFactorModule } from './custom-factor.js';
import { prismaDataPort } from './prisma-port.js';
import { runWalledBacktest } from './walled-run.js';

interface CellRequest {
  config: BacktestConfig;
  customFactors: CustomFactorModule[];
  paramOverrides: Record<string, number>;
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
