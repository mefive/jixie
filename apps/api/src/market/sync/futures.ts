import type { TradeDate } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { log } from '../../infra/logging.js';
import {
  COMMODITY_FUTURE_EXCHANGES,
  COMMODITY_FUTURE_PRODUCT_CODES,
  selectCommodityFutureContracts,
} from '../commodity/commodity-futures.js';
import {
  futureContracts,
  futureDaily,
  futureMapping,
  futureSettlement,
  type FutureContractRow,
} from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/client.js';

const STOCK_INDEX_FUTURE_PRODUCTS = new Set(['IF', 'IH', 'IC', 'IM']);
const STOCK_INDEX_FUTURE_CONTINUOUS_CODES = ['IF.CFX', 'IH.CFX', 'IC.CFX', 'IM.CFX'];

function isStockIndexFuture(productCode: string): boolean {
  return STOCK_INDEX_FUTURE_PRODUCTS.has(productCode.toUpperCase());
}

/** Refresh the complete metadata list of actual CFFEX stock-index futures contracts. */
export async function syncFutureContracts(client: TushareClient): Promise<number> {
  const rows = (await futureContracts(client, { exchange: 'CFFEX', fut_type: '1' })).filter((row) =>
    isStockIndexFuture(row.fut_code),
  );
  if (rows.length === 0) {
    throw new Error('Stock-index future metadata response is empty.');
  }
  await replaceFutureContracts([...STOCK_INDEX_FUTURE_PRODUCTS], rows);
  log(`syncFutureContracts: ${rows.length} 个 IF/IH/IC/IM 月合约`);
  return rows.length;
}

/** Refresh the configured research-only commodity delivery-month contracts without touching the
 * stock-index contracts that are enabled by the trading engine. */
export async function syncCommodityFutureContracts(client: TushareClient): Promise<number> {
  const exchangeRows: FutureContractRow[] = [];
  for (const exchange of COMMODITY_FUTURE_EXCHANGES) {
    exchangeRows.push(...(await futureContracts(client, { exchange, fut_type: '1' })));
  }
  const rows = selectCommodityFutureContracts(exchangeRows);
  await replaceFutureContracts(COMMODITY_FUTURE_PRODUCT_CODES, rows);
  log(`syncCommodityFutureContracts: ${rows.length} 个 AU/CU/SC/M 实际月合约（研究只读）`);
  return rows.length;
}

/** Sync actual-contract daily bars. Fetching by contract keeps a full-history load to a few hundred
 * calls instead of one call per trading day across the whole CFFEX market. */
export async function syncFutureDaily(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  return syncFutureDailyForProducts(
    client,
    start,
    end,
    [...STOCK_INDEX_FUTURE_PRODUCTS],
    'stock-index',
  );
}

/** Sync raw settlements for configured commodity contracts. This does not create a tradable
 * continuous series and does not enable commodity order execution. */
export async function syncCommodityFutureDaily(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  return syncFutureDailyForProducts(
    client,
    start,
    end,
    COMMODITY_FUTURE_PRODUCT_CODES,
    'commodity',
  );
}

async function syncFutureDailyForProducts(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
  productCodes: readonly string[],
  label: string,
): Promise<number> {
  const contracts = await overlappingFutureContracts(start, end, productCodes, label);
  let totalRows = 0;

  for (const [index, contract] of contracts.entries()) {
    const rangeStart = contract.listDate > start ? contract.listDate : start;
    const rangeEnd = contract.delistDate < end ? contract.delistDate : end;
    const rows = await futureDaily(client, {
      ts_code: contract.tsCode,
      start_date: rangeStart,
      end_date: rangeEnd,
    });
    await prisma.$transaction([
      prisma.futureDaily.deleteMany({
        where: { tsCode: contract.tsCode, tradeDate: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.futureDaily.createMany({
        data: rows.map((row) => ({
          tsCode: row.ts_code,
          tradeDate: row.trade_date,
          preClose: row.pre_close,
          preSettle: row.pre_settle,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          settle: row.settle,
          changeClose: row.change1,
          changeSettle: row.change2,
          volume: row.vol,
          amount: row.amount,
          openInterest: row.oi,
          openInterestChange: row.oi_chg,
          deliverySettle: row.delv_settle,
        })),
      }),
    ]);
    totalRows += rows.length;
    if ((index + 1) % 20 === 0 || index + 1 === contracts.length) {
      log(`syncFutureDaily(${label}): ${index + 1}/${contracts.length} 合约，累计 ${totalRows} 行`);
    }
  }
  return totalRows;
}

/** Sync vendor main-contract mappings for all four stock-index futures products. */
export async function syncFutureMappings(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  let totalRows = 0;

  for (const continuousCode of STOCK_INDEX_FUTURE_CONTINUOUS_CODES) {
    const rows = await futureMapping(client, {
      ts_code: continuousCode,
      start_date: start,
      end_date: end,
    });
    await prisma.$transaction([
      prisma.futureMapping.deleteMany({
        where: { continuousCode, tradeDate: { gte: start, lte: end } },
      }),
      prisma.futureMapping.createMany({
        data: rows.map((row) => ({
          continuousCode: row.ts_code,
          tradeDate: row.trade_date,
          mappedTsCode: row.mapping_ts_code,
        })),
      }),
    ]);
    totalRows += rows.length;
    log(`syncFutureMappings ${continuousCode}: ${rows.length} 行`);
  }
  return totalRows;
}

/** Sync historical exchange fee and margin parameters for actual contracts. */
export async function syncFutureSettlements(
  client: TushareClient,
  start: TradeDate,
  end: TradeDate,
): Promise<number> {
  const contracts = await overlappingFutureContracts(
    start,
    end,
    [...STOCK_INDEX_FUTURE_PRODUCTS],
    'stock-index',
  );
  let totalRows = 0;

  for (const [index, contract] of contracts.entries()) {
    const rangeStart = contract.listDate > start ? contract.listDate : start;
    const rangeEnd = contract.delistDate < end ? contract.delistDate : end;
    const rows = await futureSettlement(client, {
      ts_code: contract.tsCode,
      start_date: rangeStart,
      end_date: rangeEnd,
    });
    await prisma.$transaction([
      prisma.futureSettlement.deleteMany({
        where: { tsCode: contract.tsCode, tradeDate: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.futureSettlement.createMany({
        data: rows.map((row) => ({
          tsCode: row.ts_code,
          tradeDate: row.trade_date,
          settle: row.settle,
          tradingFeeRate: row.trading_fee_rate,
          tradingFee: row.trading_fee,
          deliveryFee: row.delivery_fee,
          buyHedgeMarginRate: row.b_hedging_margin_rate,
          sellHedgeMarginRate: row.s_hedging_margin_rate,
          longMarginRate: row.long_margin_rate,
          shortMarginRate: row.short_margin_rate,
          closeTodayFee: row.offset_today_fee,
          exchange: row.exchange,
        })),
      }),
    ]);
    totalRows += rows.length;
    if ((index + 1) % 20 === 0 || index + 1 === contracts.length) {
      log(`syncFutureSettlements: ${index + 1}/${contracts.length} 合约，累计 ${totalRows} 行`);
    }
  }
  return totalRows;
}

async function overlappingFutureContracts(
  start: TradeDate,
  end: TradeDate,
  productCodes: readonly string[],
  label: string,
) {
  const contracts = await prisma.futureContract.findMany({
    where: {
      productCode: { in: [...productCodes] },
      listDate: { lte: end },
      delistDate: { gte: start },
    },
    orderBy: [{ productCode: 'asc' }, { listDate: 'asc' }],
    select: { tsCode: true, listDate: true, delistDate: true },
  });
  if (contracts.length === 0) {
    throw new Error(`No ${label} futures contracts found. Sync contract metadata first.`);
  }
  return contracts;
}

async function replaceFutureContracts(
  productCodes: readonly string[],
  rows: Awaited<ReturnType<typeof futureContracts>>,
): Promise<void> {
  await prisma.$transaction([
    prisma.futureContract.deleteMany({ where: { productCode: { in: [...productCodes] } } }),
    prisma.futureContract.createMany({
      data: rows.map((row) => ({
        tsCode: row.ts_code,
        symbol: row.symbol,
        productCode: row.fut_code.toUpperCase(),
        name: row.name,
        exchange: row.exchange,
        multiplier: row.multiplier,
        tradeUnit: row.trade_unit,
        perUnit: row.per_unit,
        quoteUnit: row.quote_unit,
        quoteUnitDesc: row.quote_unit_desc,
        deliveryMode: row.d_mode_desc,
        listDate: row.list_date,
        delistDate: row.delist_date,
        deliveryMonth: row.d_month,
        lastDeliveryDate: row.last_ddate,
        tradeTimeDesc: row.trade_time_desc,
      })),
    }),
  ]);
}
