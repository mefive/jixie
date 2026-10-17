import { parentPort, workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();

const { StrategySimulation } = await import('../../execution/strategy-simulation.ts');
const { fixturePort } = await import('#backtesting/testing/fixture-port.js');

try {
  const simulation = await StrategySimulation.create({
    code: workerData.code,
    dataPort: fixturePort(workerData.spec),
  });
  try {
    const result = await simulation.run({
      start: workerData.spec.dates[0],
      end: workerData.spec.dates.at(-1),
      initialCash: 100_000,
    });
    parentPort.postMessage({ trades: result.trades, nav: result.nav });
  } finally {
    simulation.close();
  }
} catch (error) {
  parentPort.postMessage({
    error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
  });
}
