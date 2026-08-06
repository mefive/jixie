import { loadTushareConfig } from '../src/config.js';
import {
  probeAssetAllocationData,
  type AssetAllocationProbeResult,
} from '../src/tushare/asset-allocation-probe.js';
import { TushareClient } from '../src/tushare/client.js';

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
  const date = probeDate(process.argv.slice(2));
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const results = await probeAssetAllocationData(client, date);
  const summary = {
    probedAt: new Date().toISOString(),
    probeDate: date,
    counts: Object.fromEntries(
      ['ok', 'empty', 'permission_denied', 'request_error', 'network_error'].map((status) => [
        status,
        results.filter((result) => result.status === status).length,
      ]),
    ),
    results,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Tushare asset-allocation capability probe · sample date ${date}`);
    console.table(displayRows(results));
    console.log('Summary:', summary.counts);
  }

  if (results.some((result) => result.status === 'network_error')) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
