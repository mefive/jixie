import { loadTushareConfig } from '../src/config.js';
import { addDays } from '../src/lib/date.js';
import { prisma } from '../src/lib/prisma.js';
import {
  ChinaBondPublicCurveClient,
  syncChinaBondCreditCurves,
} from '../src/rates/chinabond-credit-curves.js';
import { syncTradeCal } from '../src/store/sync.js';
import { TushareClient } from '../src/tushare/client.js';

async function main(): Promise<void> {
  const [startDate = '20060101', endDate = shanghaiToday()] = process.argv.slice(2);
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
  const config = loadTushareConfig();
  const tushare = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  await syncTradeCal(tushare, startDate, addDays(endDate, 14));
  const count = await syncChinaBondCreditCurves(
    new ChinaBondPublicCurveClient(),
    startDate,
    endDate,
  );
  console.log(`ChinaBond public credit curve sync complete: ${count} points`);
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replaceAll('-', '');
}

main()
  .catch((error: unknown) => {
    console.error(
      'ChinaBond public credit curve sync failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
