import { describe, expect, it } from 'vitest';

import fixture from '../../scripts/fundamentals/fixtures/financial-source-versions.json';
import {
  FINANCIAL_STATEMENT_FIELDS,
  appendFinancialStatementSourceRows,
  financialSourceRowFingerprint,
  isV1IndustrialConsolidatedStatement,
  normalizeFinancialStatementSourceRow,
  resolveFinancialAvailability,
  type FinancialCorrectionEvidence,
  type FinancialStatementKind,
} from './source-contract.js';

const vendorRows = fixture.vendorEnrichment.rows.map((row) =>
  normalizeFinancialStatementSourceRow(
    fixture.vendorEnrichment.statementKind as FinancialStatementKind,
    row,
  ),
);
const correctionRows = fixture.officialCorrection.rows.map((row) =>
  normalizeFinancialStatementSourceRow(
    fixture.officialCorrection.statementKind as FinancialStatementKind,
    row,
  ),
);

describe('financial source contract', () => {
  it('creates a stable fingerprint independent of object key order', () => {
    const row = fixture.vendorEnrichment.rows[0]!;
    const reversed = Object.fromEntries(Object.entries(row).reverse());

    expect(financialSourceRowFingerprint('income', row)).toBe(
      financialSourceRowFingerprint('income', reversed),
    );
  });

  it('is idempotent for exact repeats and keeps a material update as a separate version', () => {
    const first = appendFinancialStatementSourceRows([], [vendorRows[0]!]);
    const repeated = appendFinancialStatementSourceRows(first, [vendorRows[0]!]);
    const revised = appendFinancialStatementSourceRows(repeated, [vendorRows[1]!]);

    expect(first).toHaveLength(1);
    expect(repeated).toHaveLength(1);
    expect(revised).toHaveLength(2);
    expect(revised.map((row) => row.updateFlag)).toEqual(['0', '1']);
    expect(revised[0]!.sourceRowFingerprint).not.toBe(revised[1]!.sourceRowFingerprint);
  });

  it('uses the next trading session and downgrades an undated material update', () => {
    const sessions = ['20230428', '20230504', '20230505'];
    const nextOpen = (date: string) => sessions.find((session) => session > date);

    expect(resolveFinancialAvailability(vendorRows[0]!, vendorRows, nextOpen)).toEqual({
      announcementDate: '20230429',
      availableDate: '20230504',
      quality: 'conservative',
      evidenceSource: 'tushare_statement',
    });
    expect(resolveFinancialAvailability(vendorRows[1]!, vendorRows, nextOpen)).toEqual({
      announcementDate: '20230429',
      availableDate: '20230504',
      quality: 'reconstructed',
      evidenceSource: 'tushare_statement',
    });
  });

  it('uses an official correction announcement to prove the revised availability date', () => {
    const sessions = ['20231030', '20240103', '20240104'];
    const nextOpen = (date: string) => sessions.find((session) => session > date);

    expect(
      resolveFinancialAvailability(correctionRows[1]!, correctionRows, nextOpen, [
        fixture.officialCorrection.evidence as FinancialCorrectionEvidence,
      ]),
    ).toEqual({
      announcementDate: '20240103',
      availableDate: '20240104',
      quality: 'exact',
      evidenceSource: 'cninfo_announcement',
      evidenceId: '1218790667',
    });
  });

  it('accepts only consolidated industrial statements for the V1 calculation path', () => {
    expect(isV1IndustrialConsolidatedStatement(vendorRows[0]!)).toBe(true);
    expect(
      isV1IndustrialConsolidatedStatement(
        normalizeFinancialStatementSourceRow('income', {
          ...fixture.vendorEnrichment.rows[0],
          report_type: '5',
        }),
      ),
    ).toBe(true);
    expect(
      isV1IndustrialConsolidatedStatement(
        normalizeFinancialStatementSourceRow('income', {
          ...fixture.vendorEnrichment.rows[0],
          ts_code: '000001.SZ',
          comp_type: '2',
        }),
      ),
    ).toBe(false);
  });

  it('freezes unique typed source fields with explicit units and period semantics', () => {
    const identities = FINANCIAL_STATEMENT_FIELDS.map(
      (field) => `${field.statementKind}:${field.sourceField}`,
    );

    expect(new Set(identities).size).toBe(identities.length);
    expect(FINANCIAL_STATEMENT_FIELDS).toContainEqual({
      statementKind: 'balance_sheet',
      sourceField: 'total_share',
      concept: 'issued_shares',
      unit: 'shares',
      periodSemantics: 'stock',
      nullable: true,
    });
    expect(
      FINANCIAL_STATEMENT_FIELDS.filter((field) => field.statementKind === 'cash_flow').every(
        (field) => field.periodSemantics === 'flow_ytd',
      ),
    ).toBe(true);
  });
});
