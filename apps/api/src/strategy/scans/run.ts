import { t } from '#i18n/index.js';
import type { StrategyScanCell, StrategyScanPayload } from '@jixie/shared';
import { StrategyFactor } from '../factors/factor.js';
import type { StrategyScanWorkerInput } from './job-payload.js';
import { metricSummary, parameterCombinations, rebaseNav, scanCellOverrides } from './scan.js';
import { prismaDataPort } from '#backtesting/adapters/prisma-port.js';
import {
  StrategyExecution,
  type StrategyExecutionInput,
  type StrategyRunOptions,
} from '../execution/execution.js';

export async function runStrategyScan(
  input: StrategyScanWorkerInput,
  onSystemLog: (text: string) => void,
): Promise<StrategyScanPayload> {
  const { config, spec, parameters, ranges, userId, locale } = input;
  const factors = await StrategyFactor.fromStrategySource(config.code, userId);
  const combinations = parameterCombinations(spec);
  const cells: StrategyScanCell[] = [];

  for (let index = 0; index < combinations.length; index++) {
    const params = combinations[index];
    const values = Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    onSystemLog(
      t(locale, 'strategyScanCell', { current: index + 1, total: combinations.length, values }),
    );

    const overrides = scanCellOverrides(spec, params);
    const cell = {
      ...config,
      initialCash: overrides.initialCash ?? config.initialCash,
      factors,
      paramOverrides: overrides.paramOverrides,
      locale,
    };
    if ('full' in ranges) {
      const result = await runScanRange({ ...cell, ...ranges.full });
      cells.push({
        params,
        full: metricSummary(result),
        nav: spec.view === 'sizing' ? rebaseNav(result.nav, result.initialCash) : undefined,
      });
      continue;
    }

    const inSample = await runScanRange({ ...cell, ...ranges.inSample });
    const outOfSample = await runScanRange({ ...cell, ...ranges.outOfSample });
    cells.push({
      params,
      inSample: metricSummary(inSample),
      outOfSample: metricSummary(outOfSample),
    });
  }

  return { parameters, cells };
}

async function runScanRange(config: Omit<StrategyExecutionInput, 'dataPort'> & StrategyRunOptions) {
  const execution = await StrategyExecution.create({ ...config, dataPort: prismaDataPort });
  try {
    return (await execution.run(config)).result;
  } finally {
    execution.close();
  }
}
