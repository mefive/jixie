import type {
  FactorHoldoutPolicyV1,
  FactorReport,
  FactorResearchIntentV1,
  Locale,
  RunFactorAnalysisResponse,
} from '@jixie/shared';
import { z } from 'zod';
import { startFactorAnalysis, readFactorAnalysisResult } from '../../factor/analysis-job.js';
import { getHoldoutPolicy } from '../../factor/research.js';
import {
  createDefaultFactorAnalysisSpecV3,
  createDefaultFactorAnalysisSpecV5,
  factorResearchIntentV1Schema,
} from '../../factor/report-spec.js';
import { t } from '../../i18n/index.js';
import { prisma } from '../../lib/prisma.js';
import type { AgentTool } from './types.js';

const REPORT_WAIT_TIMEOUT_MS = 15 * 60_000;
const REPORT_POLL_INTERVAL_MS = 500;

const argsSchema = z.object({
  code: z.string().min(1).max(20_000).optional(),
  freq: z.enum(['month', 'week']),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  neutral: z.enum(['none', 'size', 'size_industry']).default('none'),
  universe: z.enum(['cn_a', '000300.SH', '000905.SH', '000852.SH']).default('cn_a'),
  rankingScope: z.enum(['global', 'within_industry']).default('global'),
  diagnostics: z
    .array(z.enum(['industry', 'size_bucket', 'liquidity_bucket']))
    .max(3)
    .default([]),
  researchIntent: factorResearchIntentV1Schema,
});

type FactorAnalysisResult = NonNullable<Awaited<ReturnType<typeof readFactorAnalysisResult>>>;

interface FactorResearchContext {
  userId: string;
  factorId: string;
  currentCode: string;
  locale: Locale;
  getPolicy?: () => Promise<FactorHoldoutPolicyV1 | null>;
  start?: (
    options: Parameters<typeof startFactorAnalysis>[0],
  ) => Promise<RunFactorAnalysisResponse>;
  wait?: (userId: string, reportId: string, signal?: AbortSignal) => Promise<FactorAnalysisResult>;
}

/** Create the custom-factor research tool. It can only freeze an explore report; holdout creation,
 * reveal, Factor publication, and strategy deployment remain explicit user actions outside Agent. */
export function runFactorAnalysisTool(context: FactorResearchContext): AgentTool {
  return {
    name: 'runFactorAnalysis',
    description: `Run one disciplined EXPLORE analysis for the current custom factor or a candidate full factor module. You must declare the research card before seeing metrics: mode, hypothesis, expected direction, and primary criterion. Use exploratory mode only when no directional hypothesis exists; exploratory reports are not holdout-eligible. Choose the formal universe explicitly when it matters; use within_industry ranking to test stock selection inside point-in-time SW L1 industries, not as a cosmetic report filter. The end date must not cross the returned holdout boundary. Results are immutable FactorReports. This tool cannot start or reveal holdout, publish a Factor, deploy a strategy, or alter the saved factor code. Normally compare at most two materially different candidates in one turn.`,
    parameters: z.toJSONSchema(argsSchema),
    async run(args, runContext) {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid factor-analysis input: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ')}`,
        );
      }
      if (parsed.data.start >= parsed.data.end) {
        throw new Error('start must be earlier than end.');
      }

      const [factor, policy] = await Promise.all([
        prisma.factor.findFirst({
          where: { id: context.factorId, userId: context.userId },
          select: { id: true, name: true },
        }),
        (context.getPolicy ?? getHoldoutPolicy)(),
      ]);
      if (!factor) {
        throw new Error('Factor no longer exists.');
      }
      if (!policy) {
        throw new Error('The explore/holdout research window cannot be computed from local data.');
      }
      if (parsed.data.end > policy.exploreEnd) {
        throw new Error(
          `The requested end date crosses the sealed holdout. Use an end date on or before ${policy.exploreEnd}.`,
        );
      }

      const commonSpec = {
        freq: parsed.data.freq,
        start: parsed.data.start,
        end: parsed.data.end,
        neutral: parsed.data.neutral,
      };
      const spec =
        parsed.data.universe === 'cn_a' &&
        parsed.data.rankingScope === 'global' &&
        parsed.data.diagnostics.length === 0
          ? createDefaultFactorAnalysisSpecV3(commonSpec)
          : createDefaultFactorAnalysisSpecV5({
              ...commonSpec,
              evaluationScope: {
                version: 1,
                universe:
                  parsed.data.universe === 'cn_a'
                    ? { kind: 'market', market: 'cn_a' }
                    : { kind: 'index', indexCode: parsed.data.universe },
                membership: 'point_in_time',
                rankingScope: parsed.data.rankingScope,
                diagnostics: parsed.data.diagnostics,
              },
            });
      const start = context.start ?? startFactorAnalysis;
      const started = await start({
        userId: context.userId,
        factor: context.factorId,
        source: {
          kind: 'single',
          code: parsed.data.code ?? context.currentCode,
          label: factor.name,
        },
        spec,
        researchIntent: parsed.data.researchIntent as FactorResearchIntentV1,
        locale: context.locale,
        failedMessage: t(context.locale, 'factorAnalysisFailed'),
        exitedMessage: (code) => t(context.locale, 'factorProcExited', { code }),
      });
      const wait = context.wait ?? waitForFactorAnalysis;
      const result = await wait(context.userId, started.reportId, runContext?.signal);
      if (result.status === 'error' || result.status === 'stale') {
        throw new Error(result.error ?? `Factor analysis ended with status ${result.status}.`);
      }

      return {
        observation: JSON.stringify({
          researchOnly: true,
          phase: 'explore',
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
          metrics: result.payload ? compactFactorMetrics(result.payload) : undefined,
        }),
        rows: result.payload ? 1 : 0,
      };
    },
  };
}

async function waitForFactorAnalysis(
  userId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<FactorAnalysisResult> {
  const deadline = Date.now() + REPORT_WAIT_TIMEOUT_MS;
  for (;;) {
    if (signal?.aborted) {
      const error = new Error('factor analysis wait cancelled');
      error.name = 'AbortError';
      throw error;
    }

    const result = await readFactorAnalysisResult(userId, reportId);
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

function compactFactorMetrics(report: FactorReport) {
  return {
    periods: report.periods,
    rankIcMean: report.icMean,
    rankIcAnnual: report.icirAnnual,
    rankIcPositiveRate: report.icPosRate,
    longShortAnnualized: report.longShort.annReturn,
    netLongShortAnnualized: report.longShortNet?.annReturn,
    netLongShortSharpe: report.longShortNet?.sharpe,
    netLongShortMaxDrawdown: report.longShortNet?.maxDrawdown,
    topTurnover: report.topTurnover,
    dataCutoff: report.methodology?.dataCutoff,
  };
}
