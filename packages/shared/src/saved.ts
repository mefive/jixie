import type { BacktestConfig, BacktestSummary } from './backtest.js';
import type { ChatMessage } from './chat.js';

/**
 * Saved strategy work. Research conversations and their typed artifacts persist through the unified
 * AgentConversation model instead of a parallel saved-item table.
 */

/**
 * 提供保存资源的列表元数据，不携带 payload；时间使用 ISO 字符串。
 *
 * List-view metadata for a saved item (no payload). Timestamps are ISO strings over the wire.
 */
export interface SavedMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 组合已保存策略的完整配置与最近运行结果，供工作台恢复。
 *
 * A saved strategy with its full BacktestConfig payload + the last run's result (shown on reopen) +
 * the Agent-panel conversation that authored it (restored into the chat on reopen).
 */
export interface SavedStrategy extends SavedMeta {
  config: BacktestConfig;
  /** 从最近报告派生，不另存缓存。 / Derived from the latest report without a duplicate cache. */
  lastResult?: BacktestSummary | null;
  lastBacktest?: { id: string; status: string; needsRerun: boolean; error: string | null } | null;
  messages?: ChatMessage[] | null;
}

/**
 * 提供策略卡片的元数据及最近绩效缩略信息。
 *
 * List-view card for a saved strategy: metadata + a compact snapshot of the last run (for a sparkline
 * thumbnail + headline metrics, without shipping the whole result).
 */
export interface StrategyCard extends SavedMeta {
  snapshot?: {
    totalReturn: number;
    sharpe: number;
    trades: number;
    spark: number[]; // downsampled equity curve for a lightweight thumbnail
  };
}
