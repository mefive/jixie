import { fingerprint, hasValueConflict } from '../synchronization/rows.js';
import type { MarketRow } from '../synchronization/partition.js';

export const DIVIDEND_SOURCE_COLUMNS = {
  tsCode: 'ts_code',
  endDate: 'end_date',
  annDate: 'ann_date',
  exDate: 'ex_date',
  divProc: 'div_proc',
  cashDiv: 'cash_div',
  cashDivTax: 'cash_div_tax',
  baseDate: 'base_date',
  baseShare: 'base_share',
  stockDividend: 'stk_div',
  stockBonusRate: 'stk_bo_rate',
  stockCapitalizationRate: 'stk_co_rate',
  recordDate: 'record_date',
  payDate: 'pay_date',
  implementationAnnouncementDate: 'imp_ann_date',
  shareListingDate: 'div_listdate',
} as const;
export const DIVIDEND_SOURCE_FIELDS = Object.values(DIVIDEND_SOURCE_COLUMNS).join(',');

/**
 * 分配形态只区分同次响应中的现金、送转与混合记录，不冒充稳定方案编号。
 *
 * Distribution shape separates cash, shares and mixed source rows; it is not a stable plan ID.
 */
export function dividendDistributionKind(row: MarketRow): string {
  const cash = [row.cashDiv, row.cashDivTax];
  const shares = [row.stockDividend, row.stockBonusRate, row.stockCapitalizationRate];
  const positive = (values: MarketRow[string][]) =>
    values.some((value) => typeof value === 'number' && value > 0);
  const known = (values: MarketRow[string][]) => values.some((value) => typeof value === 'number');

  if (positive(cash) && positive(shares)) {
    return 'mixed';
  }
  if (positive(cash)) {
    return 'cash';
  }
  if (positive(shares)) {
    return 'shares';
  }

  return known(cash) && known(shares) ? 'none' : 'unspecified';
}

function announcementIdentity(row: MarketRow) {
  return {
    tsCode: row.tsCode,
    endDate: row.endDate,
    annDate: row.annDate ?? null,
    exDate: row.exDate ?? null,
    divProc: row.divProc ?? null,
  };
}

function compatibleLegacyValues(before: MarketRow, incoming: MarketRow) {
  const values = (row: MarketRow) => ({
    cashDiv: row.cashDiv,
    cashDivTax: row.cashDivTax,
    baseShare: row.baseShare,
  });

  return !hasValueConflict(values(before), values(incoming));
}

/**
 * 唯一可匹配时保留旧 ID；旧行可能对应多种形态时保留歧义，不猜方案。
 *
 * Preserve uniquely matched legacy IDs; never guess when a legacy row fits several shapes.
 */
export function dividendIdentityResolver(existing: MarketRow[], incoming: MarketRow[]) {
  const group = (rows: MarketRow[]) => {
    const grouped = new Map<string, MarketRow[]>();
    for (const row of rows) {
      const key = fingerprint(announcementIdentity(row));
      const values = grouped.get(key) ?? [];
      values.push(row);
      grouped.set(key, values);
    }

    return grouped;
  };
  const previousGroups = group(existing);
  const incomingGroups = group(incoming);

  return (row: MarketRow): MarketRow => {
    const identity = announcementIdentity(row);
    const key = fingerprint(identity);
    const previous = previousGroups.get(key) ?? [];
    const peers = incomingGroups.get(key) ?? [];
    let kind = String(row.distributionKind);
    const knownPrevious = previous.filter(
      (value) =>
        value.distributionKind && !['unspecified', 'none'].includes(String(value.distributionKind)),
    );
    if (kind === 'unspecified' || kind === 'none') {
      const knownKinds = new Set(knownPrevious.map((value) => value.distributionKind));
      if (knownKinds.size > 1) {
        throw new Error('Ambiguous dividend distribution shape with missing amounts');
      }
      if (knownKinds.size === 1) {
        kind = String(knownPrevious[0].distributionKind);
      }
    }
    const matched = knownPrevious.filter((value) => value.distributionKind === kind);
    const legacy = previous.filter(
      (value) =>
        !value.distributionKind || ['unspecified', 'none'].includes(String(value.distributionKind)),
    );
    for (const value of legacy) {
      const kinds = new Set(peers.map((peer) => peer.distributionKind));
      if (kinds.size > 1) {
        const compatible = new Set(
          peers
            .filter((peer) => compatibleLegacyValues(value, peer))
            .map((peer) => peer.distributionKind),
        );
        if (compatible.size !== 1) {
          throw new Error('Ambiguous legacy dividend distribution identity');
        }
        if (!compatible.has(kind)) {
          continue;
        }
      }
      matched.push(value);
    }
    if (matched.length > 1) {
      throw new Error('Multiple stored dividend rows match one distribution identity');
    }

    return {
      ...row,
      distributionKind: kind,
      id: matched[0]?.id ?? fingerprint({ ...identity, distributionKind: kind }),
    };
  };
}

/**
 * 恢复只复用实际取得完整分红字段的成功收据，旧字段批次补采一次。
 *
 * Resume only from receipts that actually requested the complete dividend fields.
 */
export function dividendReceiptHasCompleteFields(request: unknown): boolean {
  if (!Array.isArray(request)) {
    return false;
  }
  const requests = request.filter(
    (value): value is Record<string, unknown> =>
      value != null && typeof value === 'object' && value.api === 'dividend',
  );

  return (
    requests.length > 0 &&
    requests.every((value) => {
      const fields = typeof value.fields === 'string' ? value.fields.split(',') : [];

      return Object.values(DIVIDEND_SOURCE_COLUMNS).every((field) => fields.includes(field));
    })
  );
}
