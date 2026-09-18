import type { Prisma } from '#infra/database/prisma.js';
import { formatNumber, formatPercent, toNumber } from '../quality/format.js';
import type { AuditFinding, AuditStatus } from '../quality/report.js';

export interface FinancialPitRow {
  total: bigint | number;
  missingAnnouncementDate: bigint | number;
  announcementBeforePeriodEnd: bigint | number;
}

export interface FinancialStatementVersionAuditRow {
  total: bigint | number;
  invalidAnnouncementDate: bigint | number;
  invalidAvailableDate: bigint | number;
  invalidQuality: bigint | number;
  invalidReportScope: bigint | number;
}

export interface FinancialStatementReconciliationRow {
  indicatorPeriods: bigint | number;
  incomeMatches: bigint | number;
  balanceMatches: bigint | number;
  cashFlowMatches: bigint | number;
}

export interface FinancialAccountingIdentityAuditRow {
  comparable: bigint | number;
  mismatches: bigint | number;
  anomalies: bigint | number;
  reviewFlags?: bigint | number;
}

export interface FinancialMetricCoverageAuditRow {
  totalPeriods: bigint | number;
  completePeriods: bigint | number;
}

export async function auditFinancialPit(database: Prisma): Promise<AuditFinding> {
  const rows = await database.$queryRaw<FinancialPitRow[]>`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN annDate IS NULL THEN 1 ELSE 0 END) AS missingAnnouncementDate,
      SUM(CASE WHEN annDate < endDate THEN 1 ELSE 0 END) AS announcementBeforePeriodEnd
    FROM FinaIndicator
  `;
  const row = rows[0];
  const total = toNumber(row?.total);
  const missingAnnouncementDate = toNumber(row?.missingAnnouncementDate);
  const announcementBeforePeriodEnd = toNumber(row?.announcementBeforePeriodEnd);
  const status: AuditStatus =
    announcementBeforePeriodEnd > 0 ? 'error' : missingAnnouncementDate > 0 ? 'warn' : 'pass';

  return {
    id: 'financial-pit',
    title: 'Financial indicators: point-in-time gate',
    status,
    summary: `${missingAnnouncementDate} missing announcement dates; ${announcementBeforePeriodEnd} announcements before report-period end`,
    details: [
      `${formatNumber(total)} FinaIndicator rows checked.`,
      'The required invariant is annDate >= endDate; analysis must gate availability on annDate.',
    ],
  };
}

export async function auditFinancialStatementVersions(database: Prisma): Promise<AuditFinding> {
  const [versionRows, reconciliationRows] = await Promise.all([
    database.$queryRaw<FinancialStatementVersionAuditRow[]>`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN announcementDate < endDate THEN 1 ELSE 0 END) AS invalidAnnouncementDate,
        SUM(CASE WHEN availableDate <= announcementDate THEN 1 ELSE 0 END) AS invalidAvailableDate,
        SUM(CASE WHEN availabilityQuality NOT IN ('exact', 'conservative', 'reconstructed') THEN 1 ELSE 0 END) AS invalidQuality,
        SUM(CASE WHEN reportType NOT IN ('1', '4', '5') OR compType <> '1' THEN 1 ELSE 0 END) AS invalidReportScope
      FROM (
        SELECT endDate, announcementDate, availableDate, availabilityQuality, reportType, compType
        FROM FinancialIncomeStatement
        UNION ALL
        SELECT endDate, announcementDate, availableDate, availabilityQuality, reportType, compType
        FROM FinancialBalanceSheet
        UNION ALL
        SELECT endDate, announcementDate, availableDate, availabilityQuality, reportType, compType
        FROM FinancialCashFlowStatement
      )
    `,
    database.$queryRaw<FinancialStatementReconciliationRow[]>`
      SELECT
        COUNT(*) AS indicatorPeriods,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM FinancialIncomeStatement statement
          WHERE statement.tsCode = indicator.tsCode AND statement.endDate = indicator.endDate
        ) THEN 1 ELSE 0 END) AS incomeMatches,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM FinancialBalanceSheet statement
          WHERE statement.tsCode = indicator.tsCode AND statement.endDate = indicator.endDate
        ) THEN 1 ELSE 0 END) AS balanceMatches,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM FinancialCashFlowStatement statement
          WHERE statement.tsCode = indicator.tsCode AND statement.endDate = indicator.endDate
        ) THEN 1 ELSE 0 END) AS cashFlowMatches
      FROM FinaIndicator indicator
    `,
  ]);
  return summarizeFinancialStatementVersions(versionRows[0], reconciliationRows[0]);
}

export async function auditFinancialStatementAccounting(database: Prisma): Promise<AuditFinding> {
  const [balanceRows, cashRows, crossRows, coverageRows] = await Promise.all([
    database.$queryRaw<FinancialAccountingIdentityAuditRow[]>`
      SELECT
        SUM(CASE WHEN totalAssets IS NOT NULL AND totalLiab IS NOT NULL
          AND totalHldrEqyExcMinInt IS NOT NULL THEN 1 ELSE 0 END) AS comparable,
        SUM(CASE WHEN totalAssets IS NOT NULL AND totalLiab IS NOT NULL
          AND totalHldrEqyExcMinInt IS NOT NULL
          AND ABS(totalAssets - totalLiab - totalHldrEqyExcMinInt - COALESCE(minorityInt, 0))
            > MAX(1.0, ABS(totalAssets) * 0.000001) THEN 1 ELSE 0 END) AS mismatches,
        SUM(CASE WHEN totalAssets <= 0 OR totalShare <= 0 THEN 1 ELSE 0 END) AS anomalies,
        SUM(CASE WHEN totalLiab < 0 OR totalCurAssets > totalAssets
          OR totalCurLiab > totalLiab THEN 1 ELSE 0 END) AS reviewFlags
      FROM FinancialBalanceSheet
    `,
    database.$queryRaw<FinancialAccountingIdentityAuditRow[]>`
      SELECT
        SUM(CASE WHEN cCashEquBegPeriod IS NOT NULL AND nIncrCashCashEqu IS NOT NULL
          AND cCashEquEndPeriod IS NOT NULL THEN 1 ELSE 0 END) AS comparable,
        SUM(CASE WHEN cCashEquBegPeriod IS NOT NULL AND nIncrCashCashEqu IS NOT NULL
          AND cCashEquEndPeriod IS NOT NULL
          AND ABS(cCashEquBegPeriod + nIncrCashCashEqu - cCashEquEndPeriod)
            > MAX(1.0, ABS(cCashEquEndPeriod) * 0.000001) THEN 1 ELSE 0 END) AS mismatches,
        0 AS anomalies,
        SUM(CASE WHEN cPayAcqConstFiolta < 0 THEN 1 ELSE 0 END) AS reviewFlags
      FROM FinancialCashFlowStatement
    `,
    database.$queryRaw<FinancialAccountingIdentityAuditRow[]>`
      SELECT
        COUNT(*) AS comparable,
        SUM(CASE WHEN ABS(income.nIncome - cash.netProfit)
          > MAX(1.0, MAX(ABS(income.nIncome), ABS(cash.netProfit)) * 0.000001)
          THEN 1 ELSE 0 END) AS mismatches,
        0 AS anomalies
      FROM FinancialIncomeStatement income
      JOIN FinancialCashFlowStatement cash
        ON cash.tsCode = income.tsCode
        AND cash.endDate = income.endDate
        AND cash.reportType = income.reportType
        AND cash.availableDate = income.availableDate
      WHERE income.availabilityQuality <> 'reconstructed'
        AND cash.availabilityQuality <> 'reconstructed'
        AND income.nIncome IS NOT NULL
        AND cash.netProfit IS NOT NULL
    `,
    database.$queryRaw<FinancialMetricCoverageAuditRow[]>`
      WITH periods AS (
        SELECT tsCode, endDate FROM FinancialIncomeStatement
        WHERE availabilityQuality <> 'reconstructed'
        UNION
        SELECT tsCode, endDate FROM FinancialBalanceSheet
        WHERE availabilityQuality <> 'reconstructed'
        UNION
        SELECT tsCode, endDate FROM FinancialCashFlowStatement
        WHERE availabilityQuality <> 'reconstructed'
      )
      SELECT
        COUNT(*) AS totalPeriods,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM FinancialIncomeStatement income
          WHERE income.tsCode = periods.tsCode AND income.endDate = periods.endDate
            AND income.availabilityQuality <> 'reconstructed'
        ) AND EXISTS (
          SELECT 1 FROM FinancialBalanceSheet balance
          WHERE balance.tsCode = periods.tsCode AND balance.endDate = periods.endDate
            AND balance.availabilityQuality <> 'reconstructed'
        ) AND EXISTS (
          SELECT 1 FROM FinancialCashFlowStatement cash
          WHERE cash.tsCode = periods.tsCode AND cash.endDate = periods.endDate
            AND cash.availabilityQuality <> 'reconstructed'
        ) THEN 1 ELSE 0 END) AS completePeriods
      FROM periods
    `,
  ]);
  const finding = summarizeFinancialStatementAccounting(
    balanceRows[0],
    cashRows[0],
    crossRows[0],
    coverageRows[0],
  );
  if (toNumber(balanceRows[0]?.anomalies) > 0) {
    const examples = await database.financialBalanceSheet.findMany({
      where: { OR: [{ totalAssets: { lte: 0 } }, { totalShare: { lte: 0 } }] },
      select: {
        id: true,
        tsCode: true,
        endDate: true,
        availableDate: true,
        availabilityQuality: true,
        totalAssets: true,
        totalShare: true,
      },
      orderBy: [{ tsCode: 'asc' }, { endDate: 'asc' }, { availableDate: 'asc' }],
      take: 8,
    });
    finding.details.push(
      ...examples.map(
        (row) =>
          `Source review row ${row.id}: ${row.tsCode} period ${row.endDate}, available ${row.availableDate}, quality ${row.availabilityQuality}, assets ${row.totalAssets}, shares ${row.totalShare}.`,
      ),
    );
    finding.details.push(
      'Non-positive source values require review but do not block application publication. Selected-version accounting diagnostics and invalid-metric protections remain in effect.',
    );
  }
  return finding;
}

export function summarizeFinancialStatementVersions(
  versions: FinancialStatementVersionAuditRow | undefined,
  reconciliation: FinancialStatementReconciliationRow | undefined,
): AuditFinding {
  const total = toNumber(versions?.total);
  const invalidAnnouncementDate = toNumber(versions?.invalidAnnouncementDate);
  const invalidAvailableDate = toNumber(versions?.invalidAvailableDate);
  const invalidQuality = toNumber(versions?.invalidQuality);
  const invalidReportScope = toNumber(versions?.invalidReportScope);
  const invalidRows =
    invalidAnnouncementDate + invalidAvailableDate + invalidQuality + invalidReportScope;
  const indicatorPeriods = toNumber(reconciliation?.indicatorPeriods);
  const matches = {
    income: toNumber(reconciliation?.incomeMatches),
    balance: toNumber(reconciliation?.balanceMatches),
    cashFlow: toNumber(reconciliation?.cashFlowMatches),
  };
  const minimumCoverage =
    indicatorPeriods > 0
      ? Math.min(matches.income, matches.balance, matches.cashFlow) / indicatorPeriods
      : 1;
  const status: AuditStatus =
    invalidRows > 0 ? 'error' : total === 0 || minimumCoverage < 0.8 ? 'warn' : 'pass';

  return {
    id: 'financial-statement-versions',
    title: 'Financial statements: append-only PIT versions',
    status,
    summary: `${formatNumber(total)} statement versions; ${formatNumber(invalidRows)} invalid PIT or scope fields; minimum legacy-period coverage ${formatPercent(minimumCoverage)}`,
    details: [
      `Invalid fields: announcement=${invalidAnnouncementDate}, availability=${invalidAvailableDate}, quality=${invalidQuality}, scope=${invalidReportScope}.`,
      `FinaIndicator reconciliation (${formatNumber(indicatorPeriods)} periods): income=${formatNumber(matches.income)}, balance=${formatNumber(matches.balance)}, cash flow=${formatNumber(matches.cashFlow)}.`,
      'FinaIndicator remains a compatibility source; these coverage counts do not overwrite either data path.',
    ],
  };
}

export function summarizeFinancialStatementAccounting(
  balance: FinancialAccountingIdentityAuditRow | undefined,
  cash: FinancialAccountingIdentityAuditRow | undefined,
  crossStatement: FinancialAccountingIdentityAuditRow | undefined,
  coverage: FinancialMetricCoverageAuditRow | undefined,
): AuditFinding {
  const comparable =
    toNumber(balance?.comparable) +
    toNumber(cash?.comparable) +
    toNumber(crossStatement?.comparable);
  const mismatches =
    toNumber(balance?.mismatches) +
    toNumber(cash?.mismatches) +
    toNumber(crossStatement?.mismatches);
  const anomalies =
    toNumber(balance?.anomalies) + toNumber(cash?.anomalies) + toNumber(crossStatement?.anomalies);
  const reviewFlags = toNumber(balance?.reviewFlags) + toNumber(cash?.reviewFlags);
  const totalPeriods = toNumber(coverage?.totalPeriods);
  const completePeriods = toNumber(coverage?.completePeriods);
  const coverageRatio = totalPeriods > 0 ? completePeriods / totalPeriods : 0;
  const mismatchRatio = comparable > 0 ? mismatches / comparable : 0;
  const status: AuditStatus =
    anomalies > 0 ||
    reviewFlags > 0 ||
    totalPeriods === 0 ||
    coverageRatio < 0.8 ||
    mismatchRatio > 0.01
      ? 'warn'
      : 'pass';

  return {
    id: 'financial-statement-accounting',
    title: 'Financial statements: source-row accounting checks and table coverage',
    status,
    summary: `${formatNumber(anomalies)} non-positive asset/share records; ${formatNumber(mismatches)} of ${formatNumber(comparable)} comparable identities mismatch; ${formatPercent(coverageRatio)} three-statement coverage`,
    details: [
      `Balance identity: ${formatNumber(toNumber(balance?.mismatches))}/${formatNumber(toNumber(balance?.comparable))} mismatches.`,
      `Cash identity: ${formatNumber(toNumber(cash?.mismatches))}/${formatNumber(toNumber(cash?.comparable))} mismatches.`,
      `Cross-statement net income: ${formatNumber(toNumber(crossStatement?.mismatches))}/${formatNumber(toNumber(crossStatement?.comparable))} mismatches.`,
      `${formatNumber(anomalies)} non-positive asset/share records; ${formatNumber(reviewFlags)} sign/subtotal review flags (not confirmed source errors).`,
      `${formatNumber(completePeriods)}/${formatNumber(totalPeriods)} non-reconstructed company-periods have all three statements.`,
      'These are raw source rows and join pairs, including duplicate or superseded versions, not SDK-selected company-periods.',
      'Derived metrics still return explicit missing or invalid reasons when required quarters or fields are unavailable.',
    ],
  };
}
