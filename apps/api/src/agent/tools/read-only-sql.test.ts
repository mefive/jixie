import { describe, expect, it } from 'vitest';
import { jsonSafe, prepareReadOnlySql, SQL_ROW_CAP } from './read-only-sql.js';

describe('prepareReadOnlySql', () => {
  it('给无 LIMIT 的查询自动补行数上限', () => {
    expect(prepareReadOnlySql('SELECT tsCode FROM DailyBasic WHERE pe < 10')).toBe(
      `SELECT tsCode FROM DailyBasic WHERE pe < 10 LIMIT ${SQL_ROW_CAP}`,
    );
  });

  it('保留合规的自带 LIMIT(含末尾分号清理)', () => {
    expect(prepareReadOnlySql('SELECT * FROM StockBasic LIMIT 20;')).toBe(
      'SELECT * FROM StockBasic LIMIT 20',
    );
  });

  it('接受 WITH 开头的 CTE 和白名单 JOIN', () => {
    const sql = `WITH latest AS (SELECT MAX(tradeDate) AS d FROM DailyBasic)
      SELECT b.industry, AVG(d.pe) FROM DailyBasic d
      JOIN StockBasic b ON b.tsCode = d.tsCode
      JOIN latest ON d.tradeDate = latest.d
      GROUP BY b.industry`;
    expect(prepareReadOnlySql(sql)).toContain('GROUP BY b.industry');
  });

  it('拒绝超大 LIMIT', () => {
    expect(() => prepareReadOnlySql('SELECT * FROM Daily LIMIT 100000')).toThrow(/LIMIT max/);
  });

  it('拒绝非 SELECT 语句', () => {
    expect(() => prepareReadOnlySql('EXPLAIN QUERY PLAN SELECT 1')).toThrow(/Only SELECT/);
  });

  it('拒绝多语句', () => {
    expect(() => prepareReadOnlySql('SELECT 1; SELECT 2')).toThrow(/semicolon/);
  });

  it('拒绝写操作与 DDL/PRAGMA 关键字', () => {
    expect(() => prepareReadOnlySql("SELECT 1 WHERE 'x' = 'drop table'")).toThrow(
      /forbidden keyword/,
    );
    expect(() => prepareReadOnlySql('WITH x AS (SELECT 1) INSERT INTO Daily VALUES (1)')).toThrow(
      /forbidden keyword/,
    );
  });

  it('拒绝应用表与 SQLite 内部表', () => {
    expect(() => prepareReadOnlySql('SELECT * FROM Session')).toThrow(/is not allowed/);
    expect(() => prepareReadOnlySql('SELECT id FROM "User"')).toThrow(/is not allowed/);
    expect(() => prepareReadOnlySql('SELECT * FROM sqlite_master')).toThrow(/is not allowed/);
  });

  it('拒绝白名单之外的 FROM/JOIN 目标', () => {
    expect(() => prepareReadOnlySql('SELECT * FROM DailyBasic JOIN Unknown u ON 1=1')).toThrow(
      /not in the whitelist/,
    );
  });
});

describe('jsonSafe', () => {
  it('把 SQLite 返回的 BigInt 转成 Number 以便 JSON 序列化', () => {
    expect(JSON.stringify({ count: 42n }, jsonSafe)).toBe('{"count":42}');
  });
});
