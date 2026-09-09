import { loadTushareConfig } from '../src/market/providers/tushare/config.js';
import { TushareClient } from '../src/market/providers/tushare/client.js';
import { probeMainBusinessSegments } from './fundamentals/main-business-probe.js';

async function main(): Promise<void> {
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const report = await probeMainBusinessSegments(client);

  console.log(JSON.stringify({ probedAt: new Date().toISOString(), ...report }, null, 2));
  // This observational probe cannot certify historical revision availability.
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
