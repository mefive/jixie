import { auditEtfResearchRegistry } from '../src/data-quality/etf-registry-audit.js';
import { prisma } from '../src/lib/prisma.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const positional = args.filter((argument) => !argument.startsWith('--'));
  if (
    positional.length > 2 ||
    args.some((argument) => argument.startsWith('--') && !['--json', '--strict'].includes(argument))
  ) {
    throw new Error(
      'Usage: pnpm audit:etf [expected-history-start] [coverage-through] [--json] [--strict]',
    );
  }
  const report = await auditEtfResearchRegistry(prisma, {
    expectedHistoryStart: positional[0],
    coverageThrough: positional[1],
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `ETF registry v${report.registryVersion}: ${report.exposures} exposures / ${report.products} products`,
    );
    console.log(
      `Expected coverage ${report.expectedHistoryStart}..${report.coverageThrough}; ${report.errors.length} errors / ${report.warnings.length} warnings`,
    );
    console.table(
      report.rows.map((row) => ({
        code: row.tsCode,
        role: row.membership.role,
        exposure: row.membership.exposureId,
        daily: `${row.dailyStartDate ?? '-'}..${row.dailyEndDate ?? '-'}`,
        adjustment: `${row.adjustmentStartDate ?? '-'}..${row.adjustmentEndDate ?? '-'}`,
        shareSize: `${row.shareSizeStartDate ?? '-'}..${row.shareSizeEndDate ?? '-'}`,
        medianAmount: row.trailingMedianAmount,
        latestSize: row.latestTotalSize,
      })),
    );
    for (const error of report.errors) {
      console.error(`ERROR: ${error}`);
    }
    for (const warning of report.warnings) {
      console.warn(`WARN: ${warning}`);
    }
  }
  if (strict && report.errors.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error('ETF registry audit failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
