import { prisma } from '#infra/database/prisma.js';

interface CoverageRow {
  daily: bigint | number;
  adjustmentMatches: bigint | number;
  basicMatches: bigint | number;
  limitMatches: bigint | number;
  moneyflowMatches: bigint | number;
  aliasedCodes: bigint | number;
}

export interface StockDateQuality {
  daily: number;
  adjustmentCoverage: number;
  basicCoverage: number;
  limitCoverage: number;
  moneyflowCoverage: number;
}

export async function validateStockDate(tradeDate: string): Promise<StockDateQuality> {
  const coverageRows = await prisma.$queryRaw<CoverageRow[]>`
      SELECT
        COUNT(*) AS daily,
        SUM(CASE WHEN a.tsCode IS NOT NULL THEN 1 ELSE 0 END) AS adjustmentMatches,
        SUM(CASE WHEN b.tsCode IS NOT NULL THEN 1 ELSE 0 END) AS basicMatches,
        SUM(CASE WHEN l.tsCode IS NOT NULL THEN 1 ELSE 0 END) AS limitMatches,
        SUM(CASE WHEN m.tsCode IS NOT NULL THEN 1 ELSE 0 END) AS moneyflowMatches,
        SUM(CASE WHEN c.oldTsCode IS NOT NULL THEN 1 ELSE 0 END) AS aliasedCodes
      FROM Daily d
      LEFT JOIN AdjFactor a ON a.tsCode = d.tsCode AND a.tradeDate = d.tradeDate
      LEFT JOIN DailyBasic b ON b.tsCode = d.tsCode AND b.tradeDate = d.tradeDate
      LEFT JOIN StkLimit l ON l.tsCode = d.tsCode AND l.tradeDate = d.tradeDate
      LEFT JOIN Moneyflow m ON m.tsCode = d.tsCode AND m.tradeDate = d.tradeDate
      LEFT JOIN StockCodeChange c ON c.oldTsCode = d.tsCode
      WHERE d.tradeDate = ${tradeDate}
    `;
  const coverage = coverageRows[0];
  const daily = toNumber(coverage?.daily);
  if (daily === 0) {
    throw new Error(`Daily is empty for ${tradeDate}`);
  }

  const adjustmentCoverage = toNumber(coverage.adjustmentMatches) / daily;
  const basicCoverage = toNumber(coverage.basicMatches) / daily;
  const limitCoverage = toNumber(coverage.limitMatches) / daily;
  const moneyflowCoverage = toNumber(coverage.moneyflowMatches) / daily;
  if (
    adjustmentCoverage < 0.98 ||
    basicCoverage < 0.85 ||
    limitCoverage < 0.85 ||
    moneyflowCoverage < 0.7
  ) {
    throw new Error(
      `Core coverage failed for ${tradeDate}: adjustment=${percent(adjustmentCoverage)}, basic=${percent(basicCoverage)}, limits=${percent(limitCoverage)}, moneyflow=${percent(moneyflowCoverage)}`,
    );
  }
  if (toNumber(coverage.aliasedCodes) > 0) {
    throw new Error(`Superseded stock codes remain in Daily for ${tradeDate}`);
  }

  return { daily, adjustmentCoverage, basicCoverage, limitCoverage, moneyflowCoverage };
}

function toNumber(value: bigint | number | undefined): number {
  return typeof value === 'bigint' ? Number(value) : (value ?? 0);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
