import { Worker } from 'node:worker_threads';
import type { BacktestConfig, BacktestMetricSummary, Locale } from '@jixie/shared';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { codeConfigSchema } from '../../strategy/code/schema.js';
import type { AgentTool } from './types.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../../engine/agent-backtest-worker.boot.mjs', import.meta.url)
  : new URL('../../engine/agent-backtest-worker.js', import.meta.url);

const argsSchema = codeConfigSchema
  .pick({ start: true, end: true, initialCash: true, cost: true, code: true })
  .partial();

interface QuickBacktestContext {
  userId: string;
  strategyId: string;
  currentCode: string;
  locale: Locale;
  execute?: (
    config: BacktestConfig,
    context: { userId: string; locale: Locale; signal?: AbortSignal },
  ) => Promise<BacktestMetricSummary>;
}

/** Create the strategy-only research tool. The run is isolated and never commits Strategy.config,
 * Strategy.lastResult, deployment state, or orders. Its compact observation is persisted in the
 * Agent turn trace, so the candidate and metrics remain auditable with the conversation. */
export function runQuickBacktestTool(context: QuickBacktestContext): AgentTool {
  return {
    name: 'runQuickBacktest',
    description: `Run one isolated A-share backtest for the current strategy or a candidate full strategy module, then return compact performance metrics. Use it to validate a concrete code change before presenting the final code. Omitted range, capital, and cost fields inherit the strategy's saved configuration; omitted code uses the current editor code. This is a research-only run: it never saves the candidate, replaces the strategy's official last result, deploys, or places orders. Do not repeatedly tune against the same sample; normally run at most two materially different candidates in one turn.`,
    parameters: z.toJSONSchema(argsSchema),
    async run(args, runContext) {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Invalid quick-backtest input: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ')}`,
        );
      }

      const row = await prisma.strategy.findFirst({
        where: { id: context.strategyId, userId: context.userId },
        select: { config: true, name: true },
      });
      if (!row) {
        throw new Error('Strategy no longer exists.');
      }
      const saved = codeConfigSchema.safeParse(row.config);
      if (!saved.success) {
        throw new Error('The saved strategy configuration is invalid; run it from the lab first.');
      }
      const config = codeConfigSchema.parse({
        ...saved.data,
        ...parsed.data,
        name: row.name,
        code: parsed.data.code ?? context.currentCode,
      }) as BacktestConfig;
      if (config.start >= config.end) {
        throw new Error('start must be earlier than end.');
      }

      const execute = context.execute ?? executeQuickBacktest;
      const summary = await execute(config, {
        userId: context.userId,
        locale: context.locale,
        signal: runContext?.signal,
      });
      return {
        observation: JSON.stringify({
          researchOnly: true,
          candidate: {
            start: config.start,
            end: config.end,
            initialCash: config.initialCash,
          },
          metrics: summary,
        }),
        rows: 1,
      };
    },
  };
}

export function executeQuickBacktest(
  config: BacktestConfig,
  context: { userId: string; locale: Locale; signal?: AbortSignal },
): Promise<BacktestMetricSummary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData: { config, userId: context.userId, locale: context.locale },
    });
    let summary: BacktestMetricSummary | undefined;
    let error: string | undefined;

    const abort = () => {
      void worker.terminate();
      const abortError = new Error('quick backtest cancelled');
      abortError.name = 'AbortError';
      reject(abortError);
    };
    if (context.signal?.aborted) {
      abort();
      return;
    }
    context.signal?.addEventListener('abort', abort, { once: true });

    worker.on(
      'message',
      (message: { type: string; summary?: BacktestMetricSummary; message?: string }) => {
        if (message.type === 'done') {
          summary = message.summary;
        } else if (message.type === 'error') {
          error = message.message ?? 'quick backtest failed';
        }
      },
    );
    worker.on('error', (workerError) => {
      error = workerError.message;
    });
    worker.on('exit', (code) => {
      context.signal?.removeEventListener('abort', abort);
      if (error) {
        reject(new Error(error));
      } else if (code !== 0) {
        reject(new Error(`quick backtest worker exited with code ${code}`));
      } else if (!summary) {
        reject(new Error('quick backtest worker exited without a result'));
      } else {
        resolve(summary);
      }
    });
  });
}
