import { z } from 'zod';
import { proposeStrategyName } from './naming.js';
import { t } from '../../i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failStrategyOperation } from '../operation-errors.js';

export const strategyNameInputSchema = z
  .object({
    code: z.string().max(50_000).optional(),
    prompt: z.string().max(2000).optional(),
    currentName: z.string().max(100).optional(),
  })
  .refine((body) => body.code || body.prompt, { message: 'code or prompt required' });

export async function requestStrategyName(
  input: z.infer<typeof strategyNameInputSchema>,
  locale: Locale,
) {
  const { code, prompt, currentName } = input;

  try {
    const name = await proposeStrategyName({
      code,
      prompt,
      currentName,
      locale: locale,
    });

    return { name: name || t(locale, 'unnamedStrategy') };
  } catch (e) {
    return failStrategyOperation(
      'unavailable',
      e instanceof Error ? e.message : t(locale, 'nameFailed'),
    );
  }
}
