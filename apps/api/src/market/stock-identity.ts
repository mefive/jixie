export interface StockCodeChangeDefinition {
  oldTsCode: string;
  newTsCode: string;
  effectiveDate: string;
  source: string;
}

/** Exchange-confirmed code successions whose old identifiers still existed in the local history. */
export const STOCK_CODE_CHANGES: readonly StockCodeChangeDefinition[] = [
  {
    oldTsCode: '000022.SZ',
    newTsCode: '001872.SZ',
    effectiveDate: '20181226',
    source: 'Shenzhen Stock Exchange issuer announcement, 2018-12',
  },
  {
    oldTsCode: '000043.SZ',
    newTsCode: '001914.SZ',
    effectiveDate: '20191216',
    source: 'Shenzhen Stock Exchange notice, 2019-12-11',
  },
  {
    oldTsCode: '300114.SZ',
    newTsCode: '302132.SZ',
    effectiveDate: '20250217',
    source: 'Shenzhen Stock Exchange issuer announcement 2025-028',
  },
] as const;

const CODE_CHANGE_BY_OLD = new Map(STOCK_CODE_CHANGES.map((change) => [change.oldTsCode, change]));

/** Resolve a historical alias to the current provider identity. Supports future chained changes. */
export function canonicalStockCode(tsCode: string): string {
  const visited = new Set<string>();
  let current = tsCode;

  while (!visited.has(current)) {
    visited.add(current);
    const next = CODE_CHANGE_BY_OLD.get(current)?.newTsCode;
    if (!next) {
      return current;
    }
    current = next;
  }

  throw new Error(`Cyclic stock-code succession detected at ${current}`);
}

export interface StockNameSpell {
  tsCode: string;
  name: string;
  startDate: string;
  endDate: string | null;
}

export interface HistoricalStockStatus {
  name: string | null;
  riskWarning: boolean;
  pendingDelisting: boolean;
}

function previousCalendarDate(date: string): string {
  const parsed = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))),
  );
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * Repair upstream duplicate/overlapping spells without inventing coverage for genuine gaps.
 * When overlapping rows repeat the same name, the later effective-date row is authoritative.
 */
export function normalizeStockNameSpells<Spell extends StockNameSpell>(spells: Spell[]): Spell[] {
  const unique = new Map<string, Spell>();
  for (const spell of spells) {
    const canonical = { ...spell, tsCode: canonicalStockCode(spell.tsCode) };
    unique.set(`${canonical.tsCode}|${canonical.startDate}`, canonical);
  }

  const byCode = new Map<string, Spell[]>();
  for (const spell of unique.values()) {
    const existing = byCode.get(spell.tsCode);
    if (existing) {
      existing.push(spell);
    } else {
      byCode.set(spell.tsCode, [spell]);
    }
  }

  const normalized: Spell[] = [];
  for (const codeSpells of byCode.values()) {
    codeSpells.sort((left, right) => left.startDate.localeCompare(right.startDate));
    const retained: Spell[] = [];
    for (let index = codeSpells.length - 1; index >= 0; index--) {
      const spell = codeSpells[index];
      const later = retained[0];
      const isRedundantOverlap =
        later != null &&
        spell.name === later.name &&
        (spell.endDate === null || spell.endDate >= later.startDate);
      if (!isRedundantOverlap) {
        retained.unshift(spell);
      }
    }

    normalized.push(
      ...retained.map((spell, index) => {
        const later = retained[index + 1];
        if (later && (spell.endDate === null || spell.endDate >= later.startDate)) {
          return { ...spell, endDate: previousCalendarDate(later.startDate) };
        }
        return spell;
      }),
    );
  }
  return normalized;
}

const RISK_WARNING_PREFIX = /^(?:S\*ST|SST|\*ST|ST|PT)/i;
const DELISTING_PERIOD_NAME = /(?:退$|^退市)/;

/** Classify exchange risk markers from the point-in-time security name. */
export function classifyStockName(name: string | null): HistoricalStockStatus {
  return {
    name,
    riskWarning: name != null && RISK_WARNING_PREFIX.test(name),
    pendingDelisting: name != null && DELISTING_PERIOD_NAME.test(name),
  };
}

/** Tiny in-memory PIT index over name spells; one instance is shared for a complete analysis/run. */
export class StockNameLookup {
  private readonly spellsByCode = new Map<string, StockNameSpell[]>();

  public constructor(spells: StockNameSpell[]) {
    for (const spell of normalizeStockNameSpells(spells)) {
      const code = spell.tsCode;
      const existing = this.spellsByCode.get(code);
      if (existing) {
        existing.push(spell);
      } else {
        this.spellsByCode.set(code, [spell]);
      }
    }

    for (const codeSpells of this.spellsByCode.values()) {
      codeSpells.sort((earlier, later) => earlier.startDate.localeCompare(later.startDate));
    }
  }

  public at(tsCode: string, date: string): HistoricalStockStatus {
    const spells = this.spellsByCode.get(canonicalStockCode(tsCode));
    if (!spells) {
      return classifyStockName(null);
    }

    let lower = 0;
    let upper = spells.length - 1;
    let match: StockNameSpell | null = null;
    while (lower <= upper) {
      const middle = (lower + upper) >> 1;
      const candidate = spells[middle];
      if (candidate.startDate <= date) {
        match = candidate;
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }

    if (!match || (match.endDate != null && date > match.endDate)) {
      return classifyStockName(null);
    }
    return classifyStockName(match.name);
  }
}
