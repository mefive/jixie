import { prisma } from '#infra/database/prisma.js';
import {
  runDataQualityAudit,
  type DataQualityAuditOptions,
} from '#maintenance/publication/audit.js';
import type { AuditFinding } from '#market/quality/report.js';

/**
 * 保存审计日期、范围和输出选项，供 CLI 校验后执行。
 *
 * Carry audit dates, scope and output options from CLI parsing into execution.
 */
interface CliOptions extends DataQualityAuditOptions {
  json: boolean;
  strict: boolean;
}

/**
 * 组合审计参数、配置与业务执行，按发现设置 CLI 退出状态。
 *
 * Coordinate audit arguments, configuration and execution and set CLI status from findings.
 */
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

/**
 * 解析审计范围与输出选项，拒绝非法参数后再加载业务依赖。
 *
 * Parse audit scope and output options before loading business dependencies.
 */
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
      'Usage: pnpm data:audit data [start] [end] [--window=60] [--points=5] [--json] [--strict]',
    );
  }
  return options;
}

/**
 * 将审计发现与覆盖摘要输出到 CLI，保留失败和警告区分。
 *
 * Print audit findings and coverage summaries with distinct failures and warnings.
 */
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
