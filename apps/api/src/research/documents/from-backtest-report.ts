import { backtestReportStatusWhere } from '#strategy/backtests/state.js';
import { getDatabase } from '#infra/database/prisma.js';
import { t } from '#i18n/messages.js';
import type { Locale, ResearchDocumentV1 } from '@jixie/shared';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { ResearchError } from '../errors.js';
import { getResearchDocument } from './read.js';

/**
 * 从当前用户拥有的保留回测报告创建研究文档。
 *
 * Create a Research document that starts from one owned retained BacktestReport.
 */
export async function createResearchDocumentFromBacktestReport(
  userId: string,
  reportId: string,
  locale: Locale,
): Promise<ResearchDocumentV1> {
  const report = await getDatabase().backtestReport.findFirst({
    where: {
      id: reportId,
      userId,
      AND: [backtestReportStatusWhere(['done'])],
      payload: { not: Prisma.DbNull },
    },
    select: { id: true, strategyName: true },
  });
  if (!report) {
    throw new ResearchError('backtest_report_not_found');
  }

  const documentId = ulid();
  const title = t(locale, 'researchBacktestTitle', { name: report.strategyName });
  const cells = [
    {
      kind: 'markdown',
      source: t(locale, 'researchBacktestIntroduction', { reportId: report.id }),
    },
    {
      kind: 'python',
      source: `backtest_report = results.backtest_report(${JSON.stringify(report.id)})\nbacktest_report`,
    },
  ] as const;

  await getDatabase().$transaction(async (transaction) => {
    await transaction.agentConversation.create({
      data: { id: documentId, userId, surface: 'research', title },
    });
    await transaction.researchDocument.create({
      data: {
        id: documentId,
        userId,
        conversationId: documentId,
        cells: {
          create: cells.map((cell, position) => ({
            id: ulid(),
            position,
            kind: cell.kind,
            source: cell.source,
            definitions: [] as unknown as Prisma.InputJsonValue,
            references: [] as unknown as Prisma.InputJsonValue,
          })),
        },
      },
    });
  });
  return getResearchDocument(userId, documentId);
}
