import type { ScanCellWorkerMessage } from './cell-worker-protocol.js';
import type { BacktestConfig, Locale, StrategyParamValue } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import type { CustomFactorModule } from '#engine/factors/custom-factor.js';
import { prismaDataPort } from '#engine/adapters/prisma-port.js';
import { runSandboxedBacktest } from '../runtime/run.js';

interface CellRequest {
  config: BacktestConfig;
  customFactors: CustomFactorModule[];
  paramOverrides: Record<string, StrategyParamValue>;
  locale: Locale;
}

const send = (message: ScanCellWorkerMessage) => process.send?.(message);

const exitOrphanedCell = () => process.exit(1);
process.once('disconnect', exitOrphanedCell);

process.once('message', async (data: CellRequest) => {
  try {
    const { config, customFactors, paramOverrides, locale } = data;
    const result = await runSandboxedBacktest(
      {
        ...config,
        customFactors,
        paramOverrides,
        locale,
      },
      prismaDataPort,
    );
    send({ type: 'done', result });
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await prisma.$disconnect();
    process.removeListener('disconnect', exitOrphanedCell);
    process.disconnect();
  }
});
