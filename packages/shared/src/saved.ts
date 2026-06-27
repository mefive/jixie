import type { BacktestConfig } from './backtest.js';
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

/** A saved strategy with its full BacktestConfig payload. */
export interface SavedStrategy extends SavedMeta {
  config: BacktestConfig;
}

/** A saved screen query with its full ScreenSpec payload. */
export interface SavedScreenQuery extends SavedMeta {
  spec: ScreenSpec;
}
