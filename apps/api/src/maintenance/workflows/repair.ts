import { getStagingContext } from '#infra/coordination/staging-input.js';
import { getDatabase } from '#infra/database/prisma.js';
import { syncTradeCal } from '#market/calendar/sync.js';
import {
  maintainCommodityWarehouseReceipts,
  type CommodityWarehouseReceiptMaintenanceSummary,
} from '#market/commodity/commodity-warehouse-receipt-maintenance.js';
import { TushareClient } from '#market/providers/tushare/tushare-client.js';
import { loadTushareConfig } from '#market/providers/tushare/config.js';
import type { TradeDate } from '@jixie/shared';
import { runDataQualityAudit, type DataQualityAuditReport } from '../publication/audit.js';
import { syncStockBasic, syncStockNameHistory } from '#market/stocks/basic-sync.js';
import { assertProductionLock } from '../runs/coordination.js';
import {
  beginMaintenanceRun,
  finishMaintenanceRun,
  startMaintenanceHeartbeat,
  updateMaintenanceRun,
} from '../runs/state.js';
import { runDailyMaintenance } from './daily.js';
import { getRecentOpenDates } from '#market/calendar/read.js';
import { latestCompletedTradeDate } from '#market/calendar/sse-close.js';
import { selfHealMarketDates } from './self-heal.js';
import { syncMarketIndicators } from '#market/state/sync.js';
import { validateDerivedMarketRange } from '#market/state/quality.js';
import { bumpDataRevision } from '../publication/watermark.js';
import { prepareIndexMembership } from '#market/indices/prepare-membership.js';
import { indexWeightMaximumAgeDays } from '../publication/gate.js';

/**
 * 编排指定范围的修复维护并记录恢复结果。
 *
 * Coordinate maintenance repair over the requested range and record its outcome.
 */
export async function runRepairMaintenance(
  startDate?: string,
  endDate?: string,
  refresh = false,
  deferPublication = false,
): Promise<void> {
  assertProductionLock();
  const cutoff = endDate ?? (await latestCompletedTradeDate());
  if (!cutoff) {
    throw new Error('No completed market date is available');
  }
  const recent = startDate ? [] : await getRecentOpenDates(cutoff, 20);
  startDate ??= recent[0];
  endDate = cutoff;
  if (!startDate) {
    throw new Error('No repair trading dates are available');
  }
  assertRange(startDate, endDate);
  const originalState = await getDatabase().maintenanceState.findUnique({
    where: { key: 'global' },
  });
  const run = await beginMaintenanceRun({
    kind: 'repair',
    targetKey: `${startDate}:${endDate}`,
    startDate,
    endDate,
    trigger: 'manual',
    force: true,
  });
  const summary = {
    startDate,
    endDate,
    completedDates: 0,
    totalDates: 0,
    currentDate: null as string | null,
    warehouseReceipts: null as CommodityWarehouseReceiptMaintenanceSummary | null,
    audit: null as DataQualityAuditReport | null,
  };
  const stopHeartbeat = startMaintenanceHeartbeat(run.id);

  try {
    const config = loadTushareConfig();
    const client = new TushareClient({
      token: config.token,
      baseUrl: config.baseUrl,
      minIntervalMs: config.minIntervalMs,
    });
    await updateMaintenanceRun(run.id, 'calendar', summary);
    await syncTradeCal(client, startDate as TradeDate, addCalendarDays(endDate, 14) as TradeDate);
    const dates = await getDatabase().tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: startDate, lte: endDate },
      },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    });
    summary.totalDates = dates.length;

    // 新上市证券也需要完整身份与名称历史，不能只刷新行情后在整轮审计中发现孤儿代码。
    // Refresh security identities and name history before new listings can create orphan price codes.
    await updateMaintenanceRun(run.id, 'stock_reference', summary);
    await syncStockBasic(client);
    await syncStockNameHistory(
      client,
      '19900101' as TradeDate,
      (getStagingContext()?.date ?? endDate) as TradeDate,
    );

    await updateMaintenanceRun(run.id, 'index_membership', summary);
    await prepareIndexMembership(
      client,
      dates.map((row) => row.calDate),
      indexWeightMaximumAgeDays(),
    );

    for (const row of dates) {
      summary.currentDate = row.calDate;
      await updateMaintenanceRun(run.id, 'repairing_date', summary);
      if (refresh) {
        await runDailyMaintenance({
          targetDate: row.calDate,
          force: true,
          trigger: 'manual',
          maintainWarehouseReceipts: false,
          generateSignals: false,
          membershipPrepared: true,
          deferPublication: true,
        });
      } else {
        const healed = await selfHealMarketDates(client, [row.calDate], { maxRepairDates: 1 });
        if (healed.deferredDates.length) {
          throw new Error('Repair has unresolved dates');
        }
      }
      summary.completedDates++;
    }

    await updateMaintenanceRun(run.id, 'commodity_warehouse_receipts', summary);
    summary.warehouseReceipts = await maintainCommodityWarehouseReceipts(
      client,
      endDate as TradeDate,
      getDatabase(),
    );

    // 候选收尾根据最终原始变更计算一次，再检查派生和审计；直接调用仍完成本地验证。
    // The coordinator finalizes frozen inputs once; direct workflow callers still validate locally.
    if (!deferPublication) {
      await syncMarketIndicators(startDate, endDate);
      const expected = await getDatabase().tradeCal.findMany({
        where: { exchange: 'SSE', isOpen: 1, calDate: { gte: startDate, lte: endDate } },
        orderBy: { calDate: 'asc' },
        select: { calDate: true },
      });
      await validateDerivedMarketRange(
        startDate,
        endDate,
        expected.map((row) => row.calDate),
      );

      await updateMaintenanceRun(run.id, 'auditing', summary);
      const audit = await runDataQualityAudit(getDatabase(), {
        startDate,
        endDate,
        windowTradingDays: 60,
        evaluationPoints: 3,
      });
      summary.audit = audit;
      const errors = audit.findings.filter((finding) => finding.status === 'error');
      if (errors.length > 0) {
        throw new Error(
          `Repair audit found ${errors.length} errors: ${errors.map((finding) => finding.title).join(', ')}`,
        );
      }
    }
    // 修复不建立或推进连续日水位，初始化仍由独立选项负责。
    // Repair never initializes or advances the continuous daily watermark.
    await getDatabase().maintenanceState.updateMany({
      where: { key: 'global' },
      data: { dailyPublishedThrough: originalState?.dailyPublishedThrough ?? null },
    });
    await bumpDataRevision();
    await finishMaintenanceRun(run.id, 'done', { summary });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    await finishMaintenanceRun(run.id, 'error', { summary, error: failure.message }).catch(
      () => {},
    );
    throw failure;
  } finally {
    await stopHeartbeat();
  }
}

function assertRange(startDate: string, endDate: string): void {
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('Repair start/end must use YYYYMMDD and start must not exceed end');
  }
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
