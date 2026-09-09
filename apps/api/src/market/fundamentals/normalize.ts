import type {
  FinancialDiagnostic,
  ResolvedCashFlowStatement,
  ResolvedIncomeStatement,
} from './resolver.js';

export const INCOME_FLOW_FIELDS = [
  'totalRevenue',
  'revenue',
  'operCost',
  'operateProfit',
  'totalProfit',
  'incomeTax',
  'nIncome',
  'nIncomeAttrP',
  'ebit',
  'rdExp',
  'finExpIntExp',
] as const;

export const CASH_FLOW_FIELDS = [
  'nCashflowAct',
  'cPayAcqConstFiolta',
  'nCashflowInvAct',
  'nCashFlowsFncAct',
  'cPayDistDpcpIntExp',
  'nIncrCashCashEqu',
  'netProfit',
  'deprFaCogaDpba',
  'amortIntangAssets',
  'freeCashflow',
] as const;

export type IncomeFlowField = (typeof INCOME_FLOW_FIELDS)[number];
export type CashFlowField = (typeof CASH_FLOW_FIELDS)[number];

export interface StandardizedFinancialValue {
  value: number | null;
  inputVersions: string[];
  missingReason?: string;
}

export interface StandardizedFinancialFlow<Field extends string> {
  endDate: string;
  fiscalQuarter: 1 | 2 | 3 | 4;
  values: Record<Field, StandardizedFinancialValue>;
}

export interface StandardizedFlowSeries<Field extends string> {
  quarterly: StandardizedFinancialFlow<Field>[];
  trailingTwelveMonths: StandardizedFinancialFlow<Field>[];
  diagnostics: FinancialDiagnostic[];
}

interface CumulativeFlowStatement<Field extends string> {
  statementKind: 'income' | 'cash_flow';
  endDate: string;
  sourceRowFingerprint: string;
  values: Record<Field, number | null>;
}

/** Convert calendar-year YTD statement flows into single quarters and rolling four-quarter sums. */
export function normalizeIncomeFlows(
  rows: readonly ResolvedIncomeStatement[],
): StandardizedFlowSeries<IncomeFlowField> {
  return normalizeCumulativeFlows(rows, INCOME_FLOW_FIELDS);
}

/** Beginning/end cash stocks are intentionally excluded because they must not be differenced. */
export function normalizeCashFlows(
  rows: readonly ResolvedCashFlowStatement[],
): StandardizedFlowSeries<CashFlowField> {
  return normalizeCumulativeFlows(rows, CASH_FLOW_FIELDS);
}

export function normalizeCumulativeFlows<Field extends string>(
  rows: readonly CumulativeFlowStatement<Field>[],
  fields: readonly Field[],
): StandardizedFlowSeries<Field> {
  const diagnostics: FinancialDiagnostic[] = [];
  const rowsByPeriod = new Map(rows.map((row) => [row.endDate, row]));
  const quarterly: StandardizedFinancialFlow<Field>[] = [];

  for (const row of [...rows].sort((left, right) => left.endDate.localeCompare(right.endDate))) {
    const fiscalQuarter = calendarQuarter(row.endDate);
    if (!fiscalQuarter) {
      diagnostics.push({
        code: 'non_standard_report_period',
        severity: 'error',
        message: 'V1 only normalizes calendar quarter-end statements.',
        endDate: row.endDate,
        statementKind: row.statementKind,
      });
      continue;
    }

    const previous = fiscalQuarter === 1 ? null : rowsByPeriod.get(previousQuarterEnd(row.endDate));
    const values = Object.fromEntries(
      fields.map((field) => [field, singleQuarterValue(row, previous, field, fiscalQuarter)]),
    ) as Record<Field, StandardizedFinancialValue>;
    if (fiscalQuarter > 1 && !previous) {
      diagnostics.push({
        code: 'missing_previous_cumulative_period',
        severity: 'warning',
        message: `Cannot derive Q${fiscalQuarter} without the preceding YTD statement.`,
        endDate: row.endDate,
        statementKind: row.statementKind,
      });
    }
    quarterly.push({ endDate: row.endDate, fiscalQuarter, values });
  }

  return {
    quarterly,
    trailingTwelveMonths: trailingTwelveMonths(quarterly, rowsByPeriod, fields, diagnostics),
    diagnostics,
  };
}

export function previousQuarterEnd(endDate: string): string {
  const quarter = calendarQuarter(endDate);
  if (!quarter) {
    throw new Error(`Unsupported non-quarter financial period: ${endDate}`);
  }
  const year = Number(endDate.slice(0, 4));
  const previousYear = String(year - 1).padStart(4, '0');
  switch (quarter) {
    case 1:
      return `${previousYear}1231`;
    case 2:
      return `${endDate.slice(0, 4)}0331`;
    case 3:
      return `${endDate.slice(0, 4)}0630`;
    case 4:
      return `${endDate.slice(0, 4)}0930`;
  }
}

export function previousYearPeriod(endDate: string, years = 1): string {
  if (!calendarQuarter(endDate) || !Number.isInteger(years) || years < 1) {
    throw new Error(`Cannot offset financial period ${endDate} by ${years} year(s)`);
  }
  return `${String(Number(endDate.slice(0, 4)) - years).padStart(4, '0')}${endDate.slice(4)}`;
}

export function isStandardFinancialPeriod(endDate: string): boolean {
  return calendarQuarter(endDate) !== null;
}

function singleQuarterValue<Field extends string>(
  current: CumulativeFlowStatement<Field>,
  previous: CumulativeFlowStatement<Field> | undefined | null,
  field: Field,
  fiscalQuarter: 1 | 2 | 3 | 4,
): StandardizedFinancialValue {
  const currentValue = current.values[field];
  if (currentValue == null) {
    return {
      value: null,
      inputVersions: [current.sourceRowFingerprint],
      missingReason: 'missing_current_cumulative_value',
    };
  }
  if (fiscalQuarter === 1) {
    return { value: currentValue, inputVersions: [current.sourceRowFingerprint] };
  }
  if (!previous) {
    return {
      value: null,
      inputVersions: [current.sourceRowFingerprint],
      missingReason: 'missing_previous_cumulative_period',
    };
  }
  const previousValue = previous.values[field];
  if (previousValue == null) {
    return {
      value: null,
      inputVersions: sortedUnique([current.sourceRowFingerprint, previous.sourceRowFingerprint]),
      missingReason: 'missing_previous_cumulative_value',
    };
  }
  return {
    value: currentValue - previousValue,
    inputVersions: sortedUnique([current.sourceRowFingerprint, previous.sourceRowFingerprint]),
  };
}

function trailingTwelveMonths<Field extends string>(
  quarterly: readonly StandardizedFinancialFlow<Field>[],
  cumulativeByPeriod: ReadonlyMap<string, CumulativeFlowStatement<Field>>,
  fields: readonly Field[],
  diagnostics: FinancialDiagnostic[],
): StandardizedFinancialFlow<Field>[] {
  const byPeriod = new Map(quarterly.map((row) => [row.endDate, row]));
  return quarterly.map((current) => {
    if (current.fiscalQuarter === 4) {
      const annual = cumulativeByPeriod.get(current.endDate)!;
      const values = Object.fromEntries(
        fields.map((field) => [
          field,
          annual.values[field] == null
            ? {
                value: null,
                inputVersions: [annual.sourceRowFingerprint],
                missingReason: 'missing_current_cumulative_value',
              }
            : {
                value: annual.values[field],
                inputVersions: [annual.sourceRowFingerprint],
              },
        ]),
      ) as Record<Field, StandardizedFinancialValue>;
      return { endDate: current.endDate, fiscalQuarter: current.fiscalQuarter, values };
    }

    const expectedDates = [current.endDate];
    for (let count = 1; count < 4; count++) {
      expectedDates.push(previousQuarterEnd(expectedDates.at(-1)!));
    }
    const quarters = expectedDates.map((date) => byPeriod.get(date));
    const missingDates = expectedDates.filter((_date, index) => quarters[index] == null);
    if (missingDates.length > 0) {
      diagnostics.push({
        code: 'incomplete_trailing_twelve_months',
        severity: 'warning',
        message: `TTM requires four continuous quarters; missing ${missingDates.join(', ')}.`,
        endDate: current.endDate,
      });
    }
    const values = Object.fromEntries(
      fields.map((field) => {
        if (missingDates.length > 0) {
          return [
            field,
            {
              value: null,
              inputVersions: inputVersions(quarters, field),
              missingReason: 'incomplete_trailing_twelve_months',
            },
          ];
        }
        const fieldValues = quarters.map((quarter) => quarter!.values[field]);
        const missingValue = fieldValues.find((value) => value.value == null);
        return [
          field,
          missingValue
            ? {
                value: null,
                inputVersions: sortedUnique(fieldValues.flatMap((value) => value.inputVersions)),
                missingReason: missingValue.missingReason ?? 'missing_quarter_value',
              }
            : {
                value: fieldValues.reduce((sum, value) => sum + value.value!, 0),
                inputVersions: sortedUnique(fieldValues.flatMap((value) => value.inputVersions)),
              },
        ];
      }),
    ) as Record<Field, StandardizedFinancialValue>;
    return { endDate: current.endDate, fiscalQuarter: current.fiscalQuarter, values };
  });
}

function inputVersions<Field extends string>(
  quarters: Array<StandardizedFinancialFlow<Field> | undefined>,
  field: Field,
): string[] {
  return sortedUnique(
    quarters.flatMap((quarter) => (quarter ? quarter.values[field].inputVersions : [])),
  );
}

function calendarQuarter(endDate: string): 1 | 2 | 3 | 4 | null {
  const suffix = endDate.slice(4);
  switch (suffix) {
    case '0331':
      return 1;
    case '0630':
      return 2;
    case '0930':
      return 3;
    case '1231':
      return 4;
    default:
      return null;
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
