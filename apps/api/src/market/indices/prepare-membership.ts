import { getDatabase } from '#infra/database/prisma.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { indexWeight, type IndexWeightRow } from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/tushare-client.js';
import { readDownloadCodes } from '../downloads/lists.js';
import { validateIndexWeightDate } from './daily-quality.js';

/**
 * 准备目标日期适用的月度快照；查询窗口不等于写入窗口，不批量回填前置历史。
 *
 * Prepare monthly snapshots for the requested dates without turning lookup history into a backfill.
 * Snapshot dates retain the existing as-of convention; they are not publication timestamps.
 */
export async function prepareIndexMembership(
  client: TushareClient,
  tradeDates: string[],
  maximumAgeDays: number,
): Promise<void> {
  const dates = [...new Set(tradeDates)].sort();
  if (!dates.length) {
    return;
  }
  const first = dates[0];
  const last = dates.at(-1)!;
  const oldest = shiftDays(first, -maximumAgeDays);

  for (const indexCode of (await readDownloadCodes('index')).filter(
    (code) => code !== 'H00300.CSI',
  )) {
    const existing = await getDatabase().indexWeight.findFirst({
      where: { indexCode, tradeDate: { lte: first } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    const snapshots = new Map<string, IndexWeightRow[]>();
    const readMonth = async (start: string, end: string) => {
      const rows = await indexWeight(client, {
        index_code: indexCode,
        start_date: start,
        end_date: end,
      });
      for (const row of rows) {
        if (row.index_code !== indexCode || !/^\d{8}$/.test(row.trade_date)) {
          throw new Error(`Invalid index membership response for ${indexCode}`);
        }
        // 范围接口多返回的记录不能改变候选写入范围，也不能用未来资料替代目标日。
        // Extra response rows cannot expand writes or substitute future snapshots for the target.
        if (row.trade_date < start || row.trade_date > end) {
          continue;
        }
        const snapshot = snapshots.get(row.trade_date) ?? [];
        snapshot.push(row);
        snapshots.set(row.trade_date, snapshot);
      }
    };

    for (let month = first.slice(0, 6) + '01'; month <= last; month = nextMonth(month)) {
      const end = shiftDays(nextMonth(month), -1);
      await readMonth(month, end < last ? end : last);
    }

    // 只为首个目标日寻找最近锚点；本地有效记录可复用，最多读取新鲜度允许的月份。
    // Find only the nearest anchor for the first target, reusing valid local history when possible.
    let anchor = [...snapshots.keys()]
      .filter((date) => date <= first)
      .sort()
      .at(-1);
    let before = shiftDays(first.slice(0, 6) + '01', -1);
    while ((!anchor || anchor < oldest) && before >= oldest) {
      if (existing && existing.tradeDate >= before && existing.tradeDate >= oldest) {
        break;
      }
      const month = before.slice(0, 6) + '01';
      await readMonth(month > oldest ? month : oldest, before);
      anchor = [...snapshots.keys()]
        .filter((date) => date <= first)
        .sort()
        .at(-1);
      before = shiftDays(month, -1);
    }
    const latest = [anchor, existing?.tradeDate]
      .filter((date): date is string => !!date)
      .sort()
      .at(-1);
    if (!latest || latest < oldest) {
      throw new Error(`IndexWeight has no fresh as-of snapshot for ${indexCode} by ${first}`);
    }

    for (const [date, rows] of snapshots) {
      if (date < first && date !== latest) {
        continue;
      }
      const members = new Set(rows.map((row) => canonicalStockCode(row.con_code)));
      const total = rows.reduce((sum, row) => sum + (row.weight ?? 0), 0);
      if (members.size !== rows.length || !Number.isFinite(total) || total < 95 || total > 105) {
        throw new Error(`Invalid or incomplete IndexWeight snapshot ${indexCode} ${date}`);
      }
      await getDatabase().$transaction([
        getDatabase().indexWeight.deleteMany({ where: { indexCode, tradeDate: date } }),
        getDatabase().indexWeight.createMany({
          data: rows.map((row) => ({
            indexCode,
            conCode: canonicalStockCode(row.con_code),
            tradeDate: row.trade_date,
            weight: row.weight,
          })),
        }),
      ]);
    }
  }

  for (const date of dates) {
    await validateIndexWeightDate(date, maximumAgeDays);
  }
}

function shiftDays(date: string, days: number): string {
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)) + days,
    ),
  );

  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

function nextMonth(date: string): string {
  const value = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)), 1));

  return value.toISOString().slice(0, 10).replaceAll('-', '');
}
