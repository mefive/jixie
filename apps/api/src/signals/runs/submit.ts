import { settleStrategyAccounts } from '../accounting/settlement.js';
import { enqueueSignalRun } from './enqueue.js';
import { latestCompletedTradeDate } from './readiness.js';

/** Resolve a manual signal date and settle accounts before enqueueing the requested deployment. */
export async function submitSignalRun(
  userId: string,
  input: { deploymentId: string; tradeDate?: string },
) {
  const tradeDate = input.tradeDate ?? (await latestCompletedTradeDate());
  if (!tradeDate) {
    return { kind: 'invalid_date' as const };
  }

  await settleStrategyAccounts(tradeDate, () => {});
  const result = await enqueueSignalRun(userId, input.deploymentId, tradeDate);
  return result.kind === 'data_not_ready' ? { ...result, tradeDate } : result;
}
