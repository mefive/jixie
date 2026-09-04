import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { probeCninfoFinancialCorrections } from './fundamentals/cninfo-announcement-probe.js';
import {
  probeFundamentalSources,
  type FundamentalSourceProbeOptions,
} from './fundamentals/source-probe.js';

function option(args: string[], name: string, fallback: string, pattern: RegExp): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : fallback;
  if (!value || !pattern.test(value)) {
    throw new Error(`${name} has an invalid value`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: FundamentalSourceProbeOptions = {
    tsCode: option(args, '--code', '000858.SZ', /^\d{6}\.(?:SH|SZ|BJ)$/),
    startDate: option(args, '--start', '20100101', /^\d{8}$/),
    period: option(args, '--period', '20231231', /^\d{8}$/),
  };
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const results = await probeFundamentalSources(client, options);
  const cninfo = await probeCninfoFinancialCorrections({
    tsCode: option(args, '--correction-code', '300266.SZ', /^\d{6}\.(?:SH|SZ|BJ)$/),
    startDate: option(args, '--correction-start', '20240101', /^\d{8}$/),
    endDate: option(args, '--correction-end', '20240110', /^\d{8}$/),
  });
  const summary = {
    probedAt: new Date().toISOString(),
    options,
    counts: Object.fromEntries(
      ['ok', 'empty', 'permission_denied', 'request_error', 'network_error'].map((status) => [
        status,
        results.filter((result) => result.status === status).length,
      ]),
    ),
    results,
    cninfo,
  };

  if (args.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Fundamental source probe · ${options.tsCode} · period ${options.period}`);
    console.table(
      results.map((result) => ({
        api: result.probeName,
        status: result.status,
        rows: result.rowCount,
        range:
          result.historyStart && result.historyEnd
            ? `${result.historyStart}–${result.historyEnd}`
            : '',
        duplicates: result.duplicateAnnouncementGroups ?? '',
        ambiguous: result.ambiguousSameDateVersionGroups ?? '',
        datedRevisions: result.datedRevisionGroups ?? '',
        pagination: result.pagination
          ? `${result.pagination.firstPageRows}+${result.pagination.secondPageRows}`
          : '',
        error: result.errorMessage ?? '',
      })),
    );
    console.log('CNInfo correction evidence:');
    console.table(
      cninfo.announcements.map((announcement) => ({
        id: announcement.sourceId,
        date: announcement.publishedDate,
        title: announcement.title,
        document: announcement.documentUrl,
      })),
    );
    if (cninfo.errorMessage) {
      console.log(`CNInfo probe: ${cninfo.errorMessage}`);
    }
  }

  if (results.some((result) => result.status === 'network_error')) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
