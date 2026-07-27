import { prisma } from '../src/lib/prisma.js';
import {
  runDataQualityAudit,
  type AuditFinding,
  type DataQualityAuditOptions,
} from '../src/data-quality/audit.js';

interface CliOptions extends DataQualityAuditOptions {
  json: boolean;
  strict: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const report = await runDataQualityAudit(prisma, options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, Date.now() - startedAt);
  }

  if (options.strict && report.findings.some((finding) => finding.status === 'error')) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const dates = args.filter((arg) => !arg.startsWith('--'));
  const valueOf = (prefix: string) =>
    args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const windowValue = valueOf('--window=');
  const pointsValue = valueOf('--points=');
  const options: CliOptions = {
    startDate: dates[0],
    endDate: dates[1],
    windowTradingDays: windowValue == null ? undefined : Number(windowValue),
    evaluationPoints: pointsValue == null ? undefined : Number(pointsValue),
    json: args.includes('--json'),
    strict: args.includes('--strict'),
  };
  const knownFlags = new Set(['--json', '--strict']);
  const unknownFlags = args.filter(
    (arg) =>
      arg.startsWith('--') &&
      !knownFlags.has(arg) &&
      !arg.startsWith('--window=') &&
      !arg.startsWith('--points='),
  );
  if (unknownFlags.length > 0 || dates.length > 2) {
    throw new Error(
      'Usage: pnpm audit:data [start] [end] [--window=60] [--points=5] [--json] [--strict]',
    );
  }
  return options;
}

function printReport(
  report: Awaited<ReturnType<typeof runDataQualityAudit>>,
  elapsedMilliseconds: number,
): void {
  console.log('\nJixie data quality audit');
  console.log(
    `Scope: ${report.scope.startDate}..${report.scope.endDate} (${report.scope.openTradingDays} SSE open days)`,
  );
  console.log(
    `Generated: ${report.generatedAt}; elapsed ${(elapsedMilliseconds / 1000).toFixed(1)}s\n`,
  );

  for (const finding of report.findings) {
    printFinding(finding);
  }

  const counts = { pass: 0, warn: 0, error: 0 };
  for (const finding of report.findings) {
    counts[finding.status]++;
  }
  console.log(
    `Summary: ${counts.pass} pass, ${counts.warn} warning, ${counts.error} error-level finding${counts.error === 1 ? '' : 's'}.`,
  );
  console.log('Use --strict to return a non-zero exit code when error-level findings exist.');
}

function printFinding(finding: AuditFinding): void {
  console.log(`[${finding.status.toUpperCase()}] ${finding.title}`);
  console.log(`  ${finding.summary}`);
  for (const detail of finding.details) {
    console.log(`  - ${detail}`);
  }
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('\nData audit failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
