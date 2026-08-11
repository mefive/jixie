import type { FutureContractRow } from '../tushare/api.js';

export const COMMODITY_FUTURE_SPECS = [
  {
    productCode: 'AU',
    exchange: 'SHFE',
    name: { zh: '黄金', en: 'Gold' },
    targetEtf: '518880.SH',
    targetAssetClass: 'gold',
    warehouseReceipt: { sourceName: '黄金', units: ['千克'], startDate: '20150105' },
  },
  {
    productCode: 'CU',
    exchange: 'SHFE',
    name: { zh: '铜', en: 'Copper' },
    targetEtf: '159980.SZ',
    targetAssetClass: 'commodity',
    warehouseReceipt: { sourceName: '铜', units: ['吨'], startDate: '20150105' },
  },
  {
    productCode: 'SC',
    exchange: 'INE',
    name: { zh: '原油', en: 'Crude oil' },
    targetEtf: '159981.SZ',
    targetAssetClass: 'commodity',
    warehouseReceipt: {
      sourceName: '中质含硫原油',
      units: ['桶', '吨'],
      startDate: '20181024',
    },
  },
  {
    productCode: 'M',
    exchange: 'DCE',
    name: { zh: '豆粕', en: 'Soybean meal' },
    targetEtf: '159985.SZ',
    targetAssetClass: 'commodity',
    warehouseReceipt: { sourceName: '豆粕', units: ['手'], startDate: '20150105' },
  },
] as const;

export type CommodityFutureSpec = (typeof COMMODITY_FUTURE_SPECS)[number];
export type CommodityFutureProductCode = CommodityFutureSpec['productCode'];

export const COMMODITY_FUTURE_PRODUCT_CODES = COMMODITY_FUTURE_SPECS.map(
  (spec) => spec.productCode,
);

// Real fut_holding probes return ranked actual-contract members for these products. Tushare's
// current INE/SC response is empty despite the generic documentation saying SHFE includes INE, so
// SC remains an explicit coverage gap instead of receiving a fabricated proxy.
export const COMMODITY_HOLDING_SPECS = [
  { productCode: 'AU', exchange: 'SHFE', startDate: '20150105' },
  { productCode: 'CU', exchange: 'SHFE', startDate: '20150105' },
  { productCode: 'M', exchange: 'DCE', startDate: '20150105' },
] as const;

export type CommodityHoldingProductCode = (typeof COMMODITY_HOLDING_SPECS)[number]['productCode'];

export const COMMODITY_FUTURE_EXCHANGES = [
  ...new Set(COMMODITY_FUTURE_SPECS.map((spec) => spec.exchange)),
];

export function commodityFutureProductCodesForEtfs(etfs: string[]): string[] | null {
  const byEtf = new Map<string, CommodityFutureProductCode>(
    COMMODITY_FUTURE_SPECS.map((spec) => [spec.targetEtf, spec.productCode]),
  );
  const products = etfs.map((etf) => byEtf.get(etf)).filter((item) => item !== undefined);
  return products.length === etfs.length && new Set(products).size === products.length
    ? products
    : null;
}

export function commodityWarehouseReceiptProductCodesForEtfs(etfs: string[]): string[] | null {
  const byEtf = new Map<string, CommodityFutureProductCode>(
    COMMODITY_FUTURE_SPECS.filter(
      (specification) => specification.warehouseReceipt.units.length === 1,
    ).map((specification) => [specification.targetEtf, specification.productCode]),
  );
  const products = etfs.map((etf) => byEtf.get(etf)).filter((item) => item !== undefined);
  return products.length === etfs.length && new Set(products).size === products.length
    ? products
    : null;
}

/** Keeps only the configured commodity products and fails closed before a metadata refresh can
 * delete an existing product whose upstream response unexpectedly became empty. */
export function selectCommodityFutureContracts(rows: FutureContractRow[]): FutureContractRow[] {
  const expected = new Set<string>(
    COMMODITY_FUTURE_SPECS.map((spec) => `${spec.exchange}:${spec.productCode}`),
  );
  const selected = rows.filter((row) =>
    expected.has(`${row.exchange}:${row.fut_code.toUpperCase()}`),
  );
  const received = new Set(selected.map((row) => `${row.exchange}:${row.fut_code.toUpperCase()}`));
  const missing = [...expected].filter((key) => !received.has(key));
  if (missing.length > 0) {
    throw new Error(`Commodity future metadata missing configured products: ${missing.join(', ')}`);
  }
  return selected;
}
