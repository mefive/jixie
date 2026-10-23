import type { MarketPartition, PreparedMarketPartition } from '../synchronization/partition.js';
import {
  completeResponse,
  fetchSourcePages,
  mapSourceRecords,
  sourceString,
  sourceValues,
  validateSourceNumbers,
  type SyncSource,
} from '../synchronization/source.js';

/**
 * 行情、映射与结算费率各有自己的覆盖，不共用完成标记。
 *
 * Prices, mappings and settlement parameters each own their coverage.
 */
export async function prepareFuturePartition(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
  const contracts = partition.dataset.endsWith('contracts');
  const mappings = partition.dataset.endsWith('mappings');
  const settlements = partition.dataset === 'future-settlements';
  const columns: Record<string, string> = contracts
    ? {
        tsCode: 'ts_code',
        symbol: 'symbol',
        productCode: 'fut_code',
        name: 'name',
        exchange: 'exchange',
        multiplier: 'multiplier',
        tradeUnit: 'trade_unit',
        perUnit: 'per_unit',
        quoteUnit: 'quote_unit',
        quoteUnitDesc: 'quote_unit_desc',
        deliveryMode: 'd_mode_desc',
        listDate: 'list_date',
        delistDate: 'delist_date',
        deliveryMonth: 'd_month',
        lastDeliveryDate: 'last_ddate',
        tradeTimeDesc: 'trade_time_desc',
      }
    : mappings
      ? { continuousCode: 'ts_code', tradeDate: 'trade_date', mappedTsCode: 'mapping_ts_code' }
      : settlements
        ? {
            tsCode: 'ts_code',
            tradeDate: 'trade_date',
            settle: 'settle',
            tradingFeeRate: 'trading_fee_rate',
            tradingFee: 'trading_fee',
            deliveryFee: 'delivery_fee',
            buyHedgeMarginRate: 'b_hedging_margin_rate',
            sellHedgeMarginRate: 's_hedging_margin_rate',
            longMarginRate: 'long_margin_rate',
            shortMarginRate: 'short_margin_rate',
            closeTodayFee: 'offset_today_fee',
            exchange: 'exchange',
          }
        : {
            tsCode: 'ts_code',
            tradeDate: 'trade_date',
            preClose: 'pre_close',
            preSettle: 'pre_settle',
            open: 'open',
            high: 'high',
            low: 'low',
            close: 'close',
            settle: 'settle',
            changeClose: 'change1',
            changeSettle: 'change2',
            volume: 'vol',
            amount: 'amount',
            openInterest: 'oi',
            openInterestChange: 'oi_chg',
            deliverySettle: 'delv_settle',
          };
  const api = contracts
    ? 'fut_basic'
    : mappings
      ? 'fut_mapping'
      : settlements
        ? 'fut_settle'
        : 'fut_daily';
  const table = contracts
    ? 'FutureContract'
    : mappings
      ? 'FutureMapping'
      : settlements
        ? 'FutureSettlement'
        : 'FutureDaily';
  const pages = await fetchSourcePages(
    source,
    api,
    contracts
      ? {
          exchange: partition.scope.split('|')[0],
          fut_type: '1',
          fut_code: partition.scope.split('|')[1],
        }
      : { ts_code: partition.scope, start_date: partition.startDate, end_date: partition.endDate },
    Object.values(columns).join(','),
  );
  const mapped = mapSourceRecords(pages.rows, (row) => {
    if (contracts) {
      if (
        row.fut_code !== partition.scope.split('|')[1] ||
        row.exchange !== partition.scope.split('|')[0] ||
        typeof row.list_date !== 'string' ||
        typeof row.delist_date !== 'string' ||
        row.list_date > row.delist_date
      ) {
        throw new Error('Invalid futures metadata');
      }
    } else if (
      row.ts_code !== partition.scope ||
      typeof row.trade_date !== 'string' ||
      row.trade_date < partition.startDate ||
      row.trade_date > partition.endDate
    ) {
      throw new Error('Invalid futures partition identity/date');
    }
    if (table === 'FutureDaily' && (typeof row.settle !== 'number' || row.settle <= 0)) {
      throw new Error('Invalid futures settlement price');
    }
    if (table === 'FutureMapping') {
      sourceString(row, 'mapping_ts_code');
    }

    const values = sourceValues(row, columns);
    validateSourceNumbers(
      values,
      ['open', 'high', 'low', 'close', 'settle', 'multiplier'],
      [
        'volume',
        'amount',
        'openInterest',
        'longMarginRate',
        'shortMarginRate',
        'tradingFeeRate',
        'tradingFee',
      ],
    );

    return {
      values,
      availableDate: typeof row.trade_date === 'string' ? row.trade_date : null,
      availabilityQuality: 'source_contract',
    };
  });

  return completeResponse({
    pages,
    table,
    extent: {
      basis: 'Filtered futures source contract',
      deletion: 'Exact futures series after session qualification',
    },
    ...mapped,
    observedDates: mapped.records.flatMap((record) =>
      typeof record.values.tradeDate === 'string' ? [record.values.tradeDate] : [],
    ),
    ...(!contracts
      ? {
          where: {
            [mappings ? 'continuousCode' : 'tsCode']: partition.scope,
            tradeDate: { gte: partition.startDate, lte: partition.endDate },
          },
        }
      : {}),
  });
}
