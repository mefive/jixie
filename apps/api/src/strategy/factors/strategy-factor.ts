import { ENGINE_FACTORS, FACTOR_KEY_PATTERN, type FactorDependency } from '@jixie/shared';
import { factorResearchSpecV1Schema } from '@jixie/shared/api/factor';
import type {
  FactorHistoryField,
  FactorInputRequirements,
  FactorDefinition,
} from '#backtesting/factors/execution-port.js';
import { BUILTIN_USER_ID } from '#factor/definitions/builtin-factors.js';
import { isResearchOnlyFactorV2Field } from '#factor/definitions/fields.js';
import { normalizeAnalysisKind } from '#factor/definitions/views.js';
import { sha256 } from '#factor/sources/fingerprint.js';
import { parseAssetFactorAnalysisSourceSnapshot } from '#factor/sources/snapshot.js';
import { StrategyError } from '../errors.js';

/**
 * 记录策略对因子的引用方式与所需历史，供依赖准备。
 *
 * Describe factor usage and history requirements discovered in strategy source.
 */
export type FactorUsage = 'research' | 'deployment' | 'signal';

/**
 * 提供解析及准备策略因子所需的用户、源码和冻结依赖。
 *
 * Supply ownership, strategy source and frozen dependencies for factor preparation.
 */
export interface StrategyFactorInput extends Omit<FactorDependency, 'inputs'> {
  code?: string;
  js?: string;
  historyFields?: FactorHistoryField[];
  crossSectional?: { window?: number };
  assetSeries?: FactorInputRequirements;
  assetUniverse?: Array<{ assetId: string; assetClass: import('@jixie/shared').MultiAssetClass }>;
  panelComposite?: {
    standardization: 'rank' | 'zscore';
    assetUniverse: NonNullable<StrategyFactorInput['assetUniverse']>;
    components: Array<{ direction: 'positive' | 'negative'; factor: StrategyFactor }>;
  };
}

/** Strategy-side factor preparation, source identity and runtime metadata. */
export class StrategyFactor {
  private static readonly engineKeys = new Set<string>(ENGINE_FACTORS.map((factor) => factor.key));

  private readonly input: StrategyFactorInput;

  constructor(input: StrategyFactorInput) {
    const { panelComposite, ...source } = input;
    this.input = {
      ...structuredClone(source),
      ...(panelComposite ? { panelComposite: StrategyFactor.copyComposite(panelComposite) } : {}),
    };
  }

  get key(): string {
    return this.input.key;
  }

  /**
   * 静态提取声明与 ctx.factor 调用中的字面量 key，不执行用户代码。
   *
   * Extract literal factor keys from declarations and ctx.factor() calls without evaluating user code.
   */
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

  /**
   * 加载用户可访问的已发布因子来源，不启动因子运行时。
   *
   * Load authorized published sources without starting a factor runtime.
   */
  static async fromStrategySource(
    source: string,
    userId: string,
    usage: FactorUsage = 'research',
  ): Promise<StrategyFactor[]> {
    const keys = StrategyFactor.extractKeys(source);
    if (keys.length === 0) {
      return [];
    }

    // 纯源码操作不加载数据库模块；查询在当前执行作用域解析连接。
    // Source-only operations do not load storage; queries resolve the current execution client.
    const { getDatabase } = await import('#infra/database/prisma.js');
    const factorRows = await getDatabase().factor.findMany({
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
    const compositeRows = await getDatabase().factorComposite.findMany({
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
    const approvedReports = await getDatabase().factorReport.findMany({
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
        const source =
          item.kind === 'factor'
            ? await StrategyFactor.prepareSource(item.row, report?.spec)
            : await StrategyFactor.prepareComposite(item.row, report?.snapshot, report?.spec);
        return new StrategyFactor({
          ...source,
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

  /**
   * 校验并解析 Prisma JSON 中的不可变依赖快照。
   *
   * Parse the immutable dependency snapshot stored in Prisma JSON.
   */
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

  /**
   * 当持久化血缘与当前运行依赖不一致时拒绝执行。
   *
   * Fail closed if persisted lineage and current runtime dependencies diverge.
   */
  static assertDependencies(expected: FactorDependency[] | null, actual: FactorDependency[]): void {
    if (expected == null) {
      return;
    }
    if (StrategyFactor.canonicalJson(expected) !== StrategyFactor.canonicalJson(actual)) {
      throw new Error('Factor dependency snapshot mismatch');
    }
  }

  /**
   * 校验沙盒报告的运行输入，不将元数据反向写回来源因子。
   *
   * Validate runtime inputs without copying metadata back into source factors.
   */
  static validateSandboxMetadata(factors: StrategyFactor[], definitions: FactorDefinition[]): void {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const researchOnlyInputs = new Set<string>();
    for (const factor of factors) {
      const definition = byId.get(factor.key);
      if (!definition) {
        throw new Error(`Missing factor metadata: ${factor.key}`);
      }
      for (const input of StrategyFactor.inputsFromDefinition(definition) ?? []) {
        if (isResearchOnlyFactorV2Field(input)) {
          researchOnlyInputs.add(input);
        }
      }
    }
    if (researchOnlyInputs.size > 0) {
      throw new StrategyError('research_only_inputs_unavailable', {
        params: { fields: [...researchOnlyInputs].join(', ') },
      });
    }
  }

  /**
   * 从因子定义提取所需输入，供策略模拟准备依赖。
   *
   * Extract input requirements from a factor definition for strategy simulation.
   */
  private static inputsFromDefinition(
    definition: FactorDefinition,
  ): FactorInputRequirements['inputs'] | undefined {
    switch (definition.kind) {
      case 'cross_sectional':
        return undefined;
      case 'asset_series':
        return [...definition.meta.inputs];
      case 'panel_composite':
        return [
          ...new Set(
            definition.components.flatMap((component) => component.definition.meta.inputs),
          ),
        ];
    }
  }

  get language() {
    return this.input.language ?? 'typescript';
  }
  get runtimeVersion() {
    return this.input.runtimeVersion ?? (this.language === 'python' ? 'py-v1' : 'ts-v1');
  }
  get analysisKind() {
    return this.input.analysisKind;
  }
  get runtimeKind() {
    return this.input.analysisKind === 'macro_regime' ? 'cross_sectional' : this.input.analysisKind;
  }
  get code() {
    return this.input.code;
  }
  get js() {
    return this.input.js;
  }
  get historyFields() {
    return structuredClone(this.input.historyFields ?? []);
  }
  get crossSectional() {
    return structuredClone(this.input.crossSectional);
  }
  get assetSeries() {
    return structuredClone(this.input.assetSeries);
  }
  get assetUniverse() {
    return structuredClone(this.input.assetUniverse);
  }
  get panelComposite() {
    return this.input.panelComposite
      ? StrategyFactor.copyComposite(this.input.panelComposite)
      : undefined;
  }

  private static copyComposite(composite: NonNullable<StrategyFactorInput['panelComposite']>) {
    return {
      standardization: composite.standardization,
      assetUniverse: structuredClone(composite.assetUniverse),
      // Child factors are immutable instances; copy only the mutable collection and descriptors.
      components: composite.components.map(({ direction, factor }) => ({ direction, factor })),
    };
  }

  /**
   * 仅持久化血缘字段，不保存源码或内部运行配置。
   *
   * Persist only lineage fields, never source or internal runtime configuration.
   */
  toDependency(definition?: FactorDefinition): FactorDependency {
    if (definition && definition.id !== this.key) {
      throw new Error(`Factor metadata does not match: ${this.key}`);
    }
    const factor = this.input;
    const inputs = definition ? StrategyFactor.inputsFromDefinition(definition) : undefined;
    return {
      factorId: factor.factorId,
      key: factor.key,
      name: factor.name,
      analysisKind: factor.analysisKind,
      language: factor.language,
      runtimeVersion: factor.runtimeVersion,
      codeHash: factor.codeHash,
      approvedReportId: factor.approvedReportId,
      ...(inputs ? { inputs } : {}),
    };
  }

  /**
   * 解析策略所需因子历史字段，供按需数据加载。
   *
   * Resolve factor history fields required by the strategy for selective data loading.
   */
  private static extractHistoryFields(source: string): FactorHistoryField[] {
    const fields: FactorHistoryField[] = [];
    if (/['"]turnoverRateF['"]/.test(source)) {
      fields.push('turnoverRateF');
    }
    if (/['"]roe['"]/.test(source)) {
      fields.push('roe');
    }
    if (/['"]grossprofitMargin['"]/.test(source)) {
      fields.push('grossprofitMargin');
    }
    if (/['"]marketClose['"]/.test(source)) {
      fields.push('marketClose');
    }
    return fields;
  }

  /**
   * 准备单个因子来源及其快照，供模拟创建因子宿主。
   *
   * Prepare a factor source and snapshot for simulation factor-host creation.
   */
  private static async prepareSource(
    row: {
      key: string;
      code: string;
      analysisKind: string;
      language?: string;
      runtimeVersion?: string;
    },
    reportSpec?: unknown,
  ): Promise<Omit<StrategyFactorInput, 'factorId' | 'name' | 'codeHash'>> {
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
      const { toCommonJs } = await import('#infra/sandbox/typescript/compile.js');
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
                : StrategyFactor.extractHistoryFields(row.code),
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

  /**
   * 解析组合因子的子依赖和计算配置，供策略运行统一加载。
   *
   * Prepare a composite factor's dependencies and configuration for strategy execution.
   */
  private static async prepareComposite(
    row: {
      id: string;
      key: string | null;
      codeHash: string | null;
    },
    snapshot: string | null | undefined,
    reportSpec: unknown,
  ): Promise<Omit<StrategyFactorInput, 'factorId' | 'name' | 'codeHash'>> {
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
        factor: new StrategyFactor({
          ...(await StrategyFactor.prepareSource({
            key: component.factor,
            code: component.code,
            analysisKind: 'panel',
            language: component.language,
            runtimeVersion: component.runtimeVersion,
          })),
          // Components are frozen within the parent publication, not independently reloaded.
          factorId: component.factor,
          name: component.label,
          codeHash: sha256(component.code),
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

  /**
   * 从 Python 因子来源提取声明的历史字段，供运行输入预备。
   *
   * Extract declared history fields from a Python factor source.
   */
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

  /**
   * 校验已批准的 Panel 证券池，拒绝不符合冻结契约的范围。
   *
   * Validate an approved panel universe against its frozen contract.
   */
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
