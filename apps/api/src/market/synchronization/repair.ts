import { z } from 'zod';
import { MarketError } from '../errors.js';
import {
  dividendDistributionKind,
  dividendIdentityResolver,
} from '../fundamentals/dividend-identity.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import type { MarketTransaction } from './partition.js';
import { fingerprint } from './rows.js';
import {
  dividendRepairKey,
  dividendRepairValues,
  stockPriceRepairKey,
  stockPriceRepairValues,
  type MarketRepairInput,
  type RepairMarketDataset,
} from './repair-schema.js';

function selectFields<Fields extends string>(
  row: Record<string, unknown>,
  fields: readonly Fields[],
) {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

/** 仅映射修复契约中的业务字段。 / Project only fields declared by the repair contract. */
export function marketRepairRecord(dataset: RepairMarketDataset, row: Record<string, unknown>) {
  const [keySchema, valuesSchema] =
    dataset === 'stock-prices'
      ? [stockPriceRepairKey, stockPriceRepairValues]
      : [dividendRepairKey, dividendRepairValues];
  const key = keySchema.safeParse(selectFields(row, Object.keys(keySchema.shape)));
  const values = valuesSchema.safeParse(selectFields(row, Object.keys(valuesSchema.shape)));
  // 旧数据可能未通过新写入约束，仍可展示和用版本锁定。 / Legacy values remain visible and versioned.
  const visibleValues = values.success
    ? values.data
    : selectFields(row, Object.keys(valuesSchema.shape));
  if (!key.success) {
    return { key: null, values: visibleValues, expectedVersion: null };
  }

  return { key: key.data, values: visibleValues, expectedVersion: fingerprint(row) };
}

function validatePrices(row: Record<string, unknown>, checkChange: boolean) {
  const values = stockPriceRepairValues.parse(row);
  if (
    values.low > Math.min(values.open, values.close) ||
    values.high < Math.max(values.open, values.close)
  ) {
    throw new MarketError('repair_price_range');
  }
  if (checkChange && values.preClose !== null && values.pctChg !== null) {
    const change = (values.close / values.preClose - 1) * 100;
    if (Math.abs(change - values.pctChg) > 0.011) {
      throw new Error('The corrected close, preClose and pctChg disagree.');
    }
  }
}

function validateDividend(
  key: z.output<typeof dividendRepairKey>,
  values: z.output<typeof dividendRepairValues>,
) {
  if (dividendDistributionKind(values) !== key.distributionKind) {
    throw new Error('The dividend values do not match the declared distribution kind.');
  }
  if (key.divProc === '实施' && (!key.exDate || key.exDate < key.annDate)) {
    throw new MarketError('repair_dividend_dates');
  }
  if (key.divProc !== '实施' && key.exDate) {
    throw new MarketError('repair_dividend_dates');
  }
  if (
    key.annDate < key.endDate ||
    (values.recordDate && key.exDate && values.recordDate >= key.exDate)
  ) {
    throw new MarketError('repair_dividend_dates');
  }
  if (
    values.stockDividend !== null &&
    values.stockBonusRate !== null &&
    values.stockCapitalizationRate !== null &&
    Math.abs(values.stockDividend - values.stockBonusRate - values.stockCapitalizationRate) > 1e-8
  ) {
    throw new MarketError('repair_dividend_ratio');
  }
}

function checkTarget(request: MarketRepairInput, row: Record<string, unknown> | null) {
  if (
    request.op === 'insert' ? row !== null : !row || fingerprint(row) !== request.expectedVersion
  ) {
    throw new Error(
      'The target differs from the expected record version or absence. Export again.',
    );
  }
}

const emptyPrices = { preClose: null, pctChg: null, vol: null, amount: null };
const emptyDividendValues = {
  cashDiv: null,
  cashDivTax: null,
  baseDate: null,
  baseShare: null,
  stockDividend: null,
  stockBonusRate: null,
  stockCapitalizationRate: null,
  recordDate: null,
  payDate: null,
  implementationAnnouncementDate: null,
  shareListingDate: null,
};

/** 预备精确写入与可审阅前后值。 / Prepare an exact mutation and its reviewable before/after values. */
export async function prepareMarketRepair(database: MarketTransaction, request: MarketRepairInput) {
  const { dataset, key, op } = request;
  if (canonicalStockCode(key.tsCode) !== key.tsCode) {
    throw new MarketError('repair_security');
  }

  if (dataset === 'stock-prices') {
    const where = { tsCode_tradeDate: key };
    const before = await database.daily.findUnique({ where });
    checkTarget(request, before);
    const previous = before ? marketRepairRecord(dataset, before).values : null;
    const after = op === 'delete' ? null : { ...emptyPrices, ...previous, ...request.values };
    if (after) {
      const checkChange =
        op === 'insert' ||
        (op === 'update' &&
          ['close', 'preClose', 'pctChg'].some((field) => Object.hasOwn(request.values, field)));
      validatePrices(after, checkChange);
    }
    if (
      op === 'insert' &&
      !(await database.stockBasic.findUnique({ where: { tsCode: key.tsCode } }))
    ) {
      throw new MarketError('repair_security');
    }

    return {
      dataset,
      table: 'Daily',
      key,
      before: previous,
      after,
      apply: async () => {
        switch (op) {
          case 'insert':
            await database.daily.create({
              data: { ...key, ...request.values, sourceTsCode: key.tsCode },
            });
            break;
          case 'update':
            await database.daily.update({ where, data: request.values });
            break;
          case 'delete':
            await database.daily.delete({ where });
            break;
        }
      },
    };
  }

  const candidates = await database.dividend.findMany({ where: key, take: 2 });
  if (candidates.length > 1) {
    throw new MarketError('repair_dividend_identity');
  }
  const before = candidates[0] ?? null;
  checkTarget(request, before);
  const previous = before ? marketRepairRecord(dataset, before).values : null;
  const after = op === 'delete' ? null : { ...emptyDividendValues, ...previous, ...request.values };
  if (after) {
    validateDividend(key, dividendRepairValues.parse(after));
  }
  let insertId: string | undefined;
  if (op === 'insert') {
    const existing = await database.dividend.findMany({
      where: { tsCode: key.tsCode, endDate: key.endDate },
    });
    if (!(await database.stockBasic.findUnique({ where: { tsCode: key.tsCode } }))) {
      throw new MarketError('repair_security');
    }
    const row = { ...key, ...request.values };
    const identity = dividendIdentityResolver(existing, [row])(row);
    if (
      identity.distributionKind !== key.distributionKind ||
      typeof identity.id !== 'string' ||
      existing.some((candidate) => candidate.id === identity.id)
    ) {
      throw new MarketError('repair_dividend_identity');
    }
    insertId = identity.id;
  }

  return {
    dataset,
    table: 'Dividend',
    key,
    before: previous,
    after,
    apply: async () => {
      switch (op) {
        case 'insert':
          await database.dividend.create({
            data: {
              ...key,
              ...request.values,
              id: insertId!,
              sourceTsCode: key.tsCode,
              observedAt: new Date(),
              availabilityQuality: 'latest_only',
            },
          });
          break;
        case 'update':
          await database.dividend.update({
            where: { id: before!.id },
            data: { ...request.values, observedAt: new Date(), availabilityQuality: 'latest_only' },
          });
          break;
        case 'delete':
          await database.dividend.delete({ where: { id: before!.id } });
          break;
      }
    },
  };
}
