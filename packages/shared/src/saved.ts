import type { BacktestConfig, BacktestSummary } from './backtest.js';
import type { ChatMessage } from './chat.js';
import type { ScreenSpec } from './screen.js';

/**
 * Saved user work (per-product-line persistence). Two parallel shapes, one per product line — a saved
 * strategy carries a BacktestConfig, a saved screen carries a ScreenSpec. Both are owner-scoped and
 * identified by name within a user (saving upserts by name). List views return metadata only; opening
 * one returns the full payload.
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
  config: BacktestConfig;
  lastResult?: BacktestSummary | null;
  messages?: ChatMessage[] | null;
}

/** List-view card for a saved strategy: metadata + a compact snapshot of the last run (for a sparkline
 * thumbnail + headline metrics, without shipping the whole result). */
export interface StrategyCard extends SavedMeta {
  snapshot?: {
    totalReturn: number;
    sharpe: number;
    trades: number;
    spark: number[]; // downsampled equity curve for a lightweight thumbnail
  };
}

/** A saved screen query with its full ScreenSpec payload. */
export interface SavedScreenQuery extends SavedMeta {
  spec: ScreenSpec;
}

/** List-view card for a screen conversation (the card wall's "session card"): metadata + a preview
 * of the last message and how many query cards the conversation holds. */
export interface ScreenConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  preview: string; // last message's text, truncated
  cardCount: number; // card parts across the conversation
}

/** A screen conversation with its full message list (parts shape). */
export interface ScreenConversationDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}
