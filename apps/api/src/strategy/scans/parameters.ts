import type { z } from 'zod';
import { inspectWalledStrategyParameters } from '../runtime/typescript/walled-run.js';
import type { strategyScanParametersSchema } from './inputs.js';
import { t } from '../../i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from '../operation-errors.js';

export async function inspectStrategyScanParameters(
  input: z.infer<typeof strategyScanParametersSchema>,
  locale: Locale,
) {
  const body = input;

  if (body.language === 'python') {
    return failStrategyOperation('invalid', t(locale, 'strategyPythonScanUnsupported'));
  }

  try {
    const parameters = await inspectWalledStrategyParameters(body.code);

    return { parameters };
  } catch (error) {
    return failStrategyOperation('invalid', t(locale, 'strategyScanCodeInvalid'), {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
