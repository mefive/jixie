import { ulid } from 'ulid';
import { Prisma } from '@prisma/client';
import type { ResearchDocumentV1 } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { getResearchDocument } from './workbench.js';

/** Create a Research document that starts from one owned immutable BacktestReport. */
export async function createResearchDocumentFromBacktestReport(
  userId: string,
  reportId: string,
): Promise<ResearchDocumentV1 | null> {
  const report = await prisma.backtestReport.findFirst({
    where: { id: reportId, userId, status: 'done', payload: { not: Prisma.DbNull } },
    select: { id: true, strategyName: true },
  });
  if (!report) {
    return null;
  }

  const documentId = ulid();
  const title = `${report.strategyName} · 回测复核`;
  const cells = [
    {
      kind: 'markdown',
      source: `# 回测报告复核\n\n本研究引用不可变 BacktestReport \`${report.id}\`。先明确需要复核的指标、比较基准和判断标准，再运行 Python Cell 读取原始结果。`,
    },
    {
      kind: 'python',
      source: `backtest_report = results.backtest_report(${JSON.stringify(report.id)})\nbacktest_report`,
    },
  ] as const;

  await prisma.$transaction(async (transaction) => {
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
