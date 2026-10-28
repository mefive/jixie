import { DEFAULT_LOCALE, type FactorBar, type Locale } from '@jixie/shared';
import { t } from '#i18n/messages.js';
import type {
  FactorDefinition,
  FactorExecutionPort,
  FactorComputeRequest,
} from './execution-port.js';
import type { EngineData } from '../data/engine-data.js';
import type { BarRow } from '../data/market.js';

/**
 * 提供一次决策日因子求值的证券与行情上下文。
 *
 * Supply the instruments and market context for one decision-date factor evaluation.
 */
export interface FactorEvaluationInput {
  date: string;
  codes: string[];
  crossSection?: Map<string, BarRow> | null;
}

/**
 * 装配因子求值器的数据读取、执行端口和已注册因子定义。
 *
 * Configure factor evaluation with market reads, execution capabilities and registered definitions.
 */
export interface FactorEvaluatorInput {
  definitions: readonly FactorDefinition[];
  engineData: EngineData;
  executionPort: FactorExecutionPort;
  assetUniverse: string[];
  /** Receives only the first reported error per factor in this evaluator instance. */
  onComputeError: (key: string, message: string) => void;
  locale?: Locale;
}

/**
 * Serves published-factor reads using a decision-day cache keyed by factor and instrument
 * (a monthly rebalance re-reads the same values while ranking — memoizing keeps that O(1)).
 * Windowed factors read the strategy-side bars cache — same "K-line must be loaded" contract as
 * ctx.sma (ensureBars first); without bars the window is short and compute sees [] from history().
 */
export class FactorEvaluator {
  private date: string | null = null;
  private cache = new Map<string, { input: string; value: number | null; read: boolean }>();
  private pending: Promise<void> = Promise.resolve();

  private readonly definitions: Map<string, FactorDefinition>;
  private readonly warnedKeys = new Set<string>();
  private readonly input: Omit<Required<FactorEvaluatorInput>, 'definitions'>;

  /**
   * 整理因子依赖与预载需求，建立本轮求值缓存。
   *
   * Initialize factor dependencies, preload requirements and session caches.
   */
  constructor(input: FactorEvaluatorInput) {
    const { definitions, ...options } = input;
    this.input = { ...options, locale: options.locale ?? DEFAULT_LOCALE };
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
  }

  has(key: string): boolean {
    return this.definitions.has(key);
  }

  /**
   * 只准备当前可访问证券的因子输入，并串行处理重叠的 SDK 数据加载。
   *
   * Prepare only currently accessible instruments; serialize overlapping SDK data loads.
   */
  evaluate({
    date,
    codes,
    crossSection: crossByCode = null,
  }: FactorEvaluationInput): Promise<void> {
    const pending = this.pending.then(async () => {
      if (this.date !== date) {
        this.date = date;
        this.cache.clear();
      }
      for (const factor of this.definitions.values()) {
        await this.prepareFactor(factor, date, [...new Set(codes)], crossByCode);
      }
    });
    this.pending = pending;
    return pending;
  }

  /**
   * 读取并锁定当日缓存值，避免后续加载改变已用于决策的因子结果。
   *
   * Reading commits the cached value for this decision date; later loads cannot revise it.
   */
  read(key: string, date: string, code: string): number | null {
    const entry = this.cache.get(this.cacheKey(key, code));
    if (date !== this.date || !entry) {
      throw new Error(t(this.input.locale, 'customFactorNotPrepared', { key, date, code }));
    }
    entry.read = true;
    return entry.value;
  }

  private cacheKey(key: string, code: string): string {
    return JSON.stringify([key, code]);
  }

  private reportComputeError(key: string, message: string): void {
    if (this.warnedKeys.has(key)) {
      return;
    }
    this.warnedKeys.add(key);
    this.input.onComputeError(key, message);
  }

  private needsCompute(key: string, code: string, input: string): boolean {
    const previous = this.cache.get(this.cacheKey(key, code));
    // Preserve first-read semantics. Unread speculative values may be refreshed after data loads.
    return !previous || (!previous.read && previous.input !== input);
  }

  /**
   * 准备因子声明的数据和依赖，按类型分派求值并缓存结果。
   *
   * Prepare declared inputs and dependencies, dispatch evaluation by factor kind and cache the result.
   */
  private async prepareFactor(
    factor: FactorDefinition,
    date: string,
    codes: string[],
    crossByCode: Map<string, BarRow> | null,
  ): Promise<void> {
    if (factor.kind === 'cross_sectional') {
      const pending = codes
        .map((code) => {
          const item = this.crossSectionalItem(factor, date, code, crossByCode?.get(code) ?? null);
          // Market data is immutable within a decision date; only its availability changes.
          const input = `${crossByCode?.has(code) ?? false}:${item.closes?.length ?? 0}`;
          return { code, item, input };
        })
        .filter(({ code, input }) => this.needsCompute(factor.id, code, input));
      if (pending.length === 0) {
        return;
      }
      const values = await this.input.executionPort.compute({
        factorId: factor.id,
        kind: 'cross_sectional',
        items: pending.map(({ item }) => item),
      });
      this.checkResult(values, pending.length);
      pending.forEach(({ code, input }, index) => {
        this.cache.set(this.cacheKey(factor.id, code), {
          input,
          value: values[index],
          read: false,
        });
      });
      return;
    }
    for (const code of codes) {
      const request = this.assetRequest(factor, date, code);
      const input = request ? 'ready' : 'missing';
      if (!this.needsCompute(factor.id, code, input)) {
        continue;
      }
      let value: number | null = null;
      if (request) {
        const values = await this.input.executionPort.compute(request);
        this.checkResult(values, 1);
        value = values[0];
      }
      this.cache.set(this.cacheKey(factor.id, code), { input, value, read: false });
    }
  }

  private checkResult(values: (number | null)[], expected: number): void {
    if (
      values.length !== expected ||
      values.some((value) => value !== null && !Number.isFinite(value))
    ) {
      throw new Error('Factor runtime returned invalid values');
    }
  }

  /**
   * 从当日截面构造单证券因子输入，保留其可用字段与时点语义。
   *
   * Construct one instrument's factor input from the current cross-section and its available fields.
   */
  private crossSectionalItem(
    factor: Extract<FactorDefinition, { kind: 'cross_sectional' }>,
    date: string,
    code: string,
    crossBar: BarRow | null,
  ) {
    if (!factor.window) {
      return { bar: this.assembleFactorBar(date, code, crossBar) };
    }
    const bars = this.input.engineData.bars(code, date, factor.window);
    return {
      bar: this.assembleFactorBar(date, code, crossBar),
      closes: bars.map((bar) => bar.adjClose),
      dates: bars.map((bar) => bar.date),
      amounts: bars.map((bar) => bar.amount),
      turnoverRatesF: bars.map((bar) => bar.turnoverRateF),
      roes: factor.historyFields.includes('roe')
        ? bars.map((bar) => this.input.engineData.roeHistoryAt(code, bar.date))
        : undefined,
      grossProfitMargins: factor.historyFields.includes('grossprofitMargin')
        ? bars.map((bar) => this.input.engineData.grossProfitMarginHistoryAt(code, bar.date))
        : undefined,
      marketCloses: factor.historyFields.includes('marketClose')
        ? bars.map((bar) => this.input.engineData.indexCloseOn('000985.CSI', bar.date))
        : undefined,
    };
  }

  /**
   * 装配单资产因子的日期窗口和所需市场历史，供外部因子执行。
   *
   * Assemble a single-asset factor request from the required historical window.
   */
  private assetRequest(
    factor: Extract<FactorDefinition, { kind: 'asset_series' }>,
    date: string,
    code: string,
  ): Extract<FactorComputeRequest, { kind: 'asset_series' }> | null {
    if (this.input.engineData.assetType(code) !== 'etf') {
      this.reportComputeError(
        factor.id,
        factor.meta.inputs.includes('etf.adjustedClose')
          ? `input etf.adjustedClose requires an ETF code, received ${code}`
          : `asset-scoped Factor V2 requires an ETF code, received ${code}`,
      );
      return null;
    }
    const bars = this.input.engineData.bars(code, date, factor.meta.window);
    if (bars.length < factor.meta.window) {
      return null;
    }
    const fields: Record<string, number[]> = {};
    for (const field of factor.meta.inputs) {
      fields[field] = bars.map((bar) => bar.adjClose);
    }
    return {
      factorId: factor.id,
      kind: 'asset_series',
      fields,
      indexes: [bars.length - 1],
    };
  }

  /**
   * 从引擎截面组装当日估值与财务指标。
   *
   * Assemble daily valuation and financial indicators from the engine cross-section.
   */
  private assembleFactorBar(date: string, code: string, crossBar: BarRow | null): FactorBar {
    return {
      code,
      pe: crossBar?.pe ?? null,
      peTtm: crossBar?.peTtm ?? null,
      pb: crossBar?.pb ?? null,
      ps: crossBar?.ps ?? null,
      psTtm: crossBar?.psTtm ?? null,
      dvRatio: crossBar?.dvRatio ?? null,
      dvTtm: crossBar?.dvTtm ?? null,
      totalMv: crossBar?.totalMv ?? null,
      circMv: crossBar?.circMv ?? null,
      turnoverRate: crossBar?.turnoverRate ?? null,
      roe: crossBar?.roe ?? null,
      roa: crossBar?.roa ?? null,
      grossprofitMargin: crossBar?.grossprofitMargin ?? null,
      debtToAssets: crossBar?.debtToAssets ?? null,
    };
  }
}
