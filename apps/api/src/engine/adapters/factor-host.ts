import { z } from 'zod';
import type { UserLogSink } from '#infra/runtime/console.js';
import { compilePythonCrossSectionalFactor } from '#factor/runtime/python/cross-sectional.js';
import {
  compilePythonPanelFactor,
  compilePythonTimeSeriesFactor,
} from '#factor/runtime/python/asset-factor.js';
import { compileFactor, type CompiledFactor } from '#factor/runtime/typescript/compile-factor.js';
import {
  compilePanelFactor,
  compileTimeSeriesFactor,
  type CompiledPanelFactor,
  type CompiledTimeSeriesFactor,
} from '#factor/runtime/typescript/compile-asset-factor.js';
import type { CustomFactorModule } from '../factors/custom-factor.js';
import type {
  FactorComputeRequest,
  FactorDefinition,
  FactorExecutionPort,
} from '../factors/execution-port.js';

type CompiledRuntime = CompiledFactor | CompiledTimeSeriesFactor | CompiledPanelFactor;

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

/** One run owns these runtimes. Source comes only from its frozen, permission-checked dependencies. */
export class FactorHost implements FactorExecutionPort {
  private readonly modules: CustomFactorModule[];
  private readonly factors = new Map<string, CompiledRuntime>();
  private readonly identifiers = new Set<string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private definitions?: Promise<FactorDefinition[]>;
  private closed = false;

  constructor(
    modules: CustomFactorModule[],
    private readonly onUserLog?: UserLogSink,
  ) {
    this.modules = structuredClone(modules);
  }

  describe(): Promise<FactorDefinition[]> {
    if (this.closed) {
      return Promise.reject(new Error('Factor runtime is closed'));
    }
    this.definitions ??= this.initialize().catch((error: unknown) => {
      this.close();
      throw error;
    });
    return this.definitions.then((definitions) => structuredClone(definitions));
  }

  async compute(input: FactorComputeRequest): Promise<(number | null)[]> {
    const request = factorRequestSchema.parse(input);
    await this.describe();
    const runtime = this.factors.get(request.factorId);
    if (!runtime) {
      throw new Error(`Unknown factor dependency ${request.factorId}`);
    }
    const previous = this.queues.get(request.factorId) ?? Promise.resolve();
    const pending = previous.then(async () => {
      if (this.closed) {
        throw new Error('Factor runtime is closed');
      }
      let values: (number | null)[];
      let expected: number;
      if (request.kind === 'cross_sectional') {
        if (!('computeBatch' in runtime)) {
          throw new Error('Factor runtime does not support cross-sectional input');
        }
        for (const item of request.items) {
          const length = item.closes?.length;
          if (length != null && (runtime.window == null || length > runtime.window)) {
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
        values = await runtime.computeBatch(request.items);
        expected = request.items.length;
      } else {
        if (!('computeSeries' in runtime)) {
          throw new Error('Factor runtime does not support asset-series input');
        }
        const keys = Object.keys(request.fields);
        if (
          keys.length !== runtime.inputs.length ||
          keys.some((key) => !runtime.inputs.includes(key as (typeof runtime.inputs)[number]))
        ) {
          throw new Error('Factor fields do not match its declared inputs');
        }
        const lengths = Object.values(request.fields).map((values) => values.length);
        const length = lengths[0];
        if (
          length !== runtime.window ||
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
        values = await runtime.computeSeries(fields, request.indexes);
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
    for (const runtime of this.factors.values()) {
      runtime.dispose();
    }
    this.factors.clear();
    this.queues.clear();
  }

  private async initialize(): Promise<FactorDefinition[]> {
    const definitions: FactorDefinition[] = [];
    for (const module of this.modules) {
      definitions.push(await this.define(module, module.key));
    }
    return definitions;
  }

  private async define(module: CustomFactorModule, id: string): Promise<FactorDefinition> {
    if (this.closed) {
      throw new Error('Factor runtime is closed');
    }
    if (this.identifiers.has(id)) {
      throw new Error(`Duplicate factor dependency ${id}`);
    }
    this.identifiers.add(id);
    if (module.panelComposite) {
      if (module.analysisKind !== 'panel' || module.panelComposite.components.length < 2) {
        throw new Error(`factor ${module.key} has an invalid panel composite contract`);
      }
      const components: Extract<FactorDefinition, { kind: 'panel_composite' }>['components'] = [];
      for (const [index, component] of module.panelComposite.components.entries()) {
        const definition = await this.define(component.module, `${id}:component:${index}`);
        if (definition.kind !== 'asset_series' || definition.analysisKind !== 'panel') {
          throw new Error(`factor ${module.key} panel composite components must be panel factors`);
        }
        components.push({ direction: component.direction, definition });
      }
      return {
        id,
        kind: 'panel_composite',
        standardization: module.panelComposite.standardization,
        assetUniverse: module.panelComposite.assetUniverse,
        components,
      };
    }
    const language = module.language ?? 'typescript';
    const version = module.runtimeVersion ?? (language === 'python' ? 'py-v1' : 'ts-v1');
    if (
      (language === 'python' && version !== 'py-v1') ||
      (language === 'typescript' && version !== 'ts-v1')
    ) {
      throw new Error(`factor ${module.key} has an invalid runtime version`);
    }
    const source = language === 'python' ? module.code : module.js;
    if (!source) {
      throw new Error(`factor ${module.key} is missing executable code`);
    }
    const kind = module.analysisKind ?? 'cross_sectional';
    const log: UserLogSink = (level, text) => this.onUserLog?.(level, `${module.key}: ${text}`);
    let runtime: CompiledRuntime;
    switch (kind) {
      case 'cross_sectional':
        runtime =
          language === 'python'
            ? await compilePythonCrossSectionalFactor(source, log)
            : await compileFactor(source, log);
        break;
      case 'time_series':
        runtime =
          language === 'python'
            ? await compilePythonTimeSeriesFactor(source, log)
            : await compileTimeSeriesFactor(source, log);
        break;
      case 'panel':
        runtime =
          language === 'python'
            ? await compilePythonPanelFactor(source, log)
            : await compilePanelFactor(source, log);
        break;
    }
    if (this.closed) {
      runtime.dispose();
      throw new Error('Factor runtime is closed');
    }
    this.factors.set(id, runtime);
    if ('computeBatch' in runtime) {
      if (runtime.window != null && (!Number.isSafeInteger(runtime.window) || runtime.window < 1)) {
        throw new Error(`factor ${module.key} has an invalid history window`);
      }
      if (module.crossSectional && module.crossSectional.window !== runtime.window) {
        throw new Error(
          `factor ${module.key} does not match its compiled cross-sectional contract`,
        );
      }
      return {
        id,
        kind: 'cross_sectional',
        window: runtime.window,
        historyFields: module.historyFields ?? [],
      };
    }
    if (
      !module.assetSeries ||
      module.assetSeries.window !== runtime.window ||
      JSON.stringify(module.assetSeries.inputs) !== JSON.stringify(runtime.inputs)
    ) {
      throw new Error(`factor ${module.key} does not match its compiled asset-series contract`);
    }
    return {
      id,
      kind: 'asset_series',
      analysisKind: runtime.analysisKind,
      meta: { window: runtime.window, inputs: [...runtime.inputs] },
    };
  }
}
