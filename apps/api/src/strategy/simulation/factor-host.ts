import { FactorSandbox } from '#factor/sandbox/factor-sandbox.js';
import type {
  CrossSectionalFactorSandbox,
  PanelFactorSandbox,
  TimeSeriesFactorSandbox,
} from '#factor/sandbox/contract.js';
import { z } from 'zod';
import type { UserLogSink } from '#infra/sandbox/console.js';

import { StrategyFactor } from '../factors/strategy-factor.js';
import type {
  FactorComputeRequest,
  FactorDefinition,
  FactorExecutionPort,
  FactorDescription,
} from '#backtesting/factors/execution-port.js';
import { describeFactors } from '#backtesting/factors/description.js';

/**
 * 保存一个模拟会话的因子沙盒及其绑定定义，供重复计算复用。
 *
 * Retain a factor sandbox and its definition within one simulation session.
 */
type FactorInstance = CrossSectionalFactorSandbox | TimeSeriesFactorSandbox | PanelFactorSandbox;

const numberSchema = z.number().finite();
const valueSchema = numberSchema.nullable();
const historySchema = z.array(valueSchema).max(100_000);
const factorBarSchema = z.strictObject({
  code: z.string().min(1).max(256),
  pe: valueSchema,
  peTtm: valueSchema,
  pb: valueSchema,
  ps: valueSchema,
  psTtm: valueSchema,
  dvRatio: valueSchema,
  dvTtm: valueSchema,
  totalMv: valueSchema,
  circMv: valueSchema,
  turnoverRate: valueSchema,
  netMain: valueSchema,
  netTotal: valueSchema,
  roe: valueSchema,
  roa: valueSchema,
  grossprofitMargin: valueSchema,
  debtToAssets: valueSchema,
});
const factorRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    factorId: z.string().min(1).max(1024),
    kind: z.literal('cross_sectional'),
    items: z
      .array(
        z.strictObject({
          bar: factorBarSchema,
          closes: z.array(numberSchema).max(100_000).optional(),
          dates: z
            .array(z.string().regex(/^\d{8}$/))
            .max(100_000)
            .optional(),
          amounts: historySchema.optional(),
          turnoverRatesF: historySchema.optional(),
          roes: historySchema.optional(),
          grossProfitMargins: historySchema.optional(),
          marketCloses: historySchema.optional(),
        }),
      )
      .max(100_000),
  }),
  z.strictObject({
    factorId: z.string().min(1).max(1024),
    kind: z.literal('asset_series'),
    // JSON transport represents missing numeric inputs as null; direct calls may use NaN.
    fields: z.record(z.string().min(1).max(256), z.array(z.union([valueSchema, z.nan()])).max(505)),
    indexes: z.array(z.number().int().min(0).max(504)).max(505),
  }),
]);

/** One simulation owns these factor sandboxes. Source comes only from its frozen, permission-checked dependencies. */
export class FactorHost implements FactorExecutionPort {
  private readonly dependencies: StrategyFactor[];
  private readonly factors = new Map<string, FactorInstance>();
  private readonly identifiers = new Set<string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private description?: Promise<FactorDescription>;
  private closed = false;

  constructor(
    factors: StrategyFactor[],
    private readonly onUserLog?: UserLogSink,
  ) {
    this.dependencies = [...factors];
  }

  describe(): Promise<FactorDescription> {
    if (this.closed) {
      return Promise.reject(new Error('Factor runtime is closed'));
    }
    this.description ??= this.initialize().catch((error: unknown) => {
      this.close();
      throw error;
    });
    return this.description.then((description) => structuredClone(description));
  }

  /**
   * 为已注册因子准备输入并调用对应沙盒，收集按请求关联的计算结果。
   *
   * Prepare registered factor inputs, invoke their sandboxes and collect request-associated results.
   */
  async compute(input: FactorComputeRequest): Promise<(number | null)[]> {
    const request = factorRequestSchema.parse(input);
    await this.describe();
    const sandbox = this.factors.get(request.factorId);
    if (!sandbox) {
      throw new Error(`Unknown factor dependency ${request.factorId}`);
    }
    const previous = this.queues.get(request.factorId) ?? Promise.resolve();

    /**
     * 将一次因子请求排入会话计算，校验种类、输入和输出数量。
     *
     * Run a session-queued factor request with kind, input and result-count validation.
     */
    const pending = previous.then(async () => {
      if (this.closed) {
        throw new Error('Factor runtime is closed');
      }
      let values: (number | null)[];
      let expected: number;
      if (request.kind === 'cross_sectional') {
        if (!isCrossSectionalSandbox(sandbox)) {
          throw new Error('Factor runtime does not support cross-sectional input');
        }
        for (const item of request.items) {
          const length = item.closes?.length;
          if (
            length != null &&
            (sandbox.metadata.window == null || length > sandbox.metadata.window)
          ) {
            throw new Error('Factor history exceeds its declared window');
          }
          for (const history of [
            item.dates,
            item.amounts,
            item.turnoverRatesF,
            item.roes,
            item.grossProfitMargins,
            item.marketCloses,
          ]) {
            if (history && history.length !== length) {
              throw new Error('Factor histories must be aligned');
            }
          }
        }
        values = await sandbox.execute({ items: request.items });
        expected = request.items.length;
      } else {
        if (isCrossSectionalSandbox(sandbox)) {
          throw new Error('Factor runtime does not support asset-series input');
        }
        const keys = Object.keys(request.fields);
        if (
          keys.length !== sandbox.metadata.inputs.length ||
          keys.some(
            (key) =>
              !sandbox.metadata.inputs.includes(key as (typeof sandbox.metadata.inputs)[number]),
          )
        ) {
          throw new Error('Factor fields do not match its declared inputs');
        }
        const lengths = Object.values(request.fields).map((values) => values.length);
        const length = lengths[0];
        if (
          length !== sandbox.metadata.window ||
          lengths.some((value) => value !== length) ||
          request.indexes.some((index) => index >= length)
        ) {
          throw new Error('Factor series must match its declared window and indexes');
        }
        const fields = Object.fromEntries(
          Object.entries(request.fields).map(([field, values]) => [
            field,
            values.map((value) => value ?? Number.NaN),
          ]),
        );
        values = await sandbox.execute({ fields: fields, indexes: request.indexes });
        expected = request.indexes.length;
      }
      if (
        values.length !== expected ||
        values.some((value) => value !== null && !Number.isFinite(value))
      ) {
        throw new Error('Factor runtime returned invalid values');
      }
      return values;
    });
    this.queues.set(request.factorId, pending);
    return pending;
  }

  close(): void {
    this.closed = true;
    for (const sandbox of this.factors.values()) {
      sandbox.close();
    }
    this.factors.clear();
    this.queues.clear();
  }

  private async initialize(): Promise<FactorDescription> {
    const definitions: FactorDefinition[] = [];
    for (const factor of this.dependencies) {
      definitions.push(await this.define(factor, factor.key));
    }
    return describeFactors(definitions);
  }

  /**
   * 加载并校验单个因子定义，建立模拟会话持有的计算实例。
   *
   * Load and validate a factor definition and create its simulation-owned instance.
   */
  private async define(factor: StrategyFactor, id: string): Promise<FactorDefinition> {
    if (this.closed) {
      throw new Error('Factor runtime is closed');
    }
    if (this.identifiers.has(id)) {
      throw new Error(`Duplicate factor dependency ${id}`);
    }
    this.identifiers.add(id);
    const language = factor.language;
    const version = factor.runtimeVersion;
    if (
      (language === 'python' && version !== 'py-v1') ||
      (language === 'typescript' && version !== 'ts-v1')
    ) {
      throw new Error(`factor ${factor.key} has an invalid runtime version`);
    }
    const source = language === 'python' ? factor.code : factor.js;
    if (!source) {
      throw new Error(`factor ${factor.key} is missing executable code`);
    }
    const kind = factor.runtimeKind;
    const log: UserLogSink = (level, text) => this.onUserLog?.(level, `${factor.key}: ${text}`);
    const sandbox = await FactorSandbox.start({
      language,
      analysisKind: kind,
      code: source,
      onUserLog: log,
    });
    if (this.closed) {
      sandbox.close();
      throw new Error('Factor runtime is closed');
    }
    this.factors.set(id, sandbox);
    if (isCrossSectionalSandbox(sandbox)) {
      if (
        sandbox.metadata.window != null &&
        (!Number.isSafeInteger(sandbox.metadata.window) || sandbox.metadata.window < 1)
      ) {
        throw new Error(`factor ${factor.key} has an invalid history window`);
      }
      if (factor.crossSectional && factor.crossSectional.window !== sandbox.metadata.window) {
        throw new Error(
          `factor ${factor.key} does not match its compiled cross-sectional contract`,
        );
      }
      return {
        id,
        kind: 'cross_sectional',
        window: sandbox.metadata.window,
        historyFields: factor.historyFields,
      };
    }
    if (
      factor.assetSeries &&
      (factor.assetSeries.window !== sandbox.metadata.window ||
        JSON.stringify(factor.assetSeries.inputs) !== JSON.stringify(sandbox.metadata.inputs))
    ) {
      throw new Error(`factor ${factor.key} does not match its compiled asset-series contract`);
    }
    return {
      id,
      kind: 'asset_series',
      analysisKind: sandbox.metadata.analysisKind,
      meta: { window: sandbox.metadata.window, inputs: [...sandbox.metadata.inputs] },
      ...(factor.assetUniverse ? { assetUniverse: factor.assetUniverse } : {}),
    };
  }
}

function isCrossSectionalSandbox(sandbox: FactorInstance): sandbox is CrossSectionalFactorSandbox {
  return sandbox.metadata.analysisKind === 'cross_sectional';
}
