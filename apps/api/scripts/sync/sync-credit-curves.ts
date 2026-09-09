import { loadTushareConfig } from '../../src/market/providers/tushare/config.js';
import { addDays } from '../../src/date.js';
import { prisma } from '../../src/infra/database/prisma.js';
import {
  ChinaBondPublicCurveClient,
  syncChinaBondCreditCurves,
} from '../../src/market/rates/chinabond-credit-curves.js';
import { syncTradeCal } from '../../src/market/sync/calendar.js';
import { TushareClient } from '../../src/market/providers/tushare/client.js';

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
