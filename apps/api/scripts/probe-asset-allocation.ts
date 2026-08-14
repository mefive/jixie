import { loadTushareConfig } from '../src/config.js';
import {
  probeAssetAllocationData,
  type AssetAllocationProbeResult,
} from '../src/tushare/asset-allocation-probe.js';
import { TushareClient } from '../src/tushare/client.js';
import {
  persistTushareCapabilityProbes,
  tushareCapabilityProbesAreFresh,
} from '../src/tushare/capability-probe-store.js';
import { TUSHARE_CAPABILITIES } from '../src/tushare/capability-catalog.js';

function probeDate(args: string[]): string {
  const index = args.indexOf('--date');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value && /^\d{8}$/.test(value)) {
    return value;
  }
  if (value) {
    throw new Error('--date must use YYYYMMDD');
  }
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function maxAgeDays(args: string[]): number {
  const index = args.indexOf('--max-age-days');
  const value = index >= 0 ? Number(args[index + 1]) : 7;
  if (!Number.isInteger(value) || value < 1 || value > 365) {
    throw new Error('--max-age-days must be an integer between 1 and 365');
  }
  return value;
}

function displayRows(results: AssetAllocationProbeResult[]) {
  return results.map((result) => ({
    domain: result.domain,
    api: result.apiName,
    status: result.status,
    rows: result.rowCount,
    fields: result.fields.join(', '),
    error: result.errorMessage ?? '',
  }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = probeDate(args);
  if (
    args.includes('--persist-if-stale') &&
    (await tushareCapabilityProbesAreFresh(
      TUSHARE_CAPABILITIES.map((capability) => capability.apiName),
      maxAgeDays(args),
    ))
  ) {
    console.log('Tushare capability observations are fresh; probe skipped.');
    return;
  }
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const results = await probeAssetAllocationData(client, date);
  const probedAt = new Date();
  const persisted =
    args.includes('--persist') || args.includes('--persist-if-stale')
      ? await persistTushareCapabilityProbes(results, date, probedAt)
      : 0;
  const summary = {
    probedAt: probedAt.toISOString(),
    probeDate: date,
    catalogVersion: results[0]?.catalogVersion ?? null,
    persisted,
    counts: Object.fromEntries(
      ['ok', 'empty', 'permission_denied', 'request_error', 'network_error'].map((status) => [
        status,
        results.filter((result) => result.status === status).length,
      ]),
    ),
    results,
  };

  if (args.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Tushare asset-allocation capability probe · sample date ${date}`);
    console.table(displayRows(results));
    console.log('Summary:', summary.counts);
    if (persisted > 0) {
      console.log(`Persisted ${persisted} capability observations.`);
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
