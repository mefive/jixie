import type {
  MarketTransaction,
  PreparedMarketPartition,
  SourceRecord,
} from '../synchronization/partition.js';
import { fingerprint, readMarketRows, rowKey } from '../synchronization/records.js';
import { STOCK_CODE_CHANGES, type StockCodeChangeDefinition } from './stock-identity.js';

const IDENTITY_TABLES = [
  'Daily',
  'AdjFactor',
  'DailyBasic',
  'StkLimit',
  'Moneyflow',
  'TopList',
  'StockNameHistory',
  'SwIndustryMember',
  'FinaIndicator',
  'FinaIndicatorVersion',
  'FinancialIncomeStatement',
  'FinancialBalanceSheet',
  'FinancialCashFlowStatement',
  'Dividend',
  'IndexWeight',
];

/**
 * 只合并已确认同一证券的接续，冲突整条血缘拒绝；保留名称和生效日。
 *
 * Merge only confirmed security successions; reject a conflicting lineage and preserve names and
 * effective dates.
 */
export async function prepareIdentityNormalization(
  transaction: MarketTransaction,
  change: StockCodeChangeDefinition,
): Promise<PreparedMarketPartition> {
  if (
    !STOCK_CODE_CHANGES.some(
      (known) =>
        known.oldTsCode === change.oldTsCode &&
        known.newTsCode === change.newTsCode &&
        known.effectiveDate === change.effectiveDate,
    )
  ) {
    throw new Error('Unconfirmed security succession');
  }
  const result: PreparedMarketPartition = {
    tables: [
      {
        table: 'StockCodeChange',
        records: [{ values: { ...change }, availabilityQuality: 'source_contract' }],
      },
    ],
    status: 'complete',
    evidence: { confirmedSuccession: true, effectiveDate: change.effectiveDate },
    errors: [],
    gaps: [],
    observedDates: [],
  };
  for (const table of IDENTITY_TABLES) {
    const field = table === 'IndexWeight' ? 'conCode' : 'tsCode';
    const rows = await readMarketRows(transaction, table, {
      [field]: { in: [change.oldTsCode, change.newTsCode] },
    });
    if (!rows.some((row) => row[field] === change.oldTsCode)) {
      continue;
    }
    const merged = new Map<string, SourceRecord>();
    for (const row of rows.sort(
      (left, right) =>
        Number(left[field] === change.oldTsCode) - Number(right[field] === change.oldTsCode),
    )) {
      const values = { ...row, [field]: change.newTsCode };
      if (table === 'Dividend') {
        values.id = fingerprint({
          tsCode: values.tsCode,
          endDate: values.endDate,
          annDate: values.annDate,
          exDate: values.exDate,
          divProc: values.divProc,
        });
      }
      const key = rowKey(table, values);
      const previous = merged.get(key);
      if (previous) {
        const comparable = (record: typeof values) =>
          fingerprint(
            Object.fromEntries(
              Object.entries(record).filter(
                ([name]) => !['id', 'retrievedAt', 'observedAt'].includes(name),
              ),
            ),
          );
        if (comparable(previous.values) !== comparable(values)) {
          throw new Error(
            `Security identity conflict ${table}/${key}: ${change.oldTsCode} -> ${change.newTsCode}`,
          );
        }
        continue;
      }
      const evidence = await transaction.marketRecordEvidence.findUnique({
        where: { tableName_businessKey: { tableName: table, businessKey: rowKey(table, row) } },
      });
      const quality = evidence?.availabilityQuality;
      merged.set(key, {
        values,
        firstObservedAt: evidence?.firstObservedAt,
        publicationDate: evidence?.publicationDate,
        availableDate: evidence?.availableDate,
        availabilityQuality:
          quality === 'source_contract' || quality === 'captured' || quality === 'latest_only'
            ? quality
            : 'unknown',
      });
      const date = values.tradeDate ?? values.inDate;
      if (typeof date === 'string') {
        result.observedDates.push(date);
      }
    }
    result.tables.push({
      table,
      records: [...merged.values()],
      replacement: {
        authoritative: true,
        basis: 'Confirmed security succession with a conflict-free complete lineage',
        where: { [field]: { in: [change.oldTsCode, change.newTsCode] } },
      },
    });
  }

  return result;
}
