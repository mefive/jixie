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
import { parseAssetFactorAnalysisSourceSnapshot } from '../factor/analysis-job.js';
import { isResearchOnlyFactorV2Field } from '../factor/factor-v2-fields.js';
import { factorResearchSpecV1Schema, sha256 } from '../factor/report-spec.js';
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

  const factorRows = await prisma.factor.findMany({
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
  const compositeRows = await prisma.factorComposite.findMany({
    where: {
      key: { in: keys },
      userId,
      status: { in: usage === 'deployment' ? ['published'] : ['published', 'archived'] },
    },
    select: {
      id: true,
      key: true,
      name: true,
      status: true,
      codeHash: true,
      approvedReportId: true,
    },
  });
  const approvedReportIds = [
    ...factorRows.flatMap((row) => (row.approvedReportId ? [row.approvedReportId] : [])),
    ...compositeRows.flatMap((row) => (row.approvedReportId ? [row.approvedReportId] : [])),
  ];
  const approvedReports = await prisma.factorReport.findMany({
    where: { id: { in: approvedReportIds } },
    select: { id: true, factorCodeSnapshot: true, specJson: true },
  });
  const approvedReportById = new Map(
    approvedReports.map((report) => [
      report.id,
      { snapshot: report.factorCodeSnapshot, spec: report.specJson },
    ]),
  );
  const byKey = new Map<
    string,
    | { kind: 'factor'; row: (typeof factorRows)[number] }
    | { kind: 'composite'; row: (typeof compositeRows)[number] }
  >();
  factorRows.forEach((row) => byKey.set(row.key, { kind: 'factor', row }));
  compositeRows.forEach((row) => {
    if (row.key) {
      byKey.set(row.key, { kind: 'composite', row });
    }
  });
  const missing = keys.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    throw new Error(t(locale, 'customFactorMissing', { keys: missing.join(', ') }));
  }

  const ordered = keys.map((key) => byKey.get(key)!);
  const modules = await Promise.all(
    ordered.map((item) => {
      if (item.kind === 'factor') {
        const report = item.row.approvedReportId
          ? approvedReportById.get(item.row.approvedReportId)
          : null;
        return prepareFactorModule(item.row, report?.spec);
      }
      const reportId = item.row.approvedReportId;
      const approvedReport = reportId ? approvedReportById.get(reportId) : null;
      return preparePanelCompositeModule(item.row, approvedReport?.snapshot, approvedReport?.spec);
    }),
  );
  const researchOnlyInputs = [
    ...new Set(
      modules.flatMap((module) =>
        (module.assetSeries?.inputs ?? []).filter(isResearchOnlyFactorV2Field),
      ),
    ),
  ];
  if (researchOnlyInputs.length > 0) {
    throw new Error(
      t(locale, 'factorResearchOnlyInputsUnavailable', {
        fields: researchOnlyInputs.join(', '),
      }),
    );
  }

  return {
    modules,
    factors: ordered.map((item, index) => {
      const row = item.row;
      return {
        factorId: row.id,
        key: row.key!,
        name: row.name,
        analysisKind:
          item.kind === 'factor'
            ? normalizeAnalysisKind(item.row.analysisKind)
            : ('panel' as const),
        codeHash:
          item.kind === 'factor'
            ? (item.row.codeHash ?? sha256(item.row.code))
            : item.row.codeHash!,
        approvedReportId: row.approvedReportId,
        ...(modules[index]?.assetSeries ? { inputs: [...modules[index].assetSeries.inputs] } : {}),
      };
    }),
  };
}

export async function prepareCustomFactors(
  source: string,
  userId: string,
  locale: Locale,
): Promise<CustomFactorModule[]> {
  return (await prepareStrategyFactors(source, userId, locale)).modules;
}

async function prepareFactorModule(
  row: {
    key: string;
    code: string;
    analysisKind: string;
  },
  reportSpec?: unknown,
): Promise<CustomFactorModule> {
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
      ...(row.analysisKind === 'panel' && reportSpec != null
        ? { assetUniverse: parseApprovedPanelUniverse(row.key, reportSpec) }
        : {}),
    };
  } finally {
    compiled?.dispose();
  }
}

async function preparePanelCompositeModule(
  row: {
    id: string;
    key: string | null;
    codeHash: string | null;
  },
  snapshot: string | null | undefined,
  reportSpec: unknown,
): Promise<CustomFactorModule> {
  if (!row.key || !row.codeHash || !snapshot || sha256(snapshot) !== row.codeHash) {
    throw new Error(`panel composite ${row.key ?? row.id} has invalid publication lineage`);
  }
  const source = parseAssetFactorAnalysisSourceSnapshot(snapshot, row.key, 'panel');
  if (
    source.kind !== 'panel_composite' ||
    source.definition.key !== row.key ||
    source.components.length !== source.definition.components.length
  ) {
    throw new Error(`panel composite ${row.key} has an invalid frozen source`);
  }
  let parsedReportSpec: unknown = reportSpec;
  if (typeof reportSpec === 'string') {
    try {
      parsedReportSpec = JSON.parse(reportSpec);
    } catch {
      parsedReportSpec = null;
    }
  }
  const parsedSpec = factorResearchSpecV1Schema.safeParse(parsedReportSpec);
  if (!parsedSpec.success || parsedSpec.data.analysisKind !== 'panel') {
    throw new Error(`panel composite ${row.key} has an invalid approved research universe`);
  }
  const components = await Promise.all(
    source.components.map(async (component) => ({
      direction: component.direction,
      module: await prepareFactorModule({
        key: component.factor,
        code: component.code,
        analysisKind: 'panel',
      }),
    })),
  );
  const assetSeries = {
    window: Math.max(...components.map((component) => component.module.assetSeries!.window)),
    inputs: [...new Set(components.flatMap((component) => component.module.assetSeries!.inputs))],
  };
  return {
    key: row.key,
    analysisKind: 'panel',
    assetSeries,
    assetUniverse: parsedSpec.data.assets.map((asset) => ({ ...asset })),
    panelComposite: {
      standardization: source.definition.standardization,
      assetUniverse: parsedSpec.data.assets.map((asset) => ({ ...asset })),
      components,
    },
  };
}

function parseApprovedPanelUniverse(
  key: string,
  reportSpec: unknown,
): Array<{ assetId: string; assetClass: import('@jixie/shared').MultiAssetClass }> {
  let parsedReportSpec = reportSpec;
  if (typeof reportSpec === 'string') {
    try {
      parsedReportSpec = JSON.parse(reportSpec);
    } catch {
      parsedReportSpec = null;
    }
  }
  const parsed = factorResearchSpecV1Schema.safeParse(parsedReportSpec);
  if (!parsed.success || parsed.data.analysisKind !== 'panel') {
    throw new Error(`panel factor ${key} has an invalid approved research universe`);
  }
  return parsed.data.assets.map((asset) => ({ ...asset }));
}
