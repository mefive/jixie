import type { PanelFactorResearchSpecV1 } from '@jixie/shared';

/**
 * Default ETF universe for cross-asset panel research and its strategy handoff.
 * Later-listed assets remain declared so the report can expose their real coverage
 * instead of silently backfilling history or presenting a different universe.
 */
export const PANEL_ASSETS: PanelFactorResearchSpecV1['assets'] = [
  { assetId: '510300.SH', assetClass: 'cn_equity' },
  { assetId: '513100.SH', assetClass: 'overseas_equity' },
  { assetId: '511010.SH', assetClass: 'fixed_income' },
  { assetId: '511260.SH', assetClass: 'fixed_income' },
  { assetId: '511090.SH', assetClass: 'fixed_income' },
  { assetId: '518880.SH', assetClass: 'gold' },
];

export const PANEL_ASSET_IDS = PANEL_ASSETS.map((asset) => asset.assetId);
