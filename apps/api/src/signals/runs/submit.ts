import { latestCompletedTradeDate } from '#market/calendar/sse-close.js';
import { settleStrategyAccounts } from '../accounting/settlement.js';
import { SignalsError } from '../errors.js';
import type { SubmitSignalRunInput } from '../schema.js';
import { enqueueSignalRun } from './enqueue.js';

/**
 * 解析手动请求的信号日期并先结算账户，再将部署运行入队。
 * Resolve a manual signal date and settle accounts before enqueueing the requested deployment.
 */
export async function submitSignalRun(userId: string, input: SubmitSignalRunInput) {
  const tradeDate = input.tradeDate ?? (await latestCompletedTradeDate());
  if (!tradeDate) {
    throw new SignalsError('invalid_date');
  }

  await settleStrategyAccounts(tradeDate, () => {});
  return enqueueSignalRun(userId, input.deploymentId, tradeDate);
}
