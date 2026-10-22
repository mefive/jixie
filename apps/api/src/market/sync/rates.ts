import { stagingNow } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import {
  MinistryOfFinanceCurveClient,
  syncChinaTreasuryYieldCurve,
} from '../rates/china-treasury-curve.js';
import { syncTradeCal } from '../calendar/sync.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';

function currentDate(): string {
  return stagingNow().toISOString().slice(0, 10).replaceAll('-', '');
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)) + days,
    ),
  );
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * 同步财政部官方中国国债收益率曲线。
 *
 * Sync the official Ministry of Finance China government-bond yield curve.
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const [startDate = '20060301', endDate = currentDate()] = args;
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
  const config = loadTushareConfig();
  const tushare = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  await syncTradeCal(tushare, startDate, addCalendarDays(endDate, 14));
  const count = await syncChinaTreasuryYieldCurve(
    new MinistryOfFinanceCurveClient(),
    startDate,
    endDate,
  );
  console.log(`China treasury curve sync complete: ${count} points`);
}
