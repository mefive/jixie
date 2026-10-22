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
import { assertProductionLock, waitForRunningWork } from '../runs/coordination.js';
import {
  beginMaintenanceRun,
  finishMaintenanceRun,
  startMaintenanceHeartbeat,
  updateMaintenanceRun,
} from '../runs/state.js';
import { getRecentOpenDates } from '#market/calendar/read.js';
import { latestCompletedTradeDate } from '#market/calendar/sse-close.js';
import { prepareSignalEtfMarketDate } from '#signals/daily/sync.js';
import type { PreparedEtfMarketDate } from '#market/etfs/sync.js';
import { refreshCommodityHoldingPositions } from '#market/commodity/holding-sync.js';
import { syncCommodityContinuousReturns } from '#market/commodity/commodity-continuous-returns.js';
import { syncCrossMarketBenchmarks } from '#market/cross-market/benchmark-sync.js';
import { syncExternalMarketDrivers } from '#market/cross-market/external-drivers.js';
import {
  MinistryOfFinanceCurveClient,
  syncChinaTreasuryYieldCurve,
} from '#market/rates/china-treasury-curve.js';
import {
  ChinaBondPublicCurveClient,
  syncChinaBondCreditCurves,
} from '#market/rates/chinabond-credit-curves.js';
import { refreshMarketDate } from './refresh-market-date.js';
import type { RepairMaintenanceOptions } from './repair-arguments.js';
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
export async function runRepairMaintenance(options: RepairMaintenanceOptions = {}): Promise<void> {
  assertProductionLock();
  let { startDate, endDate } = options;
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
    commodityHoldingPositions: null as Awaited<
      ReturnType<typeof refreshCommodityHoldingPositions>
    > | null,
    commodityContinuousReturns: null as Awaited<
      ReturnType<typeof syncCommodityContinuousReturns>
    > | null,
    externalMarketDrivers: null as Awaited<ReturnType<typeof syncExternalMarketDrivers>> | null,
    crossMarketBenchmarks: null as Awaited<ReturnType<typeof syncCrossMarketBenchmarks>> | null,
    chinaTreasuryCurve: null as number | null,
    creditCurves: null as number | null,
    audit: null as DataQualityAuditReport | null,
  };
  const stopHeartbeat = startMaintenanceHeartbeat(run.id);

  try {
    const onLog = (line: string) => console.log(`[maintenance:repair] ${line}`);
    await updateMaintenanceRun(run.id, 'waiting_for_jobs', summary);
    await waitForRunningWork(onLog);

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

    if (dates.length === 0) {
      throw new Error('No repair trading dates are available');
    }

    const completedThrough = await latestCompletedTradeDate();
    if (!completedThrough || dates.at(-1)!.calDate > completedThrough) {
      throw new Error(`${dates.at(-1)!.calDate} has not completed in Asia/Shanghai`);
    }
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

    // 保留整段 ETF 候选，避免逐日刷新时重新获取而改变预检结果。
    // Retain ETF candidates for the whole range so refetches cannot invalidate preflight results.
    await updateMaintenanceRun(run.id, 'preparing_etfs', summary);
    const preparedEtfs = new Map<string, PreparedEtfMarketDate>();
    for (const { calDate } of dates) {
      preparedEtfs.set(calDate, await prepareSignalEtfMarketDate(client, calDate as TradeDate));
    }

    // 区间依赖只准备一次；各数据域保留自身前置观察和 PIT 规则。
    // Prepare range dependencies once, retaining each domain's prerequisite observations and PIT rules.
    await updateMaintenanceRun(run.id, 'commodity_warehouse_receipts', summary);
    summary.warehouseReceipts = await maintainCommodityWarehouseReceipts(
      client,
      endDate as TradeDate,
      getDatabase(),
      onLog,
      { startDate: startDate as TradeDate },
    );

    await updateMaintenanceRun(run.id, 'commodity_holding_positions', summary);
    summary.commodityHoldingPositions = await refreshCommodityHoldingPositions(
      client,
      startDate,
      endDate,
      onLog,
    );

    await updateMaintenanceRun(run.id, 'commodity_continuous_returns', summary);
    summary.commodityContinuousReturns = await syncCommodityContinuousReturns(
      client,
      startDate,
      endDate,
      getDatabase(),
      onLog,
    );

    await updateMaintenanceRun(run.id, 'external_market_drivers', summary);
    summary.externalMarketDrivers = await syncExternalMarketDrivers(
      client,
      startDate,
      endDate,
      onLog,
    );

    await updateMaintenanceRun(run.id, 'cross_market_benchmarks', summary);
    summary.crossMarketBenchmarks = await syncCrossMarketBenchmarks(
      client,
      startDate,
      endDate,
      onLog,
    );

    await updateMaintenanceRun(run.id, 'china_treasury_curve', summary);
    summary.chinaTreasuryCurve = await syncChinaTreasuryYieldCurve(
      new MinistryOfFinanceCurveClient(),
      startDate,
      endDate,
      onLog,
    );

    await updateMaintenanceRun(run.id, 'credit_curves', summary);
    summary.creditCurves = await syncChinaBondCreditCurves(
      new ChinaBondPublicCurveClient(),
      startDate,
      endDate,
      onLog,
    );

    for (const { calDate } of dates) {
      summary.currentDate = calDate;
      const result = await refreshMarketDate(client, calDate as TradeDate, {
        preparedEtf: preparedEtfs.get(calDate)!,
        treasuryAlreadyPrepared: true,
        onLog,
        onStage: (stage) => updateMaintenanceRun(run.id, stage, summary),
      });
      summary.completedDates++;
      await updateMaintenanceRun(run.id, 'raw_ready', { ...summary, ...result });
    }

    // 候选收尾根据最终原始变更计算一次，再检查派生和审计；直接调用仍完成本地验证。
    // The coordinator finalizes frozen inputs once; direct workflow callers still validate locally.
    if (!options.deferPublication) {
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
