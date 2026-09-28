import { ENGINE_FACTORS, FACTOR_KEY_PATTERN, type FactorDependency } from '@jixie/shared';
import { factorResearchSpecV1Schema } from '@jixie/shared/api/factor';
import {
  extractCustomFactorHistoryFields,
  type CustomFactorModule,
} from '#engine/factors/custom-factor.js';
import type { FactorDefinition } from '#engine/factors/execution-port.js';
import { BUILTIN_USER_ID } from '#factor/definitions/builtin-factors.js';
import { isResearchOnlyFactorV2Field } from '#factor/definitions/fields.js';
import { normalizeAnalysisKind } from '#factor/definitions/views.js';
import { sha256 } from '#factor/sources/fingerprint.js';
import { parseAssetFactorAnalysisSourceSnapshot } from '#factor/sources/snapshot.js';
import { StrategyError } from '../errors.js';

export type FactorUsage = 'research' | 'deployment' | 'signal';

export type StrategyFactorInput = Omit<CustomFactorModule, 'analysisKind'> &
  Omit<FactorDependency, 'inputs'>;

/** Strategy-side factor preparation, source identity and runtime metadata. */
export class StrategyFactor {
  private static readonly engineKeys = new Set<string>(ENGINE_FACTORS.map((factor) => factor.key));

  private readonly input: StrategyFactorInput;

  constructor(input: StrategyFactorInput) {
    this.input = structuredClone(input);
  }

  get key(): string {
    return this.input.key;
  }

  /** Extract literal factor keys from declarations and ctx.factor() calls without evaluating user code. */
  static extractKeys(source: string): string[] {
    const callKeys = [...source.matchAll(/\bctx\s*\.\s*factor\s*\(\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    );
    const declarationKeys = [...source.matchAll(/\bfactors\s*[:=]\s*\[([\s\S]*?)\]/g)].flatMap(
      (declaration) => [...declaration[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]),
    );
    const keys = [...callKeys, ...declarationKeys];
    return [
      ...new Set(
        keys.filter((key) => FACTOR_KEY_PATTERN.test(key) && !StrategyFactor.engineKeys.has(key)),
      ),
    ];
  }

  /** Load authorized published sources without starting a factor runtime. */
  static async prepare(
    source: string,
    userId: string,
    usage: FactorUsage = 'research',
  ): Promise<StrategyFactor[]> {
    const keys = StrategyFactor.extractKeys(source);
    if (keys.length === 0) {
      return [];
    }

    // Loading Prisma opens SQLite connections; source-only operations must not import it.
    const { prisma } = await import('#infra/database/prisma.js');
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
    return Promise.all(
      ordered.map(async (item): Promise<StrategyFactor> => {
        const row = item.row;
        const report = row.approvedReportId ? approvedReportById.get(row.approvedReportId) : null;
        const module =
          item.kind === 'factor'
            ? await StrategyFactor.prepareFactorModule(item.row, report?.spec)
            : await StrategyFactor.preparePanelCompositeModule(
                item.row,
                report?.snapshot,
                report?.spec,
              );
        return new StrategyFactor({
          ...module,
          factorId: row.id,
          key: row.key!,
          name: row.name,
          analysisKind:
            item.kind === 'factor' ? normalizeAnalysisKind(item.row.analysisKind) : 'panel',
          codeHash:
            item.kind === 'factor'
              ? (item.row.codeHash ?? sha256(item.row.code))
              : item.row.codeHash!,
          approvedReportId: row.approvedReportId,
          language:
            item.kind === 'factor' && item.row.language === 'python' ? 'python' : 'typescript',
          runtimeVersion:
            item.kind === 'factor' && item.row.runtimeVersion === 'py-v1' ? 'py-v1' : 'ts-v1',
        });
      }),
    );
  }

  /** Parse the immutable dependency snapshot stored in Prisma JSON. */
  static dependenciesFromJson(value: unknown): FactorDependency[] | null {
    if (value == null) {
      return null;
    }
    if (!Array.isArray(value)) {
      throw new Error('Invalid factor dependency snapshot');
    }
    return value.map((item) => {
      if (
        !StrategyFactor.isRecord(item) ||
        !StrategyFactor.isNonEmptyString(item.factorId) ||
        !StrategyFactor.isNonEmptyString(item.key) ||
        !StrategyFactor.isNonEmptyString(item.name) ||
        !StrategyFactor.isNonEmptyString(item.analysisKind) ||
        !StrategyFactor.isNonEmptyString(item.codeHash) ||
        (item.approvedReportId != null &&
          !StrategyFactor.isNonEmptyString(item.approvedReportId)) ||
        (item.inputs != null &&
          (!Array.isArray(item.inputs) || !item.inputs.every(StrategyFactor.isNonEmptyString)))
      ) {
        throw new Error('Invalid factor dependency snapshot');
      }
      return item as unknown as FactorDependency;
    });
  }

  /** Fail closed if persisted lineage and freshly resolved factors diverge. */
  static assertDependencies(expected: FactorDependency[] | null, actual: FactorDependency[]): void {
    if (expected == null) {
      return;
    }
    if (StrategyFactor.canonicalJson(expected) !== StrategyFactor.canonicalJson(actual)) {
      throw new Error('Factor dependency snapshot mismatch');
    }
  }

  /** Resolve a fresh set so scans cannot mutate the factors shared between runs. */
  static resolveAll(factors: StrategyFactor[], definitions: FactorDefinition[]): StrategyFactor[] {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const resolved = factors.map((factor) => {
      const definition = byId.get(factor.key);
      if (!definition) {
        throw new Error(`Missing factor metadata: ${factor.key}`);
      }
      return factor.resolveMetadata(definition);
    });
    const researchOnlyInputs = [
      ...new Set(
        resolved.flatMap((factor) =>
          (factor.input.assetSeries?.inputs ?? []).filter(isResearchOnlyFactorV2Field),
        ),
      ),
    ];
    if (researchOnlyInputs.length > 0) {
      throw new StrategyError('research_only_inputs_unavailable', {
        params: { fields: researchOnlyInputs.join(', ') },
      });
    }
    return resolved;
  }

  /** Return a new factor with metadata; keep the original source object reusable. */
  resolveMetadata(definition: FactorDefinition): StrategyFactor {
    if (definition.id !== this.key) {
      throw new Error(`Factor metadata does not match: ${this.key}`);
    }
    switch (definition.kind) {
      case 'cross_sectional':
        return new StrategyFactor({ ...this.input, crossSectional: { window: definition.window } });
      case 'asset_series':
        return new StrategyFactor({ ...this.input, assetSeries: definition.meta });
      case 'panel_composite':
        return new StrategyFactor({
          ...this.input,
          assetSeries: {
            window: Math.max(
              ...definition.components.map((component) => component.definition.meta.window),
            ),
            inputs: [
              ...new Set(
                definition.components.flatMap((component) => component.definition.meta.inputs),
              ),
            ],
          },
        });
    }
  }

  /** Preserve the engine's existing analysis-kind mapping and omit report identity. */
  toEngineModule(): CustomFactorModule {
    const factor = this.input;
    return structuredClone({
      key: factor.key,
      language: factor.language,
      runtimeVersion: factor.runtimeVersion,
      analysisKind:
        factor.analysisKind === 'macro_regime' ? 'cross_sectional' : factor.analysisKind,
      code: factor.code,
      js: factor.js,
      historyFields: factor.historyFields,
      crossSectional: factor.crossSectional,
      assetSeries: factor.assetSeries,
      assetUniverse: factor.assetUniverse,
      panelComposite: factor.panelComposite,
    });
  }

  /** Persist only lineage fields, never source or internal runtime configuration. */
  toDependency(): FactorDependency {
    const factor = this.input;
    return {
      factorId: factor.factorId,
      key: factor.key,
      name: factor.name,
      analysisKind: factor.analysisKind,
      language: factor.language,
      runtimeVersion: factor.runtimeVersion,
      codeHash: factor.codeHash,
      approvedReportId: factor.approvedReportId,
      ...(factor.assetSeries ? { inputs: [...factor.assetSeries.inputs] } : {}),
    };
  }

  private static async prepareFactorModule(
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

    let js: string | undefined;
    if (language === 'typescript') {
      const { toCommonJs } = await import('#infra/runtime/typescript/isolate-run.js');
      js = await toCommonJs(row.code, 'factor code');
    }

    return {
      key: row.key,
      language,
      runtimeVersion: language === 'python' ? 'py-v1' : 'ts-v1',
      analysisKind,
      ...(language === 'python' ? { code: row.code } : { js }),
      ...(analysisKind === 'cross_sectional'
        ? {
            historyFields:
              language === 'python'
                ? StrategyFactor.extractPythonFactorHistoryFields(row.code)
                : extractCustomFactorHistoryFields(row.code),
          }
        : {}),
      ...(analysisKind === 'panel' && reportSpec != null
        ? {
            assetUniverse: StrategyFactor.parseApprovedPanelUniverse(
              `panel factor ${row.key}`,
              reportSpec,
            ),
          }
        : {}),
    };
  }

  private static async preparePanelCompositeModule(
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
    const assetUniverse = StrategyFactor.parseApprovedPanelUniverse(
      `panel composite ${row.key}`,
      reportSpec,
    );
    const components = await Promise.all(
      source.components.map(async (component) => ({
        direction: component.direction,
        module: await StrategyFactor.prepareFactorModule({
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
      assetUniverse: assetUniverse.map((asset) => ({ ...asset })),
      panelComposite: {
        standardization: source.definition.standardization,
        assetUniverse: assetUniverse.map((asset) => ({ ...asset })),
        components,
      },
    };
  }

  private static extractPythonFactorHistoryFields(source: string) {
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

  private static parseApprovedPanelUniverse(
    subject: string,
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
      throw new Error(`${subject} has an invalid approved research universe`);
    }
    return parsed.data.assets.map((asset) => ({ ...asset }));
  }

  private static canonicalJson(dependencies: FactorDependency[]): string {
    return JSON.stringify(
      [...dependencies]
        .sort((left, right) => left.factorId.localeCompare(right.factorId))
        .map((dependency) => ({
          factorId: dependency.factorId,
          key: dependency.key,
          name: dependency.name,
          analysisKind: dependency.analysisKind,
          language: dependency.language ?? 'typescript',
          runtimeVersion:
            dependency.runtimeVersion ?? (dependency.language === 'python' ? 'py-v1' : 'ts-v1'),
          codeHash: dependency.codeHash,
          approvedReportId: dependency.approvedReportId ?? null,
          inputs: dependency.inputs ? [...dependency.inputs].sort() : null,
        })),
    );
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private static isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }
}
