import { inspectStrategyParameters } from './inspect-parameters.js';
import { UserCodeError } from '#infra/errors.js';
import { StrategyError } from '../errors.js';

import type { StrategyScanParametersInput } from '@jixie/shared/api/strategy';

export async function inspectStrategyScanParameters(input: StrategyScanParametersInput) {
  const body = input;

  if (body.language === 'python') {
    throw new StrategyError('strategy_python_scan_unsupported');
  }

  try {
    const parameters = await inspectStrategyParameters(body.code);

    return { parameters };
  } catch (error) {
    if (!(error instanceof UserCodeError)) {
      throw error;
    }
    throw new StrategyError('strategy_scan_code_invalid', {
      cause: error,
      details: {
        reason: error.message,
      },
    });
  }
}
