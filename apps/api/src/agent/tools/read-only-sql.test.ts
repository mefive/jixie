import { describe, expect, it } from 'vitest';
import { jsonSafe, prepareReadOnlySql, SQL_ROW_CAP } from './read-only-sql.js';

describe('prepareReadOnlySql', () => {
  it('auto-appends a row cap to a query with no LIMIT', () => {
    expect(prepareReadOnlySql('SELECT tsCode FROM DailyBasic WHERE pe < 10')).toBe(
      `SELECT tsCode FROM DailyBasic WHERE pe < 10 LIMIT ${SQL_ROW_CAP}`,
    );
  });

  it('keeps a compliant declared LIMIT (and strips a trailing semicolon)', () => {
    expect(prepareReadOnlySql('SELECT * FROM StockBasic LIMIT 20;')).toBe(
      'SELECT * FROM StockBasic LIMIT 20',
    );
  });

  it('accepts a WITH-prefixed CTE and whitelisted JOINs', () => {
    const sql = `WITH latest AS (SELECT MAX(tradeDate) AS d FROM DailyBasic)
      SELECT b.industry, AVG(d.pe) FROM DailyBasic d
      JOIN StockBasic b ON b.tsCode = d.tsCode
      JOIN latest ON d.tradeDate = latest.d
      GROUP BY b.industry`;
    expect(prepareReadOnlySql(sql)).toContain('GROUP BY b.industry');
  });

  it('rejects an oversized LIMIT', () => {
    expect(() => prepareReadOnlySql('SELECT * FROM Daily LIMIT 100000')).toThrow(/LIMIT max/);
  });

  it('rejects non-SELECT statements', () => {
    expect(() => prepareReadOnlySql('EXPLAIN QUERY PLAN SELECT 1')).toThrow(/Only SELECT/);
  });

  it('rejects multiple statements', () => {
    expect(() => prepareReadOnlySql('SELECT 1; SELECT 2')).toThrow(/semicolon/);
  });

  it('rejects write operations and DDL/PRAGMA keywords', () => {
    expect(() => prepareReadOnlySql("SELECT 1 WHERE 'x' = 'drop table'")).toThrow(
      /forbidden keyword/,
    );
    expect(() => prepareReadOnlySql('WITH x AS (SELECT 1) INSERT INTO Daily VALUES (1)')).toThrow(
      /forbidden keyword/,
    );
  });

  it('rejects app tables and SQLite internal tables', () => {
    expect(() => prepareReadOnlySql('SELECT * FROM Session')).toThrow(/is not allowed/);
    expect(() => prepareReadOnlySql('SELECT id FROM "User"')).toThrow(/is not allowed/);
    expect(() => prepareReadOnlySql('SELECT * FROM sqlite_master')).toThrow(/is not allowed/);
  });

  it('rejects FROM/JOIN targets outside the whitelist', () => {
    expect(() => prepareReadOnlySql('SELECT * FROM DailyBasic JOIN Unknown u ON 1=1')).toThrow(
      /not in the whitelist/,
    );
  });
});

describe('jsonSafe', () => {
  it('converts SQLite BigInt into Number for JSON serialization', () => {
    expect(JSON.stringify({ count: 42n }, jsonSafe)).toBe('{"count":42}');
  });
});
