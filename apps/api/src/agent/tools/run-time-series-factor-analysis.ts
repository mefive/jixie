import { readFactorAnalysisResult } from '#factor/evaluations/read.js';
import { startFactorAnalysis } from '#factor/evaluations/start.js';
import { t } from '#i18n/index.js';
import { getDatabase } from '#infra/database/prisma.js';
import {
  timeSeriesAggregateMetrics,
  type FactorTimeSeriesReportV1,
  type Locale,
  type RunFactorAnalysisResponse,
} from '@jixie/shared';
import { z } from 'zod';
import type { AgentTool } from './types.js';

const REPORT_WAIT_TIMEOUT_MS = 15 * 60_000;
const REPORT_POLL_INTERVAL_MS = 500;
const assetSchema = z.enum(['511010.SH', '511260.SH', '511090.SH', '518880.SH', '510300.SH']);

const argsSchema = z
  .object({
    code: z.string().min(1).max(20_000).optional(),
    start: z.string().regex(/^\d{8}$/),
    end: z.string().regex(/^\d{8}$/),
    assets: z.array(assetSchema).min(1).max(5),
    horizon: z.union([z.literal(5), z.literal(20), z.literal(60)]),
  })
  .superRefine((input, context) => {
    if (new Set(input.assets).size !== input.assets.length) {
      context.addIssue({ code: 'custom', path: ['assets'], message: 'Assets must be unique' });
    }
  });

/**
 * 承载单资产时间序列探索结果与报告身份，供工具输出和消息留存。
 *
 * Carry time-series exploration results and report identity for tool output and persistence.
 */
type TimeSeriesAnalysisResult = {
  status: 'running' | 'done' | 'error' | 'stale';
  error?: string;
  payload?: FactorTimeSeriesReportV1;
};

/**
 * 绑定时间序列因子工具的定义与探索范围，供权限及状态校验。
 *
 * Bind a time-series tool to its definition and permitted exploration scope.
 */
interface TimeSeriesResearchContext {
  userId: string;
  factorId: string;
  currentCode: string;
  locale: Locale;
  start?: (
    options: Parameters<typeof startFactorAnalysis>[0],
  ) => Promise<RunFactorAnalysisResponse>;
  wait?: (
    userId: string,
    reportId: string,
    signal?: AbortSignal,
  ) => Promise<TimeSeriesAnalysisResult>;
}

/**
 * 创建仅用于 ETF 时间序列探索的因子工具，不接受股票池、中性化。
 *
 * The time-series counterpart of runFactorAnalysis. It freezes an ETF-only explore report and
 * deliberately omits stock-universe, neutralization and rebalance-frequency arguments.
 */
export function runTimeSeriesFactorAnalysisTool(context: TimeSeriesResearchContext): AgentTool {
  return {
    name: 'runTimeSeriesFactorAnalysis',
    description: `Run a time-series study for the current custom Factor Definition V2 or a candidate full definition. Freeze the candidate code, ETF assets, forward-return horizon, and sample dates before seeing metrics. Current assets are 511010.SH (5Y Treasury Bond ETF), 511260.SH (10Y Treasury Bond ETF), 511090.SH (30Y Treasury Bond ETF), 518880.SH (Gold ETF), and 510300.SH (CSI 300 ETF); government-curve inputs only support the fixed-income ETFs. Horizon is 5, 20, or 60 trading days. The observation frequency is daily, prices are adjusted, inference is Newey–West with automatic lag, and data cutoff is the requested end date. This tool cannot publish, deploy, place orders, or claim strategy performance.`,
    parameters: z.toJSONSchema(argsSchema),

    /**
     * 校验并提交时间序列探索任务，等待终态后返回报告摘要。
     *
     * Validate and submit time-series exploration, then return its completed report summary.
     */
    async run(args, runContext) {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid time-series factor-analysis input: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ')}`,
        );
      }
      if (parsed.data.start >= parsed.data.end) {
        throw new Error('start must be earlier than end.');
      }

      const factor = await getDatabase().factor.findFirst({
        where: {
          id: context.factorId,
          userId: context.userId,
          analysisKind: 'time_series',
        },
        select: { id: true, name: true },
      });
      if (!factor) {
        throw new Error('Time-series factor no longer exists.');
      }

      const spec = {
        version: 1 as const,
        analysisKind: 'time_series' as const,
        start: parsed.data.start,
        end: parsed.data.end,
        observationFrequency: 'daily' as const,
        assets: parsed.data.assets,
        target: {
          kind: 'forward_total_return' as const,
          horizon: parsed.data.horizon,
          horizonUnit: 'trade_day' as const,
        },
        dataPolicy: {
          pointInTime: true as const,
          revisionPolicy: 'as_available' as const,
          dataCutoff: parsed.data.end,
        },
        inference: { standardError: 'newey_west' as const, lag: 'automatic' as const },
      };
      const start = context.start ?? startFactorAnalysis;
      const started = await start({
        userId: context.userId,
        factor: context.factorId,
        source: {
          kind: 'time_series',
          code: parsed.data.code ?? context.currentCode,
          label: factor.name,
        },
        spec,
        locale: context.locale,
        failedMessage: t(context.locale, 'factorAnalysisFailed'),
      });
      const wait = context.wait ?? waitForTimeSeriesFactorAnalysis;
      const result = await wait(context.userId, started.reportId, runContext?.signal);
      if (result.status === 'error' || result.status === 'stale') {
        throw new Error(result.error ?? `Factor analysis ended with status ${result.status}.`);
      }

      return {
        observation: JSON.stringify({
          researchOnly: true,
          analysisKind: 'time_series',
          reportId: started.reportId,
          status: result.status,
          reusedRunning: started.reusedRunning,
          spec,
          metrics: result.payload ? compactTimeSeriesMetrics(result.payload) : undefined,
        }),
        rows: result.payload ? result.payload.byAsset.length : 0,
      };
    },
  };
}

/**
 * 等待时间序列分析任务完成，并读取已保存的报告结果。
 *
 * Wait for time-series analysis and read the persisted report result.
 */
async function waitForTimeSeriesFactorAnalysis(
  userId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<TimeSeriesAnalysisResult> {
  const deadline = Date.now() + REPORT_WAIT_TIMEOUT_MS;
  for (;;) {
    if (signal?.aborted) {
      const error = new Error('factor analysis wait cancelled');
      error.name = 'AbortError';
      throw error;
    }
    const result = (await readFactorAnalysisResult(userId, reportId)) as TimeSeriesAnalysisResult;

    if (result.status !== 'running' || Date.now() >= deadline) {
      return result;
    }
    await waitForPoll(signal);
  }
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(complete, REPORT_POLL_INTERVAL_MS);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      const error = new Error('factor analysis wait cancelled');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function compactTimeSeriesMetrics(report: FactorTimeSeriesReportV1) {
  const aggregate = timeSeriesAggregateMetrics(report);
  return {
    periods: report.periods,
    observations: report.observations,
    assets: report.byAsset.map((asset) => ({
      assetId: asset.assetId,
      observations: asset.observations,
      correlation: asset.correlation,
      regressionSlope: asset.regressionSlope,
      neweyWestTStat: asset.neweyWestTStat,
      directionHitRate: asset.directionHitRate,
    })),
    medianNeweyWestT: aggregate.medianNeweyWestT,
    meanDirectionHitRate: aggregate.meanDirectionHitRate,
  };
}
