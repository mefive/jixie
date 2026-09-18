import type { Prisma } from '#infra/database/prisma.js';
import { describe, expect, it, vi } from 'vitest';
import {
  auditFinancialStatementVersions,
  summarizeFinancialStatementAccounting,
  summarizeFinancialStatementVersions,
} from './audit.js';

describe('market data audit', () => {
  it('selects report-period end dates before auditing statement versions', async () => {
    const queries: string[] = [];
    const database = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        queries.push(strings.join(''));
        return queries.length === 1
          ? [
              {
                total: 0,
                invalidAnnouncementDate: 0,
                invalidAvailableDate: 0,
                invalidQuality: 0,
                invalidReportScope: 0,
              },
            ]
          : [{ indicatorPeriods: 0, incomeMatches: 0, balanceMatches: 0, cashFlowMatches: 0 }];
      }),
    } as unknown as Prisma;

    await auditFinancialStatementVersions(database);

    expect(queries[0]?.match(/SELECT endDate, announcementDate/g)).toHaveLength(3);
  });
  it('reports statement PIT violations separately from legacy indicator coverage', () => {
    expect(
      summarizeFinancialStatementVersions(
        {
          total: 300,
          invalidAnnouncementDate: 0,
          invalidAvailableDate: 1,
          invalidQuality: 0,
          invalidReportScope: 0,
        },
        {
          indicatorPeriods: 100,
          incomeMatches: 98,
          balanceMatches: 96,
          cashFlowMatches: 95,
        },
      ),
    ).toMatchObject({
      id: 'financial-statement-versions',
      status: 'error',
      summary: expect.stringContaining('1 invalid PIT or scope fields'),
    });

    expect(
      summarizeFinancialStatementVersions(
        {
          total: 300,
          invalidAnnouncementDate: 0,
          invalidAvailableDate: 0,
          invalidQuality: 0,
          invalidReportScope: 0,
        },
        {
          indicatorPeriods: 100,
          incomeMatches: 98,
          balanceMatches: 96,
          cashFlowMatches: 95,
        },
      ).status,
    ).toBe('pass');
  });
  it('reports non-positive source values as warnings while retaining clean and incomplete coverage statuses', () => {
    expect(
      summarizeFinancialStatementAccounting(
        { comparable: 100, mismatches: 0, anomalies: 0 },
        { comparable: 80, mismatches: 1, anomalies: 0 },
        { comparable: 60, mismatches: 0, anomalies: 0 },
        { totalPeriods: 100, completePeriods: 95 },
      ),
    ).toMatchObject({ id: 'financial-statement-accounting', status: 'pass' });

    expect(
      summarizeFinancialStatementAccounting(
        { comparable: 100, mismatches: 0, anomalies: 1 },
        { comparable: 80, mismatches: 0, anomalies: 0 },
        { comparable: 60, mismatches: 0, anomalies: 0 },
        { totalPeriods: 100, completePeriods: 95 },
      ).status,
    ).toBe('warn');

    expect(
      summarizeFinancialStatementAccounting(
        { comparable: 100, mismatches: 0, anomalies: 0 },
        { comparable: 80, mismatches: 0, anomalies: 0 },
        { comparable: 60, mismatches: 0, anomalies: 0 },
        { totalPeriods: 100, completePeriods: 70 },
      ).status,
    ).toBe('warn');
  });
  it('treats negative disclosure flags as review warnings rather than confirmed source errors', () => {
    const result = summarizeFinancialStatementAccounting(
      { comparable: 100, mismatches: 0, anomalies: 0, reviewFlags: 1 },
      { comparable: 80, mismatches: 0, anomalies: 0, reviewFlags: 2 },
      { comparable: 60, mismatches: 0, anomalies: 0 },
      { totalPeriods: 100, completePeriods: 95 },
    );
    expect(result.status).toBe('warn');
    expect(result.details.some((detail) => detail.includes('3 sign/subtotal review flags'))).toBe(
      true,
    );
    expect(result.details.some((detail) => detail.includes('not SDK-selected'))).toBe(true);
  });
});
