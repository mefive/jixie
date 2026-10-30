import { ulid } from 'ulid';
import { getDatabase, type Prisma } from '#infra/database/prisma.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import type { FinancialCorrectionEvidence } from './source-contract.js';

type CorrectionEvidenceDatabase = Pick<
  Prisma,
  | 'financialCorrectionEvidence'
  | 'financialIncomeStatement'
  | 'financialBalanceSheet'
  | 'financialCashFlowStatement'
>;

/**
 * 保存更正公告，只关联无歧义报表版本。
 *
 * Store correction announcements and attach only unambiguous versions.
 */
export async function storeFinancialCorrectionEvidence(
  evidence: readonly FinancialCorrectionEvidence[],
  observedAt = new Date(),
  database: CorrectionEvidenceDatabase = getDatabase(),
): Promise<number> {
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error('Financial correction evidence has invalid observedAt');
  }

  for (const item of evidence) {
    assertDate(item.publishedDate, 'evidence publishedDate');
    assertTsCode(item.tsCode);
    if (item.affectedPeriods.length === 0) {
      throw new Error(`Financial correction evidence ${item.sourceId} has no verified periods`);
    }
    for (const period of item.affectedPeriods) {
      assertDate(period, 'evidence affected period');
    }
    const publishedAt = new Date(item.publishedAt);
    if (!Number.isFinite(publishedAt.getTime())) {
      throw new Error(`Financial correction evidence ${item.sourceId} has invalid publishedAt`);
    }
    const data = {
      source: item.source,
      sourceId: item.sourceId,
      tsCode: canonicalStockCode(item.tsCode),
      publishedAt,
      publishedDate: item.publishedDate,
      title: item.title,
      documentUrl: item.documentUrl,
      affectedPeriods: [...item.affectedPeriods],
      sourceFingerprint: item.sourceFingerprint,
      observedAt,
    };
    await database.financialCorrectionEvidence.upsert({
      where: { source_sourceId: { source: item.source, sourceId: item.sourceId } },
      create: { id: ulid(), ...data },
      update: data,
    });
    for (const period of item.affectedPeriods) {
      const where = {
        tsCode: canonicalStockCode(item.tsCode),
        endDate: period,
        announcementDate: item.publishedDate,
      };
      const exactData = {
        availabilityQuality: 'exact',
        evidenceSource: 'cninfo_announcement',
        evidenceId: item.sourceId,
      };
      await Promise.all([
        attachEvidenceToUnambiguousVersion(
          () => database.financialIncomeStatement.findMany({ where, select: { id: true } }),
          (id) => database.financialIncomeStatement.update({ where: { id }, data: exactData }),
        ),
        attachEvidenceToUnambiguousVersion(
          () => database.financialBalanceSheet.findMany({ where, select: { id: true } }),
          (id) => database.financialBalanceSheet.update({ where: { id }, data: exactData }),
        ),
        attachEvidenceToUnambiguousVersion(
          () => database.financialCashFlowStatement.findMany({ where, select: { id: true } }),
          (id) => database.financialCashFlowStatement.update({ where: { id }, data: exactData }),
        ),
      ]);
    }
  }
  return evidence.length;
}

async function attachEvidenceToUnambiguousVersion(
  findCandidates: () => Promise<Array<{ id: string }>>,
  update: (id: string) => Promise<unknown>,
): Promise<boolean> {
  const candidates = await findCandidates();
  if (candidates.length !== 1) {
    return false;
  }
  await update(candidates[0].id);
  return true;
}

function assertDate(value: string, field: string): void {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Financial statement ${field} must use YYYYMMDD`);
  }
}

function assertTsCode(value: string): void {
  if (!/^\d{6}\.(?:SH|SZ|BJ)$/.test(value)) {
    throw new Error(`Invalid A-share code: ${value}`);
  }
}
