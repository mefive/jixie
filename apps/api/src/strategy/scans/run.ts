import { t } from '#i18n/index.js';
import type { StrategyScanCell, StrategyScanPayload } from '@jixie/shared';
import { prepareStrategyFactors } from '../factor-inputs/prepare.js';
import type { StrategyScanWorkerInput } from './job-payload.js';
import { metricSummary, parameterCombinations, rebaseNav, scanCellOverrides } from './scan.js';
import { prismaDataPort } from '#engine/adapters/prisma-port.js';
import { runSandboxedBacktest } from '../execution/simulation.js';

export async function runStrategyScan(
  input: StrategyScanWorkerInput,
  onSystemLog: (text: string) => void,
): Promise<StrategyScanPayload> {
  const { config, spec, parameters, ranges, userId, locale } = input;
  const { modules: customFactors } = await prepareStrategyFactors(config.code, userId);
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
      customFactors,
      paramOverrides: overrides.paramOverrides,
      locale,
    };
    if ('full' in ranges) {
      const result = await runSandboxedBacktest({ ...cell, ...ranges.full }, prismaDataPort);
      cells.push({
        params,
        full: metricSummary(result),
        nav: spec.view === 'sizing' ? rebaseNav(result.nav, result.initialCash) : undefined,
      });
      continue;
    }

    const inSample = await runSandboxedBacktest({ ...cell, ...ranges.inSample }, prismaDataPort);
    const outOfSample = await runSandboxedBacktest(
      { ...cell, ...ranges.outOfSample },
      prismaDataPort,
    );
    cells.push({
      params,
      inSample: metricSummary(inSample),
      outOfSample: metricSummary(outOfSample),
    });
  }

  return { parameters, cells };
}
