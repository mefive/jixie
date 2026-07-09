import { CUSTOM_FACTOR_PREFIX, customFactorId, type Locale } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { toCommonJs } from '../lib/isolate-run.js';
import { t } from '../i18n/messages.js';
import { BUILTIN_USER_ID } from '../factor/builtin-factors.js';
import type { CustomFactorModule } from './custom-factor.js';

/**
 * HOST-side preparation of the custom factors a strategy references (factor-to-strategy.md Step 2).
 * Runs in the worker (which knows userId) BEFORE the engine starts: load the Factor rows —
 * ownership-scoped to the caller + the builtin presets — and TS→CJS-transform each module (esbuild
 * can't run in-wall). The engine then evaluates them in its own world (custom-factor.ts).
 *
 * Keys are found by scanning the strategy SOURCE for `custom:<id>` literals rather than evaluating
 * the module: on the walled lane the strategy only ever evaluates inside the isolate, and running
 * DB-origin code host-side just to read its `factors` array is exactly what the wall forbids.
 * Over-matching (a key in a comment) merely preloads an unused factor — harmless.
 */
export function extractCustomFactorKeys(source: string): string[] {
  return [...new Set(source.match(/custom:[A-Za-z0-9_-]{1,32}/g) ?? [])];
}

export async function prepareCustomFactors(
  source: string,
  userId: string,
  locale: Locale,
): Promise<CustomFactorModule[]> {
  const keys = extractCustomFactorKeys(source);
  if (keys.length === 0) {
    return [];
  }

  const rows = await prisma.factor.findMany({
    where: {
      id: { in: keys.map(customFactorId) },
      userId: { in: [userId, BUILTIN_USER_ID] }, // own factors + the read-only presets
    },
    select: { id: true, code: true },
  });
  const codeById = new Map(rows.map((row) => [row.id, row.code]));

  const missingKeys = keys.filter((key) => !codeById.has(customFactorId(key)));
  if (missingKeys.length > 0) {
    throw new Error(t(locale, 'customFactorMissing', { keys: missingKeys.join(', ') }));
  }

  return Promise.all(
    rows.map(async (row) => ({
      key: CUSTOM_FACTOR_PREFIX + row.id,
      js: await toCommonJs(row.code, 'factor code'),
    })),
  );
}
