import { DEFAULT_LOCALE, type FactorBar, type MultiAssetClass, type Locale } from '@jixie/shared';
import { t } from '#i18n/messages.js';
import type {
  FactorDefinition,
  FactorExecutionPort,
  FactorComputeRequest,
} from './execution-port.js';
import { factorV2YieldTerm, type FactorV2FieldKey } from '#factor/definitions/fields.js';
import type { EngineData } from '../data/engine-data.js';
import type { BarRow } from '../types.js';

/** Frozen, ownership-checked dependencies. User source is loaded only by a host factor runtime. */
export interface CustomFactorModule {
  key: string; // immutable Factor.key
  language?: 'typescript' | 'python';
  runtimeVersion?: 'ts-v1' | 'py-v1';
  code?: string; // frozen Python source; TypeScript modules use transformed js below
  js?: string; // factor module transformed to CJS; omitted for a frozen panel composite bundle
  historyFields?: CustomFactorHistoryField[];
  /** Omitted means the cross-sectional Factor SDK. Execution metadata is resolved by FactorHost. */
  analysisKind?: 'cross_sectional' | 'time_series' | 'panel';
  crossSectional?: { window?: number };
  assetSeries?: AssetFactorRuntimeMeta;
  /** Approved Panel research universe. It is metadata for allocation accounting, not factor execution. */
  assetUniverse?: Array<{ assetId: string; assetClass: MultiAssetClass }>;
  panelComposite?: {
    standardization: 'rank' | 'zscore';
    assetUniverse: Array<{ assetId: string; assetClass: MultiAssetClass }>;
    components: Array<{
      direction: 'positive' | 'negative';
      module: CustomFactorModule;
    }>;
  };
}

export type CustomFactorHistoryField =
  | 'turnoverRateF'
  | 'roe'
  | 'grossprofitMargin'
  | 'marketClose';
export type TimeSeriesFactorInput = FactorV2FieldKey;

export interface AssetFactorRuntimeMeta {
  window: number;
  inputs: TimeSeriesFactorInput[];
}

/** Identify auxiliary histories needed when preparing point-in-time sandbox inputs. */
export function extractCustomFactorHistoryFields(source: string): CustomFactorHistoryField[] {
  const fields: CustomFactorHistoryField[] = [];
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
 * Serves published-factor reads using a decision-day cache keyed by factor and instrument
 * (a monthly rebalance re-reads the same values while ranking — memoizing keeps that O(1)).
 * Windowed factors read the strategy-side bars cache — same "K-line must be loaded" contract as
 * ctx.sma (ensureBars first); without bars the window is short and compute sees [] from history().
 */
export class CustomFactorRuntime {
  private date: string | null = null;
  private memo = new Map<string, { input: string; value: number | null; read: boolean }>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private factors: Map<string, FactorDefinition>,
    private engineData: EngineData,
    private execution: FactorExecutionPort,
    private assetUniverse: string[],
    private onComputeError: (key: string, message: string) => void,
    private locale: Locale = DEFAULT_LOCALE,
  ) {
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
    return this.factors.has(key);
  }

  /** Prepare only currently accessible instruments; serialize overlapping SDK data loads. */
  prepare(
    date: string,
    codes: string[],
    crossByCode: Map<string, BarRow> | null = null,
  ): Promise<void> {
    const pending = this.pending.then(async () => {
      if (this.date !== date) {
        this.date = date;
        this.memo.clear();
      }
      for (const [key, factor] of this.factors) {
        await this.prepareFactor(factor, key, date, [...new Set(codes)], crossByCode);
      }
    });
    this.pending = pending;
    return pending;
  }

  value(key: string, date: string, code: string): number | null {
    const entry = this.memo.get(this.memoKey(key, code));
    if (date !== this.date || !entry) {
      throw new Error(t(this.locale, 'customFactorNotPrepared', { key, date, code }));
    }
    entry.read = true;
    return entry.value;
  }

  private memoKey(key: string, code: string): string {
    return JSON.stringify([key, code]);
  }

  private needsCompute(key: string, code: string, input: string): boolean {
    const previous = this.memo.get(this.memoKey(key, code));
    // Preserve first-read semantics. Unread speculative values may be refreshed after data loads.
    return !previous || (!previous.read && previous.input !== input);
  }

  private async prepareFactor(
    factor: FactorDefinition,
    key: string,
    date: string,
    codes: string[],
    crossByCode: Map<string, BarRow> | null,
  ): Promise<void> {
    if (factor.kind === 'panel_composite') {
      for (const component of factor.components) {
        await this.prepareFactor(
          component.definition,
          component.definition.id,
          date,
          this.assetUniverse,
          null,
        );
      }
      this.preparePanelComposite(factor, key);
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
        .filter(({ code, input }) => this.needsCompute(key, code, input));
      if (pending.length === 0) {
        return;
      }
      const values = await this.execution.compute({
        factorId: factor.id,
        kind: 'cross_sectional',
        items: pending.map(({ item }) => item),
      });
      this.checkResult(values, pending.length);
      pending.forEach(({ code, input }, index) => {
        this.memo.set(this.memoKey(key, code), { input, value: values[index], read: false });
      });
      return;
    }
    for (const code of codes) {
      const request = this.assetRequest(factor, key, date, code);
      const input = request ? 'ready' : 'missing';
      if (!this.needsCompute(key, code, input)) {
        continue;
      }
      let value: number | null = null;
      if (request) {
        const values = await this.execution.compute(request);
        this.checkResult(values, 1);
        value = values[0];
      }
      this.memo.set(this.memoKey(key, code), { input, value, read: false });
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
    const bars = this.engineData.bars(code, date, factor.window);
    return {
      bar: this.assembleFactorBar(date, code, crossBar),
      closes: bars.map((bar) => bar.adjClose),
      dates: bars.map((bar) => bar.date),
      amounts: bars.map((bar) => bar.amount),
      turnoverRatesF: bars.map((bar) => bar.turnoverRateF),
      roes: factor.historyFields.includes('roe')
        ? bars.map((bar) => this.engineData.roeHistoryAt(code, bar.date))
        : undefined,
      grossProfitMargins: factor.historyFields.includes('grossprofitMargin')
        ? bars.map((bar) => this.engineData.grossProfitMarginHistoryAt(code, bar.date))
        : undefined,
      marketCloses: factor.historyFields.includes('marketClose')
        ? bars.map((bar) => this.engineData.indexCloseOn('000985.CSI', bar.date))
        : undefined,
    };
  }

  private assetRequest(
    factor: Extract<FactorDefinition, { kind: 'asset_series' }>,
    key: string,
    date: string,
    code: string,
  ): Extract<FactorComputeRequest, { kind: 'asset_series' }> | null {
    if (this.engineData.assetType(code) !== 'etf') {
      this.onComputeError(
        key,
        factor.meta.inputs.includes('etf.adjustedClose')
          ? `input etf.adjustedClose requires an ETF code, received ${code}`
          : `asset-scoped Factor V2 requires an ETF code, received ${code}`,
      );
      return null;
    }
    const bars = this.engineData.bars(code, date, factor.meta.window);
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
              : this.engineData.governmentYieldAsOf(yieldTerm, bar.date)) ?? Number.NaN),
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
    key: string,
  ): void {
    const componentValues = factor.components.map((component) => ({
      component,
      values: this.assetUniverse.map(
        (assetId) => this.memo.get(this.memoKey(component.definition.id, assetId))!.value,
      ),
    }));
    const input = JSON.stringify(componentValues.map(({ values }) => values));
    const eligibleIndexes = this.assetUniverse
      .map((_, index) => index)
      .filter((index) => componentValues.every((component) => component.values[index] != null));
    const standardized = componentValues.map((component) => {
      const raw = eligibleIndexes.map((index) => component.values[index]!);
      return factor.standardization === 'rank' ? centeredRanks(raw) : standardScores(raw);
    });
    for (let index = 0; index < this.assetUniverse.length; index++) {
      const assetId = this.assetUniverse[index];
      if (!this.needsCompute(key, assetId, input)) {
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
      this.memo.set(this.memoKey(key, assetId), { input, value, read: false });
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
      netMain: this.engineData.factor('mf_net_main', date, code),
      netTotal: this.engineData.factor('mf_net_total', date, code),
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
