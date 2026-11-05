import { IngestionError } from './errors.js';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';

export interface ResetBusinessDataInput {
  apply: boolean;
  backup?: () => Promise<string>;
}

/**
 * 数据重建仅保留认证表；备份由调用方在锁内完成。
 *
 * Rebuild business data while retaining authentication; the caller backs up under the writer lock.
 */
export async function resetBusinessData(input: ResetBusinessDataInput) {
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
    const backup = await input.backup();
    await withMarketPublication(() =>
      database.$transaction(
        async (transaction) => {
          if (await transaction.ingestionRun.findUnique({ where: { activeReplica: 1 } })) {
            throw new IngestionError('candidate_state_conflict');
          }
          await transaction.job.deleteMany();
          await transaction.researchExecution.deleteMany();
          await transaction.researchEmbeddedAnalysis.deleteMany();
          await transaction.agentConversation.deleteMany();
          await transaction.factor.deleteMany();
          await transaction.strategy.deleteMany();
          await transaction.factorReport.deleteMany();
          await transaction.backtestReport.deleteMany();
          await transaction.strategyScanReport.deleteMany();
          await transaction.researchDocument.deleteMany();
          await transaction.agentCodeChangeProposal.deleteMany();
          await transaction.researchClarification.deleteMany();
          await transaction.researchCellChangeAttempt.deleteMany();
          await transaction.researchCellChangeProposal.deleteMany();
          await transaction.researchCellExecution.deleteMany();
          await transaction.researchArtifact.deleteMany();
          await transaction.researchCell.deleteMany();
          await transaction.researchEmbeddedAnalysisVersion.deleteMany();
          await transaction.agentMessage.deleteMany();
          await transaction.agentTurn.deleteMany();
          await transaction.ingestionRun.deleteMany();
          await transaction.ingestionReplicaChange.deleteMany();
          await transaction.ingestionSelection.deleteMany();
          await transaction.stockBasic.deleteMany();
          await transaction.stockCodeChange.deleteMany();
          await transaction.stockNameHistory.deleteMany();
          await transaction.tradeCal.deleteMany();
          await transaction.daily.deleteMany();
          await transaction.adjFactor.deleteMany();
          await transaction.dailyBasic.deleteMany();
          await transaction.stkLimit.deleteMany();
          await transaction.etfBasic.deleteMany();
          await transaction.etfDaily.deleteMany();
          await transaction.etfAdjFactor.deleteMany();
          await transaction.indexBenchmark.deleteMany();
          await transaction.indexDaily.deleteMany();
          await transaction.indexDailyBasic.deleteMany();
          await transaction.indexWeight.deleteMany();
          await transaction.financialIncomeStatement.deleteMany();
          await transaction.financialBalanceSheet.deleteMany();
          await transaction.financialCashFlowStatement.deleteMany();
          await transaction.financialCorrectionEvidence.deleteMany();
          await transaction.finaIndicator.deleteMany();
          await transaction.finaIndicatorVersion.deleteMany();
          await transaction.dividend.deleteMany();
          await transaction.tushareCapabilityProbe.deleteMany();
          await transaction.marketDataState.deleteMany();
        },
        { timeout: 120_000 },
      ),
    );

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
