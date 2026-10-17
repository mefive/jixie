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

/**
 * 保存标准化财务值与可追溯诊断。
 *
 * Retain a standardized financial value and provenance diagnostics.
 */
export interface StandardizedFinancialValue {
  value: number | null;
  inputVersions: string[];
  missingReason?: string;
}

/**
 * 区分累计、单季和 TTM 财务流量值。
 *
 * Describe standardized cumulative, quarterly and TTM flows.
 */
export interface StandardizedFinancialFlow<Field extends string> {
  endDate: string;
  fiscalQuarter: 1 | 2 | 3 | 4;
  values: Record<Field, StandardizedFinancialValue>;
}

/**
 * 按报告期组织标准化流量，供指标按窗口读取。
 *
 * Organize standardized flows by reporting period for metric windows.
 */
export interface StandardizedFlowSeries<Field extends string> {
  quarterly: StandardizedFinancialFlow<Field>[];
  trailingTwelveMonths: StandardizedFinancialFlow<Field>[];
  diagnostics: FinancialDiagnostic[];
}

/**
 * 提供年度累计流量及版本身份，供单季差分。
 *
 * Supply year-to-date flows and version identity for quarterly differencing.
 */
interface CumulativeFlowStatement<Field extends string> {
  statementKind: 'income' | 'cash_flow';
  endDate: string;
  sourceRowFingerprint: string;
  values: Record<Field, number | null>;
}

/**
 * 将自然年度累计利润表流量标准化为单季与滚动四季口径。
 *
 * Convert calendar-year YTD statement flows into single quarters and rolling four-quarter sums.
 */
export function normalizeIncomeFlows(
  rows: readonly ResolvedIncomeStatement[],
): StandardizedFlowSeries<IncomeFlowField> {
  return normalizeCumulativeFlows(rows, INCOME_FLOW_FIELDS);
}

/**
 * 标准化现金流量表流量，期初和期末现金存量不参与差分。
 *
 * Beginning/end cash stocks are intentionally excluded because they must not be differenced.
 */
export function normalizeCashFlows(
  rows: readonly ResolvedCashFlowStatement[],
): StandardizedFlowSeries<CashFlowField> {
  return normalizeCumulativeFlows(rows, CASH_FLOW_FIELDS);
}

/**
 * 按年度累计语义派生单季及 TTM 流量，并传播缺失与版本诊断。
 *
 * Derive quarterly and TTM flows from year-to-date statements while propagating missing-data and version diagnostics.
 */
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

/**
 * 解析前一自然季度末，供累计流量差分对齐。
 *
 * Resolve the prior calendar quarter end for cumulative-flow differencing.
 */
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

/**
 * 以同年相邻累计值相减计算单季流量，缺少必要前值时保留缺失。
 *
 * Derive a single-quarter flow from same-year cumulative values, preserving missing prerequisites.
 */
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

/**
 * 汇总连续四季度流量形成 TTM，不能用不完整季度凑值。
 *
 * Combine four consecutive quarterly flows into TTM while preserving incomplete windows.
 */
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

/**
 * 将报告期转换为自然季度身份，供流量标准化排序。
 *
 * Map a reporting date to its calendar quarter for flow normalization.
 */
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
