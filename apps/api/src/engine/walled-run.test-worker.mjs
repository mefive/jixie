import { parentPort, workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();

const { runWalledBacktest } = await import('./walled-run.ts');
const { fixturePort } = await import('./fixture-port.ts');

try {
  const result = await runWalledBacktest(
    {
      code: workerData.code,
      start: workerData.spec.dates[0],
      end: workerData.spec.dates.at(-1),
      initialCash: 100_000,
    },
    fixturePort(workerData.spec),
  );
  parentPort.postMessage({ trades: result.trades, nav: result.nav });
} catch (error) {
  parentPort.postMessage({
    error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
  });
}
