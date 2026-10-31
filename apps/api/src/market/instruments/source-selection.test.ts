import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { mergeStockSource, preferStockSources } from './source-selection.js';
import {
  canonicalStockCode,
  normalizeStockNameSpells,
  STOCK_CODE_CHANGES,
} from './stock-identity.js';

const oldCode = '000022.SZ';
const newCode = '001872.SZ';

describe('stock source contracts', () => {
  it.each(STOCK_CODE_CHANGES)('selects only confirmed successors: $newTsCode', (change) => {
    const rows = [change.oldTsCode, change.newTsCode, change.newTsCode];
    expect(preferStockSources(rows, canonicalStockCode, (code) => code)).toEqual([
      change.newTsCode,
      change.newTsCode,
    ]);
    expect(
      preferStockSources(['000001.SZ', '000002.SZ'], canonicalStockCode, (code) => code),
    ).toEqual(['000001.SZ', '000002.SZ']);
  });

  it('never mixes fields from different origins, including omitted fields and zero', () => {
    const before = { tsCode: newCode, sourceTsCode: oldCode, pe: 10, pb: 2, dvRatio: 3 };
    const after = mergeStockSource(before, {
      values: { tsCode: newCode, sourceTsCode: newCode, pe: 0, pb: null },
    });
    expect(after).toEqual({
      tsCode: newCode,
      sourceTsCode: newCode,
      pe: 0,
      pb: null,
      dvRatio: null,
    });
    expect(mergeStockSource(after, { values: before })).toBe(after);
    expect(mergeStockSource(before, { values: { ...before, pb: null } }).pb).toBe(2);
  });

  it.each([false, true])(
    'resolves name duplicates independently of input order: %s',
    (reversed) => {
      const old = { tsCode: oldCode, name: 'old', startDate: '20180101', endDate: null };
      const current = { ...old, tsCode: newCode, name: 'new' };
      const rows = reversed ? [current, old] : [old, current];
      expect(normalizeStockNameSpells(rows)).toEqual([current]);
      expect(
        normalizeStockNameSpells([old, { ...old, name: 'obsolete conflict' }, current]),
      ).toEqual([current]);
      expect(() => normalizeStockNameSpells([current, { ...current, name: 'conflict' }])).toThrow(
        'Conflicting',
      );
    },
  );

  it('adds nullable provenance to ten tables without changing existing rows', async () => {
    const sql = await readFile(
      new URL(
        '../../../prisma/migrations/20261030123000_stock_source_selection/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const tables = [
      'Daily',
      'AdjFactor',
      'DailyBasic',
      'StkLimit',
      'StockNameHistory',
      'Dividend',
      'FinancialIncomeStatement',
      'FinancialBalanceSheet',
      'FinancialCashFlowStatement',
      'IndexWeight',
    ];
    const database = new DatabaseSync(':memory:');
    try {
      for (const table of tables) {
        database.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, value REAL)`);
        database.prepare(`INSERT INTO "${table}" VALUES (?, ?)`).run('retained', 0);
      }
      database.exec(sql);
      for (const table of tables) {
        expect(database.prepare(`SELECT * FROM "${table}"`).get()).toEqual({
          id: 'retained',
          value: 0,
          sourceTsCode: null,
        });
      }
    } finally {
      database.close();
    }
  });
});
