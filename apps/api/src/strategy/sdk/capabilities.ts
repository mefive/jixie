import type { CodeStrategy, StrategyCtx, OhlcBar } from '@jixie/shared/sdk/strategy/contract';

export type StrategyStockCapabilities = Omit<
  StrategyCtx['stock'],
  'equalWeight' | 'atrAdjustedShares' | 'volTargetWeights'
>;

/** Primitives supplied by the execution environment; public helpers belong to the SDK. */
export interface StrategyCapabilities extends Pick<
  StrategyCtx,
  | 'date'
  | 'portfolio'
  | 'futures'
  | 'bar'
  | 'bars'
  | 'ensureBars'
  | 'listDays'
  | 'industry'
  | 'lhbNet'
  | 'price'
  | 'history'
  | 'factor'
  | 'indexMembers'
  | 'index'
  | 'future'
  | 'futureHistory'
> {
  readonly stock: StrategyStockCapabilities;
  loadCrossSection(indexCode?: string): Promise<string[]>;
  resampledBars(code: string, period: 'weekly' | 'monthly', count: number): OhlcBar[];
}

/** A loaded SDK definition; its callback receives the public context created by the runner. */
export interface StrategyDefinition extends Omit<CodeStrategy, 'name'> {
  name: string;
}
