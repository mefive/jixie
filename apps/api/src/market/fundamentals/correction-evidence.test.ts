import { expect, it, vi } from 'vitest';
import type { FinancialCorrectionEvidence } from './source-contract.js';
import { storeFinancialCorrectionEvidence } from './correction-evidence.js';

it('stores only evidence with PDF-verified affected periods', async () => {
  const upsert = vi.fn().mockResolvedValue({});
  const income = evidenceStatementDelegate(['income-version']);
  const balance = evidenceStatementDelegate(['balance-version-1', 'balance-version-2']);
  const cashFlow = evidenceStatementDelegate([]);
  const database = {
    financialCorrectionEvidence: { upsert },
    financialIncomeStatement: income,
    financialBalanceSheet: balance,
    financialCashFlowStatement: cashFlow,
  };
  const evidence: FinancialCorrectionEvidence = {
    source: 'cninfo',
    sourceId: '1218790667',
    tsCode: '300266.SZ',
    publishedAt: '2024-01-02T16:00:00.000Z',
    publishedDate: '20240103',
    title: 'Financial correction',
    documentUrl: 'https://static.cninfo.com.cn/finalpage/2024-01-03/1218790667.PDF',
    affectedPeriods: ['20230930'],
    sourceFingerprint: 'fingerprint',
  };

  await expect(
    storeFinancialCorrectionEvidence(
      [evidence],
      new Date('2024-01-03T01:00:00Z'),
      database as never,
    ),
  ).resolves.toBe(1);
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { source_sourceId: { source: 'cninfo', sourceId: '1218790667' } },
      create: expect.objectContaining({ affectedPeriods: ['20230930'] }),
    }),
  );
  expect(income.update).toHaveBeenCalledWith({
    where: { id: 'income-version' },
    data: {
      availabilityQuality: 'exact',
      evidenceSource: 'cninfo_announcement',
      evidenceId: '1218790667',
    },
  });
  expect(balance.update).not.toHaveBeenCalled();
  expect(cashFlow.update).not.toHaveBeenCalled();

  await expect(
    storeFinancialCorrectionEvidence(
      [{ ...evidence, affectedPeriods: [] }],
      new Date('2024-01-03T01:00:00Z'),
      database as never,
    ),
  ).rejects.toThrow('has no verified periods');
});

function evidenceStatementDelegate(ids: string[]) {
  return {
    findMany: vi.fn().mockResolvedValue(ids.map((id) => ({ id }))),
    update: vi.fn().mockResolvedValue({}),
  };
}
