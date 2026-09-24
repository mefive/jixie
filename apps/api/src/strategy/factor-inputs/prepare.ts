import {
  extractCustomFactorHistoryFields,
  type CustomFactorModule,
} from '#engine/factors/custom-factor.js';
import { BUILTIN_USER_ID } from '#factor/definitions/builtin-factors.js';
import { normalizeAnalysisKind } from '#factor/definitions/views.js';

import { factorResearchSpecV1Schema } from '@jixie/shared/api/factor';
import { sha256 } from '#factor/sources/fingerprint.js';
import { parseAssetFactorAnalysisSourceSnapshot } from '#factor/sources/snapshot.js';
import { prisma } from '#infra/database/prisma.js';
import { toCommonJs } from '#infra/runtime/typescript/isolate-run.js';
import type { FactorDependency } from '@jixie/shared';
import { StrategyError } from '../errors.js';
import { extractFactorKeys } from './references.js';

export type FactorUsage = 'research' | 'deployment' | 'signal';

export interface PreparedStrategyFactors {
  modules: CustomFactorModule[];
  factors: FactorDependency[];
}

export async function prepareStrategyFactors(
  source: string,
  userId: string,
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
      language: true,
      runtimeVersion: true,
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
    throw new StrategyError('custom_factor_missing', { params: { keys: missing.join(', ') } });
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

  return {
    modules,
    factors: ordered.map((item) => {
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
        language:
          item.kind === 'factor' && item.row.language === 'python' ? 'python' : 'typescript',
        runtimeVersion:
          item.kind === 'factor' && item.row.runtimeVersion === 'py-v1' ? 'py-v1' : 'ts-v1',
      };
    }),
  };
}

async function prepareFactorModule(
  row: {
    key: string;
    code: string;
    analysisKind: string;
    language?: string;
    runtimeVersion?: string;
  },
  reportSpec?: unknown,
): Promise<CustomFactorModule> {
  const analysisKind =
    row.analysisKind === 'time_series' || row.analysisKind === 'panel'
      ? row.analysisKind
      : 'cross_sectional';
  const language = row.language === 'python' ? 'python' : 'typescript';
  if (language === 'python' && row.runtimeVersion !== 'py-v1') {
    throw new Error(`factor ${row.key} has an invalid Python runtime version`);
  }

  return {
    key: row.key,
    language,
    runtimeVersion: language === 'python' ? 'py-v1' : 'ts-v1',
    analysisKind,
    ...(language === 'python'
      ? { code: row.code }
      : { js: await toCommonJs(row.code, 'factor code') }),
    ...(analysisKind === 'cross_sectional'
      ? {
          historyFields:
            language === 'python'
              ? extractPythonFactorHistoryFields(row.code)
              : extractCustomFactorHistoryFields(row.code),
        }
      : {}),
    ...(analysisKind === 'panel' && reportSpec != null
      ? { assetUniverse: parseApprovedPanelUniverse(row.key, reportSpec) }
      : {}),
  };
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
        language: component.language,
        runtimeVersion: component.runtimeVersion,
      }),
    })),
  );
  return {
    key: row.key,
    analysisKind: 'panel',
    assetUniverse: parsedSpec.data.assets.map((asset) => ({ ...asset })),
    panelComposite: {
      standardization: source.definition.standardization,
      assetUniverse: parsedSpec.data.assets.map((asset) => ({ ...asset })),
      components,
    },
  };
}

function extractPythonFactorHistoryFields(source: string) {
  return [
    source.includes('"turnover_rate_f"') || source.includes("'turnover_rate_f'")
      ? ('turnoverRateF' as const)
      : null,
    source.includes('"roe"') || source.includes("'roe'") ? ('roe' as const) : null,
    source.includes('"grossprofit_margin"') || source.includes("'grossprofit_margin'")
      ? ('grossprofitMargin' as const)
      : null,
    source.includes('"market_close"') || source.includes("'market_close'")
      ? ('marketClose' as const)
      : null,
  ].filter((field): field is NonNullable<typeof field> => field != null);
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
