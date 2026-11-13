import { IngestionError } from './errors.js';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';

export interface ResetBusinessDataInput {
  apply: boolean;
  transactionTimeoutMs?: number;
  onLog?: (message: string) => void;
  backup?: () => Promise<string>;
}

/**
 * 数据重建仅保留认证表；备份由调用方在锁内完成。
 *
 * Rebuild business data while retaining authentication; the caller backs up under the writer lock.
 */
export async function resetBusinessData(input: ResetBusinessDataInput) {
  const transactionTimeoutMs = input.transactionTimeoutMs ?? 30 * 60_000;
  if (
    !Number.isSafeInteger(transactionTimeoutMs) ||
    transactionTimeoutMs < 1 ||
    transactionTimeoutMs > 2_147_483_647
  ) {
    throw new Error(
      'JIXIE_RESET_TRANSACTION_TIMEOUT_MS must be an integer between 1 and 2147483647',
    );
  }

  return withMaintenanceLock(async () => {
    const database = getDatabase();
    const retained = await Promise.all([
      database.user.count(),
      database.session.count(),
      database.inviteCode.count(),
      database.emailLoginChallenge.count(),
    ]);
    if (!input.apply) {
      return {
        mode: 'preview',
        retained: {
          users: retained[0],
          sessions: retained[1],
          invites: retained[2],
          loginChallenges: retained[3],
        },
        removes:
          'All market, ingestion, factor, strategy, report, research, conversation and job records',
      };
    }
    if (!input.backup) {
      throw new Error('A verified backup is required before rebuilding business data');
    }
    if (await database.ingestionRun.findUnique({ where: { activeReplica: 1 } })) {
      throw new IngestionError('candidate_state_conflict');
    }

    input.onLog?.('[reset] backup started');
    const backup = await input.backup();
    input.onLog?.('[reset] backup completed');

    const startedAt = performance.now();
    input.onLog?.(`[reset] publication requested; timeoutMs=${transactionTimeoutMs}`);
    let currentTable = 'candidate guard';
    try {
      await withMarketPublication(() =>
        database.$transaction(
          async (transaction) => {
            input.onLog?.('[reset] transaction started');
            // 表级完成日志不代表提交；失败时整个删除事务回滚。
            // Per-table completion is not a commit; failure rolls back the entire deletion transaction.
            const clearTable = async (table: string, remove: () => Promise<{ count: number }>) => {
              currentTable = table;
              const tableStartedAt = performance.now();
              input.onLog?.(`[reset] deleting ${table}`);
              const result = await remove();
              const elapsedMs = Math.round(performance.now() - tableStartedAt);
              const details = `rows=${result.count}; elapsedMs=${elapsedMs}; uncommitted`;
              input.onLog?.(`[reset] deleted ${table}; ${details}`);
            };

            if (await transaction.ingestionRun.findUnique({ where: { activeReplica: 1 } })) {
              throw new IngestionError('candidate_state_conflict');
            }
            await clearTable('job', () => transaction.job.deleteMany());
            await clearTable('researchExecution', () => transaction.researchExecution.deleteMany());
            await clearTable('researchEmbeddedAnalysis', () =>
              transaction.researchEmbeddedAnalysis.deleteMany(),
            );
            await clearTable('agentConversation', () => transaction.agentConversation.deleteMany());
            await clearTable('factor', () => transaction.factor.deleteMany());
            await clearTable('strategy', () => transaction.strategy.deleteMany());
            await clearTable('factorReport', () => transaction.factorReport.deleteMany());
            await clearTable('backtestReport', () => transaction.backtestReport.deleteMany());
            await clearTable('strategyScanReport', () =>
              transaction.strategyScanReport.deleteMany(),
            );
            await clearTable('researchDocument', () => transaction.researchDocument.deleteMany());
            await clearTable('agentCodeChangeProposal', () =>
              transaction.agentCodeChangeProposal.deleteMany(),
            );
            await clearTable('researchClarification', () =>
              transaction.researchClarification.deleteMany(),
            );
            await clearTable('researchCellChangeAttempt', () =>
              transaction.researchCellChangeAttempt.deleteMany(),
            );
            await clearTable('researchCellChangeProposal', () =>
              transaction.researchCellChangeProposal.deleteMany(),
            );
            await clearTable('researchCellExecution', () =>
              transaction.researchCellExecution.deleteMany(),
            );
            await clearTable('researchArtifact', () => transaction.researchArtifact.deleteMany());
            await clearTable('researchCell', () => transaction.researchCell.deleteMany());
            await clearTable('researchEmbeddedAnalysisVersion', () =>
              transaction.researchEmbeddedAnalysisVersion.deleteMany(),
            );
            await clearTable('agentMessage', () => transaction.agentMessage.deleteMany());
            await clearTable('agentTurn', () => transaction.agentTurn.deleteMany());
            await clearTable('ingestionRun', () => transaction.ingestionRun.deleteMany());
            await clearTable('ingestionReplicaChange', () =>
              transaction.ingestionReplicaChange.deleteMany(),
            );
            await clearTable('ingestionSelection', () =>
              transaction.ingestionSelection.deleteMany(),
            );
            await clearTable('stockBasic', () => transaction.stockBasic.deleteMany());
            await clearTable('stockCodeChange', () => transaction.stockCodeChange.deleteMany());
            await clearTable('stockNameHistory', () => transaction.stockNameHistory.deleteMany());
            await clearTable('tradeCal', () => transaction.tradeCal.deleteMany());
            await clearTable('daily', () => transaction.daily.deleteMany());
            await clearTable('adjFactor', () => transaction.adjFactor.deleteMany());
            await clearTable('dailyBasic', () => transaction.dailyBasic.deleteMany());
            await clearTable('stkLimit', () => transaction.stkLimit.deleteMany());
            await clearTable('etfBasic', () => transaction.etfBasic.deleteMany());
            await clearTable('etfDaily', () => transaction.etfDaily.deleteMany());
            await clearTable('etfAdjFactor', () => transaction.etfAdjFactor.deleteMany());
            await clearTable('indexBenchmark', () => transaction.indexBenchmark.deleteMany());
            await clearTable('indexDaily', () => transaction.indexDaily.deleteMany());
            await clearTable('indexDailyBasic', () => transaction.indexDailyBasic.deleteMany());
            await clearTable('indexWeight', () => transaction.indexWeight.deleteMany());
            await clearTable('financialIncomeStatement', () =>
              transaction.financialIncomeStatement.deleteMany(),
            );
            await clearTable('financialBalanceSheet', () =>
              transaction.financialBalanceSheet.deleteMany(),
            );
            await clearTable('financialCashFlowStatement', () =>
              transaction.financialCashFlowStatement.deleteMany(),
            );
            await clearTable('financialCorrectionEvidence', () =>
              transaction.financialCorrectionEvidence.deleteMany(),
            );
            await clearTable('finaIndicator', () => transaction.finaIndicator.deleteMany());
            await clearTable('finaIndicatorVersion', () =>
              transaction.finaIndicatorVersion.deleteMany(),
            );
            await clearTable('dividend', () => transaction.dividend.deleteMany());
            await clearTable('tushareCapabilityProbe', () =>
              transaction.tushareCapabilityProbe.deleteMany(),
            );
            await clearTable('marketDataState', () => transaction.marketDataState.deleteMany());
          },
          { timeout: transactionTimeoutMs },
        ),
      );
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      input.onLog?.(`[reset] transaction failed; table=${currentTable}; elapsedMs=${elapsedMs}`);
      throw error;
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    input.onLog?.(`[reset] transaction committed; elapsedMs=${elapsedMs}`);

    return {
      mode: 'applied',
      backup,
      retained: {
        users: retained[0],
        sessions: retained[1],
        invites: retained[2],
        loginChallenges: retained[3],
      },
    };
  });
}
