import type { BacktestConfig, BacktestSummary } from './backtest.js';
import type { ChatMessage } from './chat.js';
import type { AssetVisibility } from './library.js';
import type { ResearchStrategyHandoffV1 } from './research.js';

/**
 * Saved strategy work. Research conversations and their typed artifacts persist through the unified
 * AgentConversation model instead of a parallel saved-item table.
 */

/** List-view metadata for a saved item (no payload). Timestamps are ISO strings over the wire. */
export interface SavedMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved strategy with its full BacktestConfig payload + the last run's result (shown on reopen) +
 * the Agent-panel conversation that authored it (restored into the chat on reopen). */
export interface SavedStrategy extends SavedMeta {
  visibility: AssetVisibility;
  config: BacktestConfig;
  lastResult?: BacktestSummary | null;
  messages?: ChatMessage[] | null;
  researchHandoff?: ResearchStrategyHandoffV1 | null;
  sourceResearchExecution?: {
    id: string;
    documentId: string;
    title: string;
    displayName: string | null;
    sequence: number;
    promotedAt: string | null;
  } | null;
}

/** List-view card for a saved strategy: metadata + a compact snapshot of the last run (for a sparkline
 * thumbnail + headline metrics, without shipping the whole result). */
export interface StrategyCard extends SavedMeta {
  visibility: AssetVisibility;
  snapshot?: {
    totalReturn: number;
    sharpe: number;
    trades: number;
    spark: number[]; // downsampled equity curve for a lightweight thumbnail
  };
}
