import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { addDays } from '#date';
import {
  ChinaBondPublicCurveClient,
  syncChinaBondCreditCurves,
} from '../rates/chinabond-credit-curves.js';
import { syncTradeCal } from '../calendar/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const [startDate = '20060101', endDate = shanghaiToday()] = args;
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
    .format(stagingNow())
    .replaceAll('-', '');
}
