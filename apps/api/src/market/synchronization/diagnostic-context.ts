import { z } from 'zod';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { isObservationDate } from './date.js';
import type { MarketTransaction } from './partition.js';

export const DIAGNOSTIC_CONTEXT_LIMIT = 5000;
const datasetTables: Record<string, string[]> = {
  calendar: ['TradeCal'],
  'stock-master': ['StockBasic', 'StockCodeChange'],
  'stock-names': ['StockNameHistory', 'StockBasic', 'StockCodeChange'],
  'stock-prices': ['Daily', 'StockBasic', 'StockCodeChange'],
  'stock-adjustments': ['AdjFactor', 'StockBasic', 'StockCodeChange'],
  'stock-valuations': ['DailyBasic', 'StockBasic', 'StockCodeChange'],
  'stock-limits': ['StkLimit', 'StockBasic', 'StockCodeChange'],
  'etf-master': ['EtfBasic'],
  'etf-prices': ['EtfDaily', 'EtfBasic'],
  'etf-adjustments': ['EtfAdjFactor', 'EtfBasic'],
  'etf-selection': ['IngestionSelection', 'EtfBasic'],
  'index-prices': ['IndexDaily'],
  'index-valuations': ['IndexDailyBasic'],
  'index-weights': ['IndexWeight'],
  'financial-statements': ['StockBasic', 'StockCodeChange'],
  'financial-indicators': [
    'FinaIndicator',
    'FinaIndicatorVersion',
    'StockBasic',
    'StockCodeChange',
  ],
  dividends: ['Dividend', 'StockBasic', 'StockCodeChange'],
};
const statementTables = new Map([
  ['income', 'FinancialIncomeStatement'],
  ['balance_sheet', 'FinancialBalanceSheet'],
  ['cash_flow', 'FinancialCashFlowStatement'],
]);
const identityLimit = 100;
const sourceRowSchema = z.record(z.string(), z.unknown());

export interface DiagnosticContextInput {
  dataset: string;
  scope: string;
  period: string;
  startDate?: string | null;
  endDate?: string | null;
  businessKey: unknown;
  payload: unknown;
}

export interface DiagnosticTableRows {
  table: string;
  query: object;
  rows: object[];
  match: 'found' | 'not_found' | 'incomplete';
  complete: boolean;
  matchedCount: number | null;
  matchedCountAtLeast: number;
  returnedCount: number;
}

export interface MarketDiagnosticContext {
  contextComplete: boolean;
  limitations: string[];
  identities: Array<{ tsCode?: string; tradeDate?: string; endDate?: string }>;
  tables: DiagnosticTableRows[];
  tableNames: string[];
  ruleReferences: string[];
  ruleCodes: string[];
  mappedCandidates: { available: false; reason: string };
}

function sourceRows(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') {
    try {
      return sourceRows(JSON.parse(value));
    } catch {
      return [];
    }
  }
  const values = Array.isArray(value) ? value : [value];

  return values.flatMap((item) => {
    const parsed = sourceRowSchema.safeParse(item);

    return parsed.success ? [parsed.data] : [];
  });
}

function securityCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^(?:\d{6}|H\d{5})\.(SH|SZ|BJ|CSI)$/.test(value)
    ? value
    : undefined;
}

/**
 * 只查询可解释的业务身份；缺少身份不退化为全市场扫描。
 *
 * Read only explainable business identities; missing keys never become whole-market scans.
 */
export async function loadMarketDiagnosticContext(
  database: MarketTransaction,
  input: DiagnosticContextInput,
): Promise<MarketDiagnosticContext> {
  const context: MarketDiagnosticContext = {
    contextComplete: true,
    limitations: [],
    identities: [],
    tables: [],
    tableNames: Object.hasOwn(datasetTables, input.dataset)
      ? [...datasetTables[input.dataset]]
      : [],
    ruleReferences: ['apps/api/src/market/synchronization/rows.ts'],
    ruleCodes: ['null_is_unknown_zero_is_known', 'source_payload_is_not_a_stored_row'],
    mappedCandidates: {
      available: false,
      reason: 'repair_value_and_formal_admission_not_selected',
    },
  };
  const incomplete = (reason: string) => {
    context.contextComplete = false;
    if (!context.limitations.includes(reason)) {
      context.limitations.push(reason);
    }
  };
  const rows = [...sourceRows(input.payload), ...sourceRows(input.businessKey)];
  const identities = new Map<string, (typeof context.identities)[number]>();
  const stockDataset =
    input.dataset.startsWith('stock-') ||
    ['financial-statements', 'financial-indicators', 'dividends'].includes(input.dataset);
  for (const row of rows.length ? rows : [{}]) {
    const rawCode = row.tsCode ?? row.ts_code ?? row.conCode ?? row.con_code;
    const code = securityCode(rawCode) ?? securityCode(input.scope);
    const date = row.tradeDate ?? row.trade_date ?? row.calDate ?? row.cal_date;
    const report = row.endDate ?? row.end_date;
    if (rawCode != null && !securityCode(rawCode)) {
      incomplete('invalid_source_security_identity');
    }
    if (date != null && !isObservationDate(date)) {
      incomplete('invalid_source_trade_date');
    }
    if (report != null && !isObservationDate(report)) {
      incomplete('invalid_source_report_period');
    }
    const scopeCode = securityCode(input.scope);
    if (
      input.dataset !== 'index-weights' &&
      scopeCode &&
      code &&
      (stockDataset
        ? canonicalStockCode(code) !== canonicalStockCode(scopeCode)
        : code !== scopeCode)
    ) {
      incomplete('source_security_differs_from_batch_scope');
    }
    const identity = {
      ...(code ? { tsCode: stockDataset ? canonicalStockCode(code) : code } : {}),
      ...(isObservationDate(date)
        ? { tradeDate: date }
        : isObservationDate(input.period)
          ? { tradeDate: input.period }
          : {}),
      ...(isObservationDate(report)
        ? { endDate: report }
        : isObservationDate(input.period)
          ? { endDate: input.period }
          : {}),
    };
    if (identities.size >= identityLimit && !identities.has(JSON.stringify(identity))) {
      incomplete('identity_limit_exceeded');
      continue;
    }
    identities.set(JSON.stringify(identity), identity);
  }
  context.identities = [...identities.values()];
  const codes = [
    ...new Set(
      context.identities.flatMap((identity) => (identity.tsCode ? [identity.tsCode] : [])),
    ),
  ];
  const dates = context.identities.flatMap((identity) =>
    identity.tradeDate ? [identity.tradeDate] : [],
  );
  const periodKeys = context.identities.flatMap((identity) =>
    identity.tsCode && identity.endDate
      ? [{ tsCode: identity.tsCode, endDate: identity.endDate }]
      : [],
  );
  const dayKeys = context.identities.flatMap((identity) =>
    identity.tsCode && identity.tradeDate
      ? [{ tsCode: identity.tsCode, tradeDate: identity.tradeDate }]
      : [],
  );
  const capture = async (table: string, query: object, read: () => Promise<object[]>) => {
    let found: object[];
    try {
      found = await read();
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'P2021' || error.code === 'P2022')
      ) {
        incomplete('business_schema_mismatch');
        context.tables.push({
          table,
          query,
          rows: [],
          match: 'incomplete',
          complete: false,
          matchedCount: null,
          matchedCountAtLeast: 0,
          returnedCount: 0,
        });
        return;
      }
      throw error;
    }
    const complete = found.length <= DIAGNOSTIC_CONTEXT_LIMIT;
    if (!complete) {
      incomplete('business_context_row_limit_exceeded');
    }
    if (!context.tableNames.includes(table)) {
      context.tableNames.push(table);
    }
    context.tables.push({
      table,
      query,
      rows: found.slice(0, DIAGNOSTIC_CONTEXT_LIMIT),
      match: complete ? (found.length ? 'found' : 'not_found') : 'incomplete',
      complete,
      matchedCount: complete ? found.length : null,
      matchedCountAtLeast: found.length,
      returnedCount: Math.min(found.length, DIAGNOSTIC_CONTEXT_LIMIT),
    });
  };
  const take = DIAGNOSTIC_CONTEXT_LIMIT + 1;
  const dateRange = {
    ...(isObservationDate(input.startDate) ? { gte: input.startDate } : {}),
    ...(isObservationDate(input.endDate) ? { lte: input.endDate } : {}),
  };
  const dailyWhere = { OR: dayKeys };
  const periodWhere = { OR: periodKeys };

  switch (input.dataset) {
    case 'calendar': {
      context.ruleReferences.push('apps/api/src/market/calendar/sync-partition.ts');
      context.ruleCodes.push('independent_exchange_calendars', 'missing_history_is_not_fabricated');
      if (!['SSE', 'SZSE', 'BSE'].includes(input.scope) || !Object.keys(dateRange).length) {
        incomplete('missing_calendar_range');
        break;
      }
      const where = { exchange: input.scope, calDate: dates.length ? { in: dates } : dateRange };
      await capture('TradeCal', where, () =>
        database.tradeCal.findMany({ where, take, orderBy: { calDate: 'asc' } }),
      );
      break;
    }
    case 'stock-master':
    case 'stock-names': {
      context.ruleReferences.push('apps/api/src/market/stocks/sync-partition.ts');
      if (!codes.length) {
        incomplete('missing_security_identity');
        break;
      }
      if (input.dataset === 'stock-names') {
        const where = { tsCode: { in: codes } };
        await capture('StockNameHistory', where, () =>
          database.stockNameHistory.findMany({
            where,
            take,
            orderBy: [{ tsCode: 'asc' }, { startDate: 'asc' }],
          }),
        );
      }
      break;
    }
    case 'stock-prices':
    case 'stock-adjustments':
    case 'stock-valuations':
    case 'stock-limits': {
      context.ruleReferences.push(
        'apps/api/src/market/stocks/sync-partition.ts',
        'apps/api/src/market/stocks/write.ts',
      );
      context.ruleCodes.push('stock_catalog_whitelist', 'ohlc_range_warning_preserves_values');
      if (!dayKeys.length || dayKeys.length !== context.identities.length) {
        incomplete('missing_security_or_trade_date');
        break;
      }
      switch (input.dataset) {
        case 'stock-prices':
          await capture('Daily', dailyWhere, () =>
            database.daily.findMany({ where: dailyWhere, take }),
          );
          break;
        case 'stock-adjustments':
          await capture('AdjFactor', dailyWhere, () =>
            database.adjFactor.findMany({ where: dailyWhere, take }),
          );
          break;
        case 'stock-valuations':
          await capture('DailyBasic', dailyWhere, () =>
            database.dailyBasic.findMany({ where: dailyWhere, take }),
          );
          break;
        case 'stock-limits':
          await capture('StkLimit', dailyWhere, () =>
            database.stkLimit.findMany({ where: dailyWhere, take }),
          );
          break;
      }
      break;
    }
    case 'etf-master':
    case 'etf-prices':
    case 'etf-adjustments':
    case 'etf-selection': {
      context.ruleReferences.push('apps/api/src/market/etfs/sync-partition.ts');
      if (input.dataset === 'etf-selection') {
        const where = { assetType: 'etf' };
        await capture('IngestionSelection', where, () =>
          database.ingestionSelection.findMany({ where, take }),
        );
        context.ruleReferences.push('apps/api/src/market/downloads/select-etfs.ts');
        incomplete('historical_ranking_response_not_persisted');
      }
      if (!codes.length) {
        incomplete('missing_security_identity');
        break;
      }
      const where = { tsCode: { in: codes } };
      await capture('EtfBasic', where, () => database.etfBasic.findMany({ where, take }));
      if (input.dataset === 'etf-prices' || input.dataset === 'etf-adjustments') {
        if (dayKeys.length !== context.identities.length) {
          incomplete('missing_trade_date');
          break;
        }
        if (input.dataset === 'etf-prices') {
          await capture('EtfDaily', dailyWhere, () =>
            database.etfDaily.findMany({ where: dailyWhere, take }),
          );
        } else {
          await capture('EtfAdjFactor', dailyWhere, () =>
            database.etfAdjFactor.findMany({ where: dailyWhere, take }),
          );
        }
      }
      break;
    }
    case 'index-prices':
    case 'index-valuations':
    case 'index-weights': {
      context.ruleReferences.push(
        'apps/api/src/market/indices/sync-partition.ts',
        'apps/api/src/market/indices/write.ts',
      );
      if (input.dataset === 'index-weights') {
        const indexCode = securityCode(input.scope);
        if (!indexCode || (!dates.length && !Object.keys(dateRange).length)) {
          incomplete('missing_index_snapshot_identity');
          break;
        }
        const where = { indexCode, tradeDate: dates.length ? { in: dates } : dateRange };
        await capture('IndexWeight', where, () =>
          database.indexWeight.findMany({
            where,
            take,
            orderBy: [{ tradeDate: 'asc' }, { conCode: 'asc' }],
          }),
        );
        context.ruleCodes.push('constituent_snapshot_is_atomic');
      } else if (dayKeys.length !== context.identities.length || !dayKeys.length) {
        incomplete('missing_index_or_trade_date');
      } else if (input.dataset === 'index-prices') {
        await capture('IndexDaily', dailyWhere, () =>
          database.indexDaily.findMany({ where: dailyWhere, take }),
        );
      } else {
        await capture('IndexDailyBasic', dailyWhere, () =>
          database.indexDailyBasic.findMany({ where: dailyWhere, take }),
        );
      }
      break;
    }
    case 'financial-statements':
    case 'financial-indicators':
    case 'dividends': {
      context.ruleReferences.push(
        'apps/api/src/market/fundamentals/sync-partition.ts',
        'apps/api/src/market/fundamentals/write.ts',
      );
      if (input.dataset === 'financial-statements') {
        const table = statementTables.get(input.scope.split('|')[0]);
        if (table) {
          context.tableNames.push(table);
        }
      }
      if (!periodKeys.length || periodKeys.length !== context.identities.length) {
        incomplete('missing_security_or_report_period');
        break;
      }
      switch (input.dataset) {
        case 'dividends':
          context.ruleReferences.push(
            'apps/api/src/market/fundamentals/dividend-identity.ts',
            'apps/api/src/market/fundamentals/dividend-selection.ts',
            'apps/api/src/market/fundamentals/dividend-cash-events.ts',
          );
          context.ruleCodes.push(
            'distribution_shape_is_not_plan_id',
            'newer_base_only_within_identity',
            'same_base_known_conflicts_retained',
            'latest_only_is_not_historical_pit',
            'adjustment_factors_are_independent',
          );
          await capture('Dividend', periodWhere, () =>
            database.dividend.findMany({ where: periodWhere, take, orderBy: { id: 'asc' } }),
          );
          break;
        case 'financial-indicators':
          context.ruleReferences.push(
            'apps/api/src/market/fundamentals/indicator-selection.ts',
            'apps/api/src/market/fundamentals/indicator-versions.ts',
          );
          await capture('FinaIndicator', periodWhere, () =>
            database.finaIndicator.findMany({ where: periodWhere, take }),
          );
          await capture('FinaIndicatorVersion', periodWhere, () =>
            database.finaIndicatorVersion.findMany({
              where: periodWhere,
              take,
              orderBy: { id: 'asc' },
            }),
          );
          break;
        case 'financial-statements': {
          context.ruleReferences.push(
            'apps/api/src/market/fundamentals/source-contract.ts',
            'apps/api/src/market/fundamentals/resolver.ts',
          );
          context.ruleCodes.push(
            'append_source_versions',
            'availability_is_separate_from_announcement',
          );
          const statement = input.scope.split('|')[0];
          switch (statement) {
            case 'income':
              await capture('FinancialIncomeStatement', periodWhere, () =>
                database.financialIncomeStatement.findMany({
                  where: periodWhere,
                  take,
                  orderBy: { id: 'asc' },
                }),
              );
              break;
            case 'balance_sheet':
              await capture('FinancialBalanceSheet', periodWhere, () =>
                database.financialBalanceSheet.findMany({
                  where: periodWhere,
                  take,
                  orderBy: { id: 'asc' },
                }),
              );
              break;
            case 'cash_flow':
              await capture('FinancialCashFlowStatement', periodWhere, () =>
                database.financialCashFlowStatement.findMany({
                  where: periodWhere,
                  take,
                  orderBy: { id: 'asc' },
                }),
              );
              break;
            default:
              incomplete('unknown_statement_kind');
          }
          break;
        }
      }
      break;
    }
    default:
      incomplete('unsupported_dataset');
  }

  if (stockDataset && codes.length) {
    const where = { tsCode: { in: codes } };
    await capture('StockBasic', where, () => database.stockBasic.findMany({ where, take }));
    const changes = { OR: [{ oldTsCode: { in: codes } }, { newTsCode: { in: codes } }] };
    await capture('StockCodeChange', changes, () =>
      database.stockCodeChange.findMany({ where: changes, take }),
    );
    context.ruleReferences.push('apps/api/src/market/instruments/stock-identity.ts');
  }

  return context;
}
