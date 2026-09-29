import { DEFAULT_LOCALE, type FactorBar, type Locale } from '@jixie/shared';
import { t } from '#i18n/messages.js';
import type {
  FactorDefinition,
  FactorExecutionPort,
  FactorComputeRequest,
} from './execution-port.js';
import { factorV2YieldTerm } from '#factor/definitions/fields.js';
import type { EngineData } from '../data/engine-data.js';
import type { BarRow } from '../data/market.js';

export interface FactorEvaluationInput {
  date: string;
  codes: string[];
  crossSection?: Map<string, BarRow> | null;
}

export interface FactorEvaluatorInput {
  definitions: Map<string, FactorDefinition>;
  engineData: EngineData;
  executionPort: FactorExecutionPort;
  assetUniverse: string[];
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

  private readonly input: Required<FactorEvaluatorInput>;

  constructor(input: FactorEvaluatorInput) {
    this.input = { ...input, locale: input.locale ?? DEFAULT_LOCALE };
    const { definitions: factors, assetUniverse } = this.input;
    for (const [key, factor] of factors) {
      if (
        factor.kind === 'panel_composite' &&
        !sameAssetUniverse(
          factor.assetUniverse.map((asset) => asset.assetId),
          assetUniverse,
        )
      ) {
        throw new Error(
          `factor ${key} requires strategy.watch to match its approved research universe`,
        );
      }
    }
  }

  has(key: string): boolean {
    return this.input.definitions.has(key);
  }

  /** Prepare only currently accessible instruments; serialize overlapping SDK data loads. */
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
      for (const factor of this.input.definitions.values()) {
        await this.prepareFactor(factor, date, [...new Set(codes)], crossByCode);
      }
    });
    this.pending = pending;
    return pending;
  }

  /** Reading commits the cached value for this decision date; later loads cannot revise it. */
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

  private needsCompute(key: string, code: string, input: string): boolean {
    const previous = this.cache.get(this.cacheKey(key, code));
    // Preserve first-read semantics. Unread speculative values may be refreshed after data loads.
    return !previous || (!previous.read && previous.input !== input);
  }

  private async prepareFactor(
    factor: FactorDefinition,
    date: string,
    codes: string[],
    crossByCode: Map<string, BarRow> | null,
  ): Promise<void> {
    if (factor.kind === 'panel_composite') {
      for (const component of factor.components) {
        await this.prepareFactor(component.definition, date, this.input.assetUniverse, null);
      }
      this.preparePanelComposite(factor);
      return;
    }
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

  private assetRequest(
    factor: Extract<FactorDefinition, { kind: 'asset_series' }>,
    date: string,
    code: string,
  ): Extract<FactorComputeRequest, { kind: 'asset_series' }> | null {
    if (this.input.engineData.assetType(code) !== 'etf') {
      this.input.onComputeError(
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
      const yieldTerm = factorV2YieldTerm(field);
      fields[field] = bars.map((bar) =>
        field === 'etf.adjustedClose'
          ? bar.adjClose
          : ((yieldTerm == null
              ? null
              : this.input.engineData.governmentYieldAsOf(yieldTerm, bar.date)) ?? Number.NaN),
      );
    }
    return {
      factorId: factor.id,
      kind: 'asset_series',
      fields,
      indexes: [bars.length - 1],
    };
  }

  private preparePanelComposite(
    factor: Extract<FactorDefinition, { kind: 'panel_composite' }>,
  ): void {
    const componentValues = factor.components.map((component) => ({
      component,
      values: this.input.assetUniverse.map(
        (assetId) => this.cache.get(this.cacheKey(component.definition.id, assetId))!.value,
      ),
    }));
    const input = JSON.stringify(componentValues.map(({ values }) => values));
    const eligibleIndexes = this.input.assetUniverse
      .map((_, index) => index)
      .filter((index) => componentValues.every((component) => component.values[index] != null));
    const standardized = componentValues.map((component) => {
      const raw = eligibleIndexes.map((index) => component.values[index]!);
      return factor.standardization === 'rank' ? centeredRanks(raw) : standardScores(raw);
    });
    for (let index = 0; index < this.input.assetUniverse.length; index++) {
      const assetId = this.input.assetUniverse[index];
      if (!this.needsCompute(factor.id, assetId, input)) {
        continue;
      }
      const position = eligibleIndexes.indexOf(index);
      const value =
        position < 0
          ? null
          : componentValues.reduce((sum, { component }, componentIndex) => {
              const direction = component.direction === 'positive' ? 1 : -1;
              return sum + standardized[componentIndex][position] * direction;
            }, 0) / componentValues.length;
      this.cache.set(this.cacheKey(factor.id, assetId), { input, value, read: false });
    }
  }

  /** The factor-side bar for (code, today), assembled from the engine's cross-section row. Moneyflow
   * columns come through the engine's own flow-semantics store when declared. */
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
      netMain: this.input.engineData.factor('mf_net_main', date, code),
      netTotal: this.input.engineData.factor('mf_net_total', date, code),
      roe: crossBar?.roe ?? null,
      roa: crossBar?.roa ?? null,
      grossprofitMargin: crossBar?.grossprofitMargin ?? null,
      debtToAssets: crossBar?.debtToAssets ?? null,
    };
  }
}

function centeredRanks(values: number[]): number[] {
  if (values.length === 1) {
    return [0];
  }
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length).fill(0);
  let cursor = 0;
  while (cursor < order.length) {
    let last = cursor;
    while (last + 1 < order.length && order[last + 1].value === order[cursor].value) {
      last++;
    }
    const averageRank = (cursor + last) / 2;
    for (let index = cursor; index <= last; index++) {
      ranks[order[index].index] = averageRank;
    }
    cursor = last + 1;
  }
  return ranks.map((rank) => rank / (values.length - 1) - 0.5);
}

function standardScores(values: number[]): number[] {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  return standardDeviation === 0
    ? values.map(() => 0)
    : values.map((value) => (value - average) / standardDeviation);
}

function sameAssetUniverse(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) {
    return false;
  }
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  return expectedSorted.every((assetId, index) => assetId === actualSorted[index]);
}
