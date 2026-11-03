import { calendarDay } from '#market/synchronization/date.js';
import type { SyncSource } from '#market/synchronization/source.js';
import type { TushareRow } from '#market/providers/tushare/tushare-client.js';
import { FINANCIAL_STATEMENT_FIELDS } from '#market/fundamentals/source-contract.js';
import type { Prisma } from '#infra/database/prisma.js';

export const ingestionTime = new Date('1991-01-05T10:00:00Z');

export async function emptySelections(database: Prisma): Promise<void> {
  await database.ingestionSelection.createMany({
    data: [
      { assetType: 'etf', codes: [] },
      { assetType: 'index', codes: [] },
    ],
  });
}

/**
 * 保留真实规划、映射、写入和事务，只替代外部来源。
 *
 * Exercise real planning, mapping, writes and transactions, replacing only the external provider.
 */
export function ingestionSource(
  options: {
    prices?: (date: string, offset: number) => TushareRow[];
    incomeAvailable?: () => boolean;
    incomePeriod?: string;
    onCall?: (api: string, params: Record<string, unknown>) => void;
  } = {},
): SyncSource {
  return {
    call: async (api, params = {}) => {
      options.onCall?.(api, params);
      const date = String(params.trade_date ?? '19910104');
      switch (api) {
        case 'trade_cal': {
          const rows: TushareRow[] = [];
          for (
            let cursor = String(params.start_date);
            cursor <= String(params.end_date);
            cursor = calendarDay(cursor, 1)
          ) {
            const day = new Date(
              `${cursor.slice(0, 4)}-${cursor.slice(4, 6)}-${cursor.slice(6)}T00:00:00Z`,
            ).getUTCDay();
            rows.push({
              exchange: String(params.exchange),
              cal_date: cursor,
              is_open: day > 0 && day < 6 ? 1 : 0,
              pretrade_date: null,
            });
          }
          return rows;
        }
        case 'stock_basic':
          return params.list_status === 'L'
            ? [
                {
                  ts_code: '600000.SH',
                  symbol: '600000',
                  name: 'Fixture',
                  area: null,
                  market: '主板',
                  exchange: 'SSE',
                  list_date: '19901219',
                  delist_date: null,
                  list_status: 'L',
                },
              ]
            : [];
        case 'etf_basic':
          return [
            {
              ts_code: '510000.SH',
              list_status: 'L',
              list_date: '19901219',
              exchange: 'SH',
              etf_type: '股票型',
              csname: 'ETF',
              extname: 'ETF',
            },
          ];
        case 'fund_basic':
          return [{ ts_code: '510000.SH', name: 'ETF', fund_type: '股票型', delist_date: null }];
        case 'etf_share_size':
          return [{ ts_code: '510000.SH', trade_date: date, total_size: 100 }];
        case 'index_daily':
          return [{ ts_code: String(params.ts_code), trade_date: '19901219', close: 100 }];
        case 'index_dailybasic':
        case 'index_weight':
          return [];
        case 'daily':
          return (
            options.prices?.(date, Number(params.offset ?? 0)) ?? [
              { ts_code: '600000.SH', trade_date: date, open: 10, high: 11, low: 9, close: 10 },
            ]
          );
        case 'adj_factor':
          return [{ ts_code: '600000.SH', trade_date: date, adj_factor: 1 }];
        case 'daily_basic':
          return [{ ts_code: '600000.SH', trade_date: date, pe: -2, pb: null }];
        case 'stk_limit':
          return [
            {
              ts_code: '600000.SH',
              trade_date: date,
              up_limit: 0,
              down_limit: 0,
              exchange: 'SSE',
              asset_type: 'STK',
            },
          ];
        case 'income_vip': {
          if (
            !options.incomeAvailable?.() ||
            (params.period && params.period !== (options.incomePeriod ?? '19901231')) ||
            params.report_type !== '1'
          ) {
            return [];
          }
          const row: TushareRow = {
            ts_code: '600000.SH',
            end_date: options.incomePeriod ?? '19901231',
            ann_date: '19910103',
            f_ann_date: '19910103',
            report_type: '1',
            comp_type: '1',
            update_flag: '0',
          };
          for (const field of FINANCIAL_STATEMENT_FIELDS.filter(
            (field) => field.statementKind === 'income',
          )) {
            row[field.sourceField] = 100;
          }
          return [row];
        }
        case 'fund_daily':
        case 'fund_adj':
        case 'namechange':
        case 'dividend':
        case 'balancesheet_vip':
        case 'cashflow_vip':
        case 'fina_indicator_vip':
          return [];
        default:
          throw new Error(`Unexpected fixture request ${api}`);
      }
    },
  };
}
