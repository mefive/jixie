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
    const backup = await input.backup();
    await withMarketPublication(() =>
      database.$transaction([
        database.job.deleteMany(),
        database.researchExecution.deleteMany(),
        database.researchEmbeddedAnalysis.deleteMany(),
        database.agentConversation.deleteMany(),
        database.factor.deleteMany(),
        database.strategy.deleteMany(),
        database.factorReport.deleteMany(),
        database.backtestReport.deleteMany(),
        database.strategyScanReport.deleteMany(),
        database.researchDocument.deleteMany(),
        database.agentCodeChangeProposal.deleteMany(),
        database.researchClarification.deleteMany(),
        database.researchCellChangeAttempt.deleteMany(),
        database.researchCellChangeProposal.deleteMany(),
        database.researchCellExecution.deleteMany(),
        database.researchArtifact.deleteMany(),
        database.researchCell.deleteMany(),
        database.researchEmbeddedAnalysisVersion.deleteMany(),
        database.agentMessage.deleteMany(),
        database.agentTurn.deleteMany(),
        database.ingestionRun.deleteMany(),
        database.ingestionSelection.deleteMany(),
        database.stockBasic.deleteMany(),
        database.stockCodeChange.deleteMany(),
        database.stockNameHistory.deleteMany(),
        database.tradeCal.deleteMany(),
        database.daily.deleteMany(),
        database.adjFactor.deleteMany(),
        database.dailyBasic.deleteMany(),
        database.stkLimit.deleteMany(),
        database.etfBasic.deleteMany(),
        database.etfDaily.deleteMany(),
        database.etfAdjFactor.deleteMany(),
        database.indexBenchmark.deleteMany(),
        database.indexDaily.deleteMany(),
        database.indexDailyBasic.deleteMany(),
        database.indexWeight.deleteMany(),
        database.financialIncomeStatement.deleteMany(),
        database.financialBalanceSheet.deleteMany(),
        database.financialCashFlowStatement.deleteMany(),
        database.financialCorrectionEvidence.deleteMany(),
        database.finaIndicator.deleteMany(),
        database.finaIndicatorVersion.deleteMany(),
        database.dividend.deleteMany(),
        database.tushareCapabilityProbe.deleteMany(),
        database.marketDataState.deleteMany(),
      ]),
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
