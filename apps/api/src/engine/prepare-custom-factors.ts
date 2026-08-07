import {
  CUSTOM_FACTOR_PREFIX,
  FACTOR_RELEASE_PREFIX,
  customFactorId,
  factorReleaseId,
  type FactorReleaseDependency,
  type Locale,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { toCommonJs } from '../lib/isolate-run.js';
import { t } from '../i18n/messages.js';
import { BUILTIN_USER_ID } from '../factor/builtin-factors.js';
import { compileTimeSeriesFactor } from '../factor/compile-time-series-factor.js';
import { extractCustomFactorHistoryFields, type CustomFactorModule } from './custom-factor.js';

/**
 * HOST-side preparation of the custom factors a strategy references (factor-to-strategy.md Step 2).
 * Runs in the worker (which knows userId) BEFORE the engine starts: load the Factor rows —
 * ownership-scoped to the caller + the builtin presets — and TS→CJS-transform each module (esbuild
 * can't run in-wall). The engine then evaluates them in its own world (custom-factor.ts).
 *
 * Keys are found by scanning the strategy SOURCE for `custom:<key>` literals rather than evaluating
 * the module: on the walled lane the strategy only ever evaluates inside the isolate, and running
 * DB-origin code host-side just to read its `factors` array is exactly what the wall forbids.
 * Over-matching (a key in a comment) merely preloads an unused factor — harmless.
 */
export function extractCustomFactorKeys(source: string): string[] {
  return [...new Set(source.match(/custom:[a-z][a-z0-9_]{0,31}/g) ?? [])];
}

export function extractFactorReleaseKeys(source: string): string[] {
  return [
    ...new Set(
      (source.match(/release:[0-9A-HJKMNP-TV-Z]{26}/gi) ?? []).map(
        (key) => FACTOR_RELEASE_PREFIX + key.slice(FACTOR_RELEASE_PREFIX.length).toUpperCase(),
      ),
    ),
  ];
}

export type FactorReleaseUsage = 'research' | 'production';

export interface PreparedStrategyFactors {
  modules: CustomFactorModule[];
  releases: FactorReleaseDependency[];
}

export async function prepareStrategyFactors(
  source: string,
  userId: string,
  locale: Locale,
  usage: FactorReleaseUsage = 'research',
): Promise<PreparedStrategyFactors> {
  const [legacyModules, releaseData] = await Promise.all([
    prepareLegacyCustomFactors(source, userId, locale),
    prepareFactorReleases(source, userId, locale, usage),
  ]);
  return {
    modules: [...legacyModules, ...releaseData.modules],
    releases: releaseData.releases,
  };
}

export async function prepareCustomFactors(
  source: string,
  userId: string,
  locale: Locale,
): Promise<CustomFactorModule[]> {
  return (await prepareStrategyFactors(source, userId, locale)).modules;
}

async function prepareLegacyCustomFactors(
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
      key: { in: keys.map(customFactorId) },
      userId: { in: [userId, BUILTIN_USER_ID] }, // own factors + the read-only presets
    },
    select: { key: true, code: true },
  });
  const codeByKey = new Map(rows.map((row) => [row.key, row.code]));

  const missingKeys = keys.filter((key) => !codeByKey.has(customFactorId(key)));
  if (missingKeys.length > 0) {
    throw new Error(t(locale, 'customFactorMissing', { keys: missingKeys.join(', ') }));
  }

  return Promise.all(
    rows.map(async (row) => ({
      key: CUSTOM_FACTOR_PREFIX + row.key,
      js: await toCommonJs(row.code, 'factor code'),
      historyFields: extractCustomFactorHistoryFields(row.code),
    })),
  );
}

async function prepareFactorReleases(
  source: string,
  userId: string,
  locale: Locale,
  usage: FactorReleaseUsage,
): Promise<PreparedStrategyFactors> {
  const keys = extractFactorReleaseKeys(source);
  if (keys.length === 0) {
    return { modules: [], releases: [] };
  }
  const ids = keys.map(factorReleaseId);
  const rows = await prisma.factorRelease.findMany({
    where: { id: { in: ids }, userId },
    select: {
      id: true,
      releaseKey: true,
      sourceRef: true,
      version: true,
      sourceKind: true,
      codeSnapshot: true,
      codeHash: true,
      approvedReportId: true,
      methodologySnapshot: true,
      maturity: true,
      lifecycle: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(
      t(locale, 'customFactorMissing', {
        keys: missing.map((id) => FACTOR_RELEASE_PREFIX + id).join(', '),
      }),
    );
  }

  const ordered = ids.map((id) => byId.get(id)!);
  for (const row of ordered) {
    const label = `${row.releaseKey}@v${row.version}`;
    if (row.sourceKind !== 'single') {
      throw new Error(t(locale, 'factorReleaseRuntimeUnsupported', { key: label }));
    }
    const analysisKind = releaseAnalysisKind(row.methodologySnapshot);
    if (analysisKind !== 'cross_sectional' && analysisKind !== 'time_series') {
      throw new Error(t(locale, 'factorReleaseRuntimeUnsupported', { key: label }));
    }
    if (usage === 'production' && analysisKind === 'time_series') {
      throw new Error(t(locale, 'factorTimeSeriesReleaseProductionUnsupported', { key: label }));
    }
    if (usage === 'production' && (row.maturity !== 'production' || row.lifecycle !== 'active')) {
      throw new Error(t(locale, 'factorReleaseProductionRequired', { key: label }));
    }
  }

  return {
    modules: await Promise.all(ordered.map(prepareReleaseModule)),
    releases: ordered.map((row) => ({
      releaseId: row.id,
      sourceId: row.sourceRef,
      releaseKey: row.releaseKey,
      version: row.version,
      codeHash: row.codeHash,
      approvedReportId: row.approvedReportId,
      maturity:
        row.maturity === 'validated' || row.maturity === 'production'
          ? row.maturity
          : 'experimental',
    })),
  };
}

function releaseAnalysisKind(value: unknown): string {
  if (value && typeof value === 'object' && 'analysisKind' in value) {
    return String((value as { analysisKind: unknown }).analysisKind);
  }
  // Releases created before methodology snapshots carried an analysis kind used the original
  // cross-sectional Factor SDK. Keeping that compatibility does not guess for new unknown kinds.
  return 'cross_sectional';
}

async function prepareReleaseModule(row: {
  id: string;
  codeSnapshot: string;
  methodologySnapshot: unknown;
}): Promise<CustomFactorModule> {
  const key = FACTOR_RELEASE_PREFIX + row.id;
  if (releaseAnalysisKind(row.methodologySnapshot) !== 'time_series') {
    return {
      key,
      js: await toCommonJs(row.codeSnapshot, 'factor release code'),
      historyFields: extractCustomFactorHistoryFields(row.codeSnapshot),
    };
  }

  let compiled: Awaited<ReturnType<typeof compileTimeSeriesFactor>> | null = null;
  try {
    compiled = await compileTimeSeriesFactor(row.codeSnapshot);
    return {
      key,
      js: await toCommonJs(row.codeSnapshot, 'factor release code'),
      analysisKind: 'time_series',
      timeSeries: { window: compiled.window, inputs: [...compiled.inputs] },
    };
  } finally {
    compiled?.dispose();
  }
}
