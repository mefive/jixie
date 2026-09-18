import pkg from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditFinancialStatementAccounting, auditFinancialStatementVersions } from './audit.js';

// The production singleton must never open the developer database in this fixture.
vi.mock('#infra/database/prisma.js', () => ({ prisma: {} }));

const require = createRequire(import.meta.url);
let fixture: InstanceType<typeof pkg.PrismaClient>;
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jixie-maintenance-audit-'));
  const url = `file:${join(directory, 'audit.db')}`;
  await writeFile(join(directory, 'audit.db'), '');
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    timeout: 60_000,
  });
  fixture = new pkg.PrismaClient({ datasourceUrl: url });
}, 65_000);

afterAll(async () => {
  await fixture?.$disconnect();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('financial audit against migrated SQLite', () => {
  it('executes all UNION branches and detects invalid availability and balance values', async () => {
    const common = {
      source: 'fixture',
      contractVersion: 1,
      tsCode: '000001.SZ',
      endDate: '20260630',
      reportType: '1',
      compType: '1',
      observedAt: new Date('2026-08-01'),
      announcementDate: '20260731',
      availableDate: '20260803',
      availabilityQuality: 'exact',
      evidenceSource: 'tushare_statement',
    };
    await fixture.financialIncomeStatement.create({
      data: { ...common, id: 'income', sourceRowFingerprint: 'income' },
    });
    await fixture.financialBalanceSheet.create({
      data: {
        ...common,
        id: 'balance',
        sourceRowFingerprint: 'balance',
        totalAssets: 100,
        totalShare: 10,
      },
    });
    await fixture.financialCashFlowStatement.create({
      data: { ...common, id: 'cash', sourceRowFingerprint: 'cash' },
    });
    expect((await auditFinancialStatementVersions(fixture)).status).toBe('pass');
    expect((await auditFinancialStatementAccounting(fixture)).status).not.toBe('error');

    await fixture.financialCashFlowStatement.update({
      where: { id: 'cash' },
      data: { announcementDate: '20260601' },
    });
    expect((await auditFinancialStatementVersions(fixture)).status).toBe('error');
    await fixture.financialBalanceSheet.update({
      where: { id: 'balance' },
      data: { totalShare: 0 },
    });
    const result = await auditFinancialStatementAccounting(fixture);
    expect(result.status).toBe('warn');
    expect(result.details.join('\n')).toContain('Source review row balance');
    expect(result.summary).toContain('1 non-positive asset/share records');
    for (const values of [
      { totalAssets: 0, totalShare: 10 },
      { totalAssets: -1, totalShare: 10 },
      { totalAssets: 100, totalShare: -1 },
    ]) {
      await fixture.financialBalanceSheet.update({ where: { id: 'balance' }, data: values });
      expect((await auditFinancialStatementAccounting(fixture)).status).toBe('warn');
      expect(
        await fixture.financialBalanceSheet.findUnique({ where: { id: 'balance' } }),
      ).toMatchObject(values);
    }
  });
});
