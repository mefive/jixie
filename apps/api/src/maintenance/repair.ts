import type { TradeDate } from '@jixie/shared';
import {
  maintainCommodityWarehouseReceipts,
  type CommodityWarehouseReceiptMaintenanceSummary,
} from '../commodity/commodity-warehouse-receipt-maintenance.js';
import { loadTushareConfig } from '../config.js';
import { runDataQualityAudit } from '../data-quality/audit.js';
import { prisma } from '../lib/prisma.js';
import { syncTradeCal } from '../store/sync.js';
import { TushareClient } from '../tushare/client.js';
import { assertProductionLock, runDailyMaintenance } from './daily.js';
import {
  beginMaintenanceRun,
  finishMaintenanceRun,
  startMaintenanceHeartbeat,
  updateMaintenanceRun,
} from './state.js';

export async function runRepairMaintenance(startDate: string, endDate: string): Promise<void> {
  assertProductionLock();
  assertRange(startDate, endDate);
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
    const dates = await prisma.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: startDate, lte: endDate },
      },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    });
    summary.totalDates = dates.length;

    for (const row of dates) {
      summary.currentDate = row.calDate;
      await updateMaintenanceRun(run.id, 'repairing_date', summary);
      await runDailyMaintenance({
        targetDate: row.calDate,
        force: true,
        trigger: 'manual',
        maintainWarehouseReceipts: false,
      });
      summary.completedDates++;
    }

    await updateMaintenanceRun(run.id, 'commodity_warehouse_receipts', summary);
    summary.warehouseReceipts = await maintainCommodityWarehouseReceipts(
      client,
      endDate as TradeDate,
      prisma,
    );

    await updateMaintenanceRun(run.id, 'auditing', summary);
    const audit = await runDataQualityAudit(prisma, {
      startDate,
      endDate,
      windowTradingDays: 60,
      evaluationPoints: 3,
    });
    const errors = audit.findings.filter((finding) => finding.status === 'error');
    if (errors.length > 0) {
      throw new Error(
        `Repair audit found ${errors.length} errors: ${errors.map((finding) => finding.title).join(', ')}`,
      );
    }
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
