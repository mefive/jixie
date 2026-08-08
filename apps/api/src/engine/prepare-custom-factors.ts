import {
  ENGINE_FACTORS,
  FACTOR_KEY_PATTERN,
  type FactorDependency,
  type Locale,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { toCommonJs } from '../lib/isolate-run.js';
import { BUILTIN_USER_ID } from '../factor/builtin-factors.js';
import {
  compilePanelFactor,
  compileTimeSeriesFactor,
} from '../factor/compile-time-series-factor.js';
import { normalizeAnalysisKind } from '../factor/publication.js';
import { sha256 } from '../factor/report-spec.js';
import { t } from '../i18n/messages.js';
import { extractCustomFactorHistoryFields, type CustomFactorModule } from './custom-factor.js';

const ENGINE_FACTOR_KEYS = new Set<string>(ENGINE_FACTORS.map((factor) => factor.key));

/** Extract literal factor keys from declarations and ctx.factor() calls without evaluating user code. */
export function extractFactorKeys(source: string): string[] {
  const callKeys = [...source.matchAll(/\bctx\s*\.\s*factor\s*\(\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
  const declarationKeys = [...source.matchAll(/\bfactors\s*:\s*\[([\s\S]*?)\]/g)].flatMap(
    (declaration) => [...declaration[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]),
  );
  const keys = [...callKeys, ...declarationKeys];
  return [
    ...new Set(keys.filter((key) => FACTOR_KEY_PATTERN.test(key) && !ENGINE_FACTOR_KEYS.has(key))),
  ];
}

export type FactorUsage = 'research' | 'deployment' | 'signal';

export interface PreparedStrategyFactors {
  modules: CustomFactorModule[];
  factors: FactorDependency[];
}

export async function prepareStrategyFactors(
  source: string,
  userId: string,
  locale: Locale,
  usage: FactorUsage = 'research',
): Promise<PreparedStrategyFactors> {
  const keys = extractFactorKeys(source);
  if (keys.length === 0) {
    return { modules: [], factors: [] };
  }

  const rows = await prisma.factor.findMany({
    where: {
      key: { in: keys },
      userId: { in: [userId, BUILTIN_USER_ID] },
      status: { in: usage === 'deployment' ? ['published'] : ['published', 'archived'] },
    },
    select: {
      id: true,
      key: true,
      name: true,
      code: true,
      analysisKind: true,
      codeHash: true,
      approvedReportId: true,
      userId: true,
    },
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const missing = keys.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    throw new Error(t(locale, 'customFactorMissing', { keys: missing.join(', ') }));
  }

  const ordered = keys.map((key) => byKey.get(key)!);
  const modules = await Promise.all(ordered.map(prepareFactorModule));

  return {
    modules,
    factors: ordered.map((row, index) => ({
      factorId: row.id,
      key: row.key,
      name: row.name,
      analysisKind: normalizeAnalysisKind(row.analysisKind),
      codeHash: row.codeHash ?? sha256(row.code),
      approvedReportId: row.approvedReportId,
      ...(modules[index]?.assetSeries ? { inputs: [...modules[index].assetSeries.inputs] } : {}),
    })),
  };
}

export async function prepareCustomFactors(
  source: string,
  userId: string,
  locale: Locale,
): Promise<CustomFactorModule[]> {
  return (await prepareStrategyFactors(source, userId, locale)).modules;
}

async function prepareFactorModule(row: {
  key: string;
  code: string;
  analysisKind: string;
}): Promise<CustomFactorModule> {
  if (row.analysisKind !== 'time_series' && row.analysisKind !== 'panel') {
    return {
      key: row.key,
      js: await toCommonJs(row.code, 'factor code'),
      historyFields: extractCustomFactorHistoryFields(row.code),
    };
  }

  let compiled:
    | Awaited<ReturnType<typeof compileTimeSeriesFactor>>
    | Awaited<ReturnType<typeof compilePanelFactor>>
    | null = null;
  try {
    compiled =
      row.analysisKind === 'panel'
        ? await compilePanelFactor(row.code)
        : await compileTimeSeriesFactor(row.code);
    return {
      key: row.key,
      js: await toCommonJs(row.code, 'factor code'),
      analysisKind: row.analysisKind,
      assetSeries: { window: compiled.window, inputs: [...compiled.inputs] },
    };
  } finally {
    compiled?.dispose();
  }
}
