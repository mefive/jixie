import { prisma } from '../lib/prisma.js';
import { enqueueSignalRun } from './service.js';
import { syncSignalMarketData } from './sync.js';

/** Run one complete daily cycle: synchronize data once, then compute active deployments serially. */
export async function runDailySignalCycle(
  tradeDate = shanghaiNow().date,
  onLog: (line: string) => void = console.log,
): Promise<{ deployments: number; done: number; errors: number }> {
  await syncSignalMarketData(tradeDate, onLog);
  return generateDailySignals(tradeDate, onLog);
}

/** Generate active-deployment signals from an already-published market-data cutoff. */
export async function generateDailySignals(
  tradeDate: string,
  onLog: (line: string) => void = console.log,
): Promise<{ deployments: number; done: number; errors: number }> {
  const open = await prisma.tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
    select: { isOpen: true },
  });
  if (!open || open.isOpen !== 1) {
    return { deployments: 0, done: 0, errors: 0 };
  }

  const deployments = await prisma.strategyDeployment.findMany({
    where: { status: 'active' },
    orderBy: { deployedAt: 'asc' },
    select: { id: true, userId: true, strategyName: true },
  });
  let done = 0;
  let errors = 0;
  for (const deployment of deployments) {
    onLog(`Generating ${deployment.strategyName} (${deployment.id})`);
    const result = await enqueueSignalRun(deployment.userId, deployment.id, tradeDate);
    if (result.kind !== 'ready') {
      errors++;
      onLog(`Skipped ${deployment.strategyName}: ${result.kind}`);
      continue;
    }
    const status = await result.run.completion;
    if (status === 'done') {
      done++;
    } else if (status === 'error') {
      errors++;
    }
  }
  return { deployments: deployments.length, done, errors };
}

function shanghaiNow(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${value.year}${value.month}${value.day}`,
    time: `${value.hour}:${value.minute}`,
  };
}
