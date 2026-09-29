import type { SignalTask, SignalExecutionSummary } from '@jixie/shared';
import { signalFillSchema, executionLegSchema } from '@jixie/shared/api/signals';
import { z } from 'zod';

const legsSchema = z.object({
  legs: executionLegSchema.array(),
  fillIds: z.array(z.string()).default([]),
});
const tradesSchema = z.object({
  trades: z.array(
    z.object({
      code: z.string(),
      actualCode: z.string().optional(),
      side: z.string(),
      realPrice: z.number().positive(),
    }),
  ),
});

/** Count tasks separately by asset; compare prices only for the same delivery contract and side. */
export function summarizeSignalExecution(task: SignalTask): SignalExecutionSummary {
  const replaced = new Set(
    task.fills.flatMap((fill) => (fill.replacesId ? [fill.replacesId] : [])),
  );
  const fills = task.fills
    .filter((fill) => !fill.voided && !replaced.has(fill.id))
    .map((fill) => signalFillSchema.parse(fill.payload));
  const resolution = task.resolutions.find((row) => row.kind === 'actual');
  const parsed = resolution ? legsSchema.parse(resolution.payload) : null;
  const legs = parsed?.legs ?? null;
  const basis = new Set(parsed?.fillIds ?? []);
  const remainingFills = task.fills
    .filter((fill) => !fill.voided && !replaced.has(fill.id) && !basis.has(fill.id))
    .map((fill) => signalFillSchema.parse(fill.payload));
  const requirements =
    task.intent.assetType === 'future'
      ? legs
      : [
          {
            actualCode: task.intent.code,
            action: task.intent.action,
            effect: task.intent.action === 'buy' ? 'open' : 'close',
            contracts: task.intent.shares,
          },
        ];
  const complete = requirements?.every(
    (leg) =>
      remainingFills
        .filter(
          (fill) =>
            fill.actualCode === leg.actualCode &&
            fill.action === leg.action &&
            fill.effect === leg.effect,
        )
        .reduce((sum, fill) => sum + fill.quantity, 0) >= leg.contracts,
  );
  const status =
    requirements?.length === 0 && !remainingFills.length
      ? 'no_action'
      : fills.length
        ? complete
          ? 'filled'
          : requirements
            ? 'partial'
            : 'recorded'
        : task.actualStatus === 'skipped'
          ? 'skipped'
          : 'pending';
  const simulation = task.resolutions.find((row) => row.kind === 'simulation');
  const trades = simulation ? tradesSchema.parse(simulation.payload).trades : [];
  const deviations = fills.flatMap((fill) => {
    const comparable = trades.filter(
      (trade) => (trade.actualCode ?? trade.code) === fill.actualCode && trade.side === fill.action,
    );
    if (comparable.length !== 1) {
      return [];
    }
    return [(fill.price / comparable[0]!.realPrice - 1) * (fill.action === 'buy' ? 1 : -1) * 10000];
  });

  return {
    status,
    fills: fills.length,
    averagePriceDeviationBps: deviations.length
      ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length
      : null,
  };
}
