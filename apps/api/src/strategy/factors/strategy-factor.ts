import { FACTOR_KEY_PATTERN, type FactorDependency } from '@jixie/shared';
import { factorResearchSpecV1Schema } from '@jixie/shared/api/factor';
import type {
  FactorHistoryField,
  FactorInputRequirements,
  FactorDefinition,
} from '#backtesting/factors/execution-port.js';
import { BUILTIN_USER_ID } from '#factor/definitions/builtin-factors.js';
import { isFactorV2FieldKey } from '#factor/definitions/fields.js';
import { normalizeAnalysisKind } from '#factor/definitions/views.js';
import { sha256 } from '#factor/sources/fingerprint.js';
import { StrategyError } from '../errors.js';

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
}

/** Strategy-side factor preparation, source identity and runtime metadata. */
export class StrategyFactor {
  private readonly input: StrategyFactorInput;

  constructor(input: StrategyFactorInput) {
    this.input = structuredClone(input);
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
    return [...new Set(keys.filter((key) => FACTOR_KEY_PATTERN.test(key)))];
  }

  /**
   * 加载用户可访问的已发布因子来源，不启动因子运行时。
   *
   * Load authorized published sources without starting a factor runtime.
   */
  static async fromStrategySource(source: string, userId: string): Promise<StrategyFactor[]> {
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
        status: { in: ['published', 'archived'] },
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
    const approvedReportIds = factorRows.flatMap((row) =>
      row.approvedReportId ? [row.approvedReportId] : [],
    );
    const approvedReports = await getDatabase().factorReport.findMany({
      where: { id: { in: approvedReportIds } },
      select: { id: true, specJson: true },
    });
    const approvedReportById = new Map(
      approvedReports.map((report) => [report.id, report.specJson]),
    );
    const byKey = new Map(factorRows.map((row) => [row.key, row]));
    const missing = keys.filter((key) => !byKey.has(key));
    if (missing.length > 0) {
      throw new StrategyError('custom_factor_missing', { params: { keys: missing.join(', ') } });
    }

    return Promise.all(
      keys.map(async (key) => {
        const row = byKey.get(key)!;
        const report = row.approvedReportId ? approvedReportById.get(row.approvedReportId) : null;
        const source = await StrategyFactor.prepareSource(row, report);

        return new StrategyFactor({
          ...source,
          factorId: row.id,
          key: row.key,
          name: row.name,
          analysisKind: normalizeAnalysisKind(row.analysisKind),
          codeHash: row.codeHash ?? sha256(row.code),
          approvedReportId: row.approvedReportId,
          language: row.language === 'python' ? 'python' : 'typescript',
          runtimeVersion: row.runtimeVersion === 'py-v1' ? 'py-v1' : 'ts-v1',
        });
      }),
    );
  }

  /**
   * 校验沙盒报告的运行输入，不将元数据反向写回来源因子。
   *
   * Validate runtime inputs without copying metadata back into source factors.
   */
  static validateSandboxMetadata(factors: StrategyFactor[], definitions: FactorDefinition[]): void {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const unsupportedInputs = new Set<string>();
    for (const factor of factors) {
      const definition = byId.get(factor.key);
      if (!definition) {
        throw new Error(`Missing factor metadata: ${factor.key}`);
      }
      for (const input of StrategyFactor.inputsFromDefinition(definition) ?? []) {
        if (!isFactorV2FieldKey(input)) {
          unsupportedInputs.add(input);
        }
      }
    }
    if (unsupportedInputs.size > 0) {
      throw new StrategyError('factor_inputs_unavailable', {
        params: { fields: [...unsupportedInputs].join(', ') },
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
}
