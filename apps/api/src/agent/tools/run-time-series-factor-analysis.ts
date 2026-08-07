import {
  timeSeriesAggregateMetrics,
  type FactorHoldoutPolicyV1,
  type FactorResearchIntentV1,
  type FactorTimeSeriesReportV1,
  type Locale,
  type RunFactorAnalysisResponse,
} from '@jixie/shared';
import { z } from 'zod';
import { startFactorAnalysis, readFactorAnalysisResult } from '../../factor/analysis-job.js';
import { getHoldoutPolicy } from '../../factor/research.js';
import { factorResearchIntentV1Schema } from '../../factor/report-spec.js';
import { t } from '../../i18n/index.js';
import { prisma } from '../../lib/prisma.js';
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
    researchIntent: factorResearchIntentV1Schema,
  })
  .superRefine((input, context) => {
    if (new Set(input.assets).size !== input.assets.length) {
      context.addIssue({ code: 'custom', path: ['assets'], message: 'Assets must be unique' });
    }
    const metric = input.researchIntent.primaryCriterion?.metric;
    if (metric && !metric.startsWith('time_series_')) {
      context.addIssue({
        code: 'custom',
        path: ['researchIntent', 'primaryCriterion', 'metric'],
        message: 'Time-series research requires a time-series primary criterion',
      });
    }
  });

type TimeSeriesAnalysisResult = {
  status: 'running' | 'done' | 'error' | 'stale';
  error?: string;
  payload?: FactorTimeSeriesReportV1;
};

interface TimeSeriesResearchContext {
  userId: string;
  factorId: string;
  currentCode: string;
  locale: Locale;
  getPolicy?: () => Promise<FactorHoldoutPolicyV1 | null>;
  start?: (
    options: Parameters<typeof startFactorAnalysis>[0],
  ) => Promise<RunFactorAnalysisResponse>;
  wait?: (
    userId: string,
    reportId: string,
    signal?: AbortSignal,
  ) => Promise<TimeSeriesAnalysisResult>;
}

/** The time-series counterpart of runFactorAnalysis. It freezes an ETF-only explore report and
 * deliberately omits stock-universe, neutralization and rebalance-frequency arguments. */
export function runTimeSeriesFactorAnalysisTool(context: TimeSeriesResearchContext): AgentTool {
  return {
    name: 'runTimeSeriesFactorAnalysis',
    description: `Run one disciplined EXPLORE time-series study for the current custom Factor Definition V2 or a candidate full definition. Freeze the candidate code, ETF assets, forward-return horizon, sample dates, hypothesis/direction, and a time-series primary criterion before seeing metrics. Current assets are 511010.SH (5Y Treasury Bond ETF), 511260.SH (10Y Treasury Bond ETF), 511090.SH (30Y Treasury Bond ETF), 518880.SH (Gold ETF), and 510300.SH (CSI 300 ETF); government-curve inputs only support the fixed-income ETFs. Horizon is 5, 20, or 60 trading days. The observation frequency is daily, prices are adjusted, inference is Newey–West with automatic lag, and data cutoff is the requested end date. This tool cannot reveal holdout, publish, deploy, place orders, or claim strategy performance. Normally compare at most two materially different candidates in one turn.`,
    parameters: z.toJSONSchema(argsSchema),
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

      const [factor, policy] = await Promise.all([
        prisma.factor.findFirst({
          where: {
            id: context.factorId,
            userId: context.userId,
            analysisKind: 'time_series',
          },
          select: { id: true, name: true },
        }),
        (context.getPolicy ?? getHoldoutPolicy)(),
      ]);
      if (!factor) {
        throw new Error('Time-series factor no longer exists.');
      }
      if (!policy) {
        throw new Error('The explore/holdout research window cannot be computed from local data.');
      }
      if (parsed.data.end > policy.exploreEnd) {
        throw new Error(
          `The requested end date crosses the sealed holdout. Use an end date on or before ${policy.exploreEnd}.`,
        );
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
        researchIntent: parsed.data.researchIntent as FactorResearchIntentV1,
        locale: context.locale,
        failedMessage: t(context.locale, 'factorAnalysisFailed'),
        exitedMessage: (code) => t(context.locale, 'factorProcExited', { code }),
      });
      const wait = context.wait ?? waitForTimeSeriesFactorAnalysis;
      const result = await wait(context.userId, started.reportId, runContext?.signal);
      if (result.status === 'error' || result.status === 'stale') {
        throw new Error(result.error ?? `Factor analysis ended with status ${result.status}.`);
      }

      return {
        observation: JSON.stringify({
          researchOnly: true,
          phase: 'explore',
          analysisKind: 'time_series',
          reportId: started.reportId,
          status: result.status,
          reusedRunning: started.reusedRunning,
          researchIntent: parsed.data.researchIntent,
          spec,
          holdoutBoundary: {
            exploreEnd: policy.exploreEnd,
            holdoutStart: policy.holdoutStart,
            holdoutEnd: policy.holdoutEnd,
          },
          metrics: result.payload ? compactTimeSeriesMetrics(result.payload) : undefined,
        }),
        rows: result.payload ? result.payload.byAsset.length : 0,
      };
    },
  };
}

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
    if (!result) {
      throw new Error('Factor report disappeared while the analysis was running.');
    }
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
