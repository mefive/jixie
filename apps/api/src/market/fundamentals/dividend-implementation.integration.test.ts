import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, capturedAt } from '../../../tests/market-contract-fixtures.js';
import { withImportDiagnostics, type ImportDiagnostics } from '../synchronization/diagnostics.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';

const partition = {
  dataset: 'dividends',
  scope: '002326.SZ',
  startDate: '',
  endDate: '20181231',
};
const implementation = {
  ts_code: partition.scope,
  end_date: '20181231',
  ann_date: '20190429',
  div_proc: '实施',
  ex_date: '20190520',
  cash_div: 0.15,
  cash_div_tax: 0.15,
  base_date: '20181231',
  base_share: 100,
  stk_div: 0,
  stk_bo_rate: 0,
  stk_co_rate: 0,
  record_date: '20190517',
  pay_date: '20190520',
  imp_ann_date: '20190515',
  div_listdate: null,
};

it('filters every stage except exact implementation before checking identity, dates or amounts', async () =>
  withSyncDatabase(async (database) => {
    const rows = [
      '预披露',
      '预案',
      '股东大会通过',
      '未通过',
      '停止实施',
      '股东提议',
      '股东大会未通过',
      '其他',
      'unknown-stage',
      '实施 ',
      '',
      null,
      undefined,
      42,
    ].map((div_proc) => {
      const row: TushareRow = {
        ts_code: null,
        end_date: '20991231',
        ann_date: 'bad',
        record_date: 'bad',
        stk_div: -1,
      };
      if (div_proc !== undefined) {
        row.div_proc = div_proc;
      }

      return row;
    });
    const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
    const result = await withImportDiagnostics(diagnostics, () =>
      acceptSource(database, { call: async () => rows }, partition),
    );

    expect(result.prepared).toMatchObject({
      status: 'complete',
      errors: [],
      hasDeferredRecords: false,
      checks: { sourceRows: rows.length, excludedRows: rows.length, invalidRows: 0 },
    });
    expect(result.accepted).toMatchObject({ inserted: 0, rejected: 0, errors: [] });
    expect(diagnostics.issues).toEqual([]);
    expect(await database.dividend.count()).toBe(0);
  }));

it('filters conflicting proposals while retaining cash, shares and mixed implementations', async () =>
  withSyncDatabase(async (database) => {
    const proposal = { ...implementation, div_proc: '预案', ex_date: null };
    const rows = [
      proposal,
      { ...proposal, cash_div_tax: 1 },
      { ...proposal, div_proc: '预披露', ann_date: null },
      { ...proposal, div_proc: '未通过', cash_div_tax: 0.25 },
      implementation,
      {
        ...implementation,
        ann_date: '20190501',
        ex_date: '20190521',
        cash_div: 0,
        cash_div_tax: 0,
        stk_div: 0.12,
        stk_co_rate: 0.12,
        pay_date: null,
        div_listdate: '20190521',
      },
      {
        ...implementation,
        ann_date: '20190502',
        ex_date: '20190522',
        stk_div: 0.4,
        stk_bo_rate: 0.35,
        stk_co_rate: 0.05,
        div_listdate: '20190522',
      },
    ];
    const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
    const result = await withImportDiagnostics(diagnostics, () =>
      acceptSource(database, { call: async () => rows }, partition),
    );

    expect(result.prepared.checks).toMatchObject({ sourceRows: 7, excludedRows: 4 });
    expect(result.accepted).toMatchObject({ inserted: 3, rejected: 0, errors: [] });
    expect(diagnostics.issues).toEqual([]);
    const saved = await database.dividend.findMany({ orderBy: { annDate: 'asc' } });

    expect(saved).toMatchObject([
      { divProc: '实施', distributionKind: 'cash', cashDivTax: 0.15, stockDividend: 0 },
      { divProc: '实施', distributionKind: 'shares', cashDivTax: 0, stockDividend: 0.12 },
      { divProc: '实施', distributionKind: 'mixed', cashDivTax: 0.15, stockDividend: 0.4 },
    ]);
  }));

it.each(['预披露', '未通过', '股东提议', 'unknown-stage', null])(
  'filters future non-implementation periods without deferring the current target: %s',
  async (div_proc) =>
    withSyncDatabase(async (database) => {
      const future = {
        ...implementation,
        end_date: '20260630',
        ann_date: null,
        div_proc,
        ex_date: null,
        imp_ann_date: null,
      };
      const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
      const result = await withImportDiagnostics(diagnostics, () =>
        acceptSource(database, { call: async () => [future, implementation] }, partition),
      );

      expect(result.prepared).toMatchObject({
        status: 'complete',
        errors: [],
        hasDeferredRecords: false,
        checks: { sourceRows: 2, excludedRows: 1, invalidRows: 0 },
      });
      expect(result.accepted).toMatchObject({ inserted: 1, rejected: 0, errors: [] });
      expect(diagnostics.issues).toEqual([]);
      expect(await database.dividend.count()).toBe(1);
      expect(await database.dividend.findFirstOrThrow()).toMatchObject({
        endDate: implementation.end_date,
        divProc: '实施',
      });
    }),
);

it('limits full-history replacement to implementations and leaves legacy stages untouched', async () =>
  withSyncDatabase(async (database) => {
    const legacy = await database.dividend.create({
      data: {
        id: 'legacy-proposal',
        tsCode: partition.scope,
        endDate: implementation.end_date,
        annDate: implementation.ann_date,
        divProc: '预案',
        cashDivTax: 0.15,
        stockDividend: -1,
        observedAt: capturedAt,
      },
    });
    const unknown = await database.dividend.create({
      data: {
        id: 'legacy-unknown-stage',
        tsCode: partition.scope,
        endDate: implementation.end_date,
        observedAt: capturedAt,
      },
    });
    const result = await acceptSource(database, { call: async () => [implementation] }, partition);

    expect(result.accepted).toMatchObject({ inserted: 1, rejected: 0, deleted: 0 });
    expect(await database.dividend.findUnique({ where: { id: legacy.id } })).toEqual(legacy);
    expect(await database.dividend.findUnique({ where: { id: unknown.id } })).toEqual(unknown);

    const empty = await acceptSource(database, { call: async () => [] }, partition);

    expect(empty.accepted).toMatchObject({ inserted: 0, rejected: 0, deleted: 1 });
    expect(await database.dividend.count({ where: { divProc: '实施' } })).toBe(0);
    expect(await database.dividend.findUnique({ where: { id: legacy.id } })).toEqual(legacy);
    expect(await database.dividend.findUnique({ where: { id: unknown.id } })).toEqual(unknown);
  }));

it.each(['ann_date', 'imp_ann_date'] as const)(
  'filters earlier stages in %s slices while retaining other implementation dates',
  async (dateField) =>
    withSyncDatabase(async (database) => {
      await database.stockBasic.create({
        data: {
          tsCode: partition.scope,
          symbol: '002326',
          name: 'Fixture',
          exchange: 'SZSE',
          listStatus: 'L',
          listDate: '20080101',
        },
      });
      await acceptSource(database, { call: async () => [implementation] }, partition);
      const saved = await database.dividend.findFirstOrThrow();
      const next = {
        ...implementation,
        ann_date: '20190501',
        imp_ann_date: '20190516',
        ex_date: '20190521',
        pay_date: '20190521',
      };
      const date = next[dateField];
      const result = await acceptSource(
        database,
        {
          call: async () => [
            { div_proc: '预案', [dateField]: 'bad' },
            { ...next, div_proc: '股东大会通过', cash_div_tax: 1 },
            { div_proc: '预披露', [dateField]: 'bad', end_date: '20260630' },
            { ...next, div_proc: '未通过', cash_div_tax: null },
            { div_proc: '股东提议', [dateField]: 'bad', end_date: '20250630' },
            { div_proc: 'unknown-stage', [dateField]: null },
            { div_proc: null, [dateField]: 'bad' },
            next,
          ],
        },
        {
          dataset: 'dividends',
          scope: dateField,
          startDate: date,
          endDate: date,
          catalogThrough: '20191231',
        },
      );

      expect(result.prepared.checks).toMatchObject({ sourceRows: 8, excludedRows: 7 });
      expect(result.accepted).toMatchObject({ inserted: 1, rejected: 0, deleted: 0 });
      expect(await database.dividend.count()).toBe(2);
      expect(await database.dividend.findUnique({ where: { id: saved.id } })).toEqual(saved);
    }),
);

it.each([{ ts_code: '' }, { end_date: 'invalid' }, { record_date: 'invalid' }, { stk_div: -1 }])(
  'retains diagnostics for invalid implemented records: %j',
  async (invalidFields) =>
    withSyncDatabase(async (database) => {
      const row = { ...implementation, ...invalidFields };
      const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
      const result = await withImportDiagnostics(diagnostics, () =>
        acceptSource(database, { call: async () => [row] }, partition),
      );

      expect(result.prepared.errors.length).toBeGreaterThan(0);
      expect(result.prepared.checks.invalidRows).toBeGreaterThan(0);
      expect(await database.dividend.count()).toBe(0);
    }),
);
