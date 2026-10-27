import type { CodeStrategy, StrategyCtx, OhlcBar } from '@jixie/shared/sdk/strategy/contract';

export type StrategyStockCapabilities = Omit<
  StrategyCtx['stock'],
  'equalWeight' | 'atrAdjustedShares' | 'volTargetWeights'
>;

/**
 * 定义执行环境提供的原始能力，公开辅助方法归 SDK 自身。
 *
 * Primitives supplied by the execution environment; public helpers belong to the SDK.
 */
export interface StrategyCapabilities extends Pick<
  StrategyCtx,
  | 'date'
  | 'portfolio'
  | 'futures'
  | 'bar'
  | 'bars'
  | 'ensureBars'
  | 'listDays'
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

/**
 * 表示已加载的 SDK 策略定义，回调接收运行器构造的公开上下文。
 *
 * A loaded SDK definition; its callback receives the public context created by the runner.
 */
export interface StrategyDefinition extends Omit<CodeStrategy, 'name'> {
  name: string;
}
