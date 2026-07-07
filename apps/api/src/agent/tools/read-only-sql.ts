import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { AgentTool } from './types.js';

/**
 * Read-only SQL over the market-data tables (设计:docs/design/unified-agent.md 工具原则的显式放宽,
 * 2026-07-07 用户拍板「只读 SQL 全打开、限特定表、连接层硬只读」). Guard layers, in order:
 *   1. single statement, must start with SELECT/WITH;
 *   2. no write/DDL/PRAGMA keywords anywhere (defense in depth);
 *   3. every FROM/JOIN target must be a whitelisted market table (app tables — User/Session/
 *      Strategy/… — hold credentials and private content and are NEVER exposed);
 *   4. row cap enforced via LIMIT;
 *   5. the HARD write barrier: execution happens in a persistent worker thread whose node:sqlite
 *      connection is opened readOnly (needs Node ≥22.13). The worker also keeps the sync sqlite
 *      API off the event loop, and gives the timeout teeth — a stuck scan is killed by
 *      worker.terminate() and the next query respawns the thread.
 */

/** Whitelisted tables with the column docs shown to the model (and to validation). */
export const SQL_TABLE_DOCS: Record<string, string> = {
  StockBasic:
    'tsCode, symbol, name, area, industry, market, listDate, listStatus — 股票列表(仅在市)',
  TradeCal: 'exchange, calDate, isOpen, pretradeDate — 交易日历(SSE)',
  Daily:
    'tsCode, tradeDate, open, high, low, close, preClose, pctChg(%), vol(手), amount(千元) — 日线不复权,千万行级,务必带 tradeDate 或 tsCode 条件',
  AdjFactor: 'tsCode, tradeDate, adjFactor — 复权因子(后复权价 = close×adjFactor)',
  StkLimit: 'tsCode, tradeDate, upLimit, downLimit — 每日涨跌停价(不复权)',
  TopList: 'tsCode, tradeDate, netAmount(元) — 龙虎榜净买入,稀疏事件表(当日无上榜=无行)',
  Moneyflow: 'tsCode, tradeDate, netMain(万元), netTotal(万元) — 个股资金流,稀疏,当日精确不前填',
  DailyBasic:
    'tsCode, tradeDate, pe, peTtm, pb, ps, psTtm, dvRatio(股息率%), dvTtm, totalMv(万元), circMv(万元), turnoverRate(%) — 每日估值快照',
  FinaIndicator:
    'tsCode, endDate(报告期), annDate(公告日), roe(%), roeWaa(%) — 财务指标;PIT 规则:值在 annDate 之后才可见,时序分析必须按 annDate 门控防未来函数',
  Dividend:
    'id, tsCode, endDate, annDate, exDate(除息日), divProc, cashDiv(税前每股), cashDivTax — 分红明细;只有 divProc=「实施」才是真派发,exDate 是 PIT 门',
  IndexWeight: 'indexCode, conCode, tradeDate, weight — 指数成分月度快照(如 000852.SH 中证1000)',
  IndexDaily: 'tsCode, tradeDate, close — 指数日线(000300.SH 沪深300 等)',
};

const ALLOWED_TABLES = new Set(Object.keys(SQL_TABLE_DOCS).map((name) => name.toLowerCase()));

/** Statement-level write/DDL barrier — any of these words anywhere rejects the query (string-literal
 * false positives are acceptable: the model just rephrases). */
const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|replace|drop|alter|create|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint|trigger)\b/i;

/** App tables and SQLite internals — belt-and-suspenders on top of the FROM/JOIN whitelist. */
const FORBIDDEN_NAMES =
  /\b(user|session|invitecode|emailloginchallenge|strategy|factor|savedscreen|screenconversation|factorreport|job|sqlite_master|sqlite_temp_master|sqlite_sequence)\b/i;

/** Hard cap on rows fetched from SQLite (the model additionally only sees OBSERVATION_ROW_CAP). */
export const SQL_ROW_CAP = 200;

/** When the query declares its own LIMIT we run it as-is — but cap what it may declare, so a huge
 * LIMIT can't pull millions of rows into memory. */
const DECLARED_LIMIT_CAP = 500;

const QUERY_TIMEOUT_MS = 10_000;

/** Validate + normalize a query, returning the SQL to actually execute. Throws human-readable
 * errors (they are fed back to the model as observations, so it can fix its own SQL). */
export function prepareReadOnlySql(sql: string, rowCap: number = SQL_ROW_CAP): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');

  if (trimmed.includes(';')) {
    throw new Error('只允许单条语句(不能包含分号)');
  }
  if (!/^\s*(select|with)\b/i.test(trimmed)) {
    throw new Error('只允许 SELECT 查询(可用 WITH 开头的 CTE)');
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    throw new Error(`查询包含被禁止的关键字(只读):${trimmed.match(FORBIDDEN_KEYWORDS)?.[0]}`);
  }
  if (FORBIDDEN_NAMES.test(trimmed)) {
    throw new Error(
      `不允许访问 ${trimmed.match(FORBIDDEN_NAMES)?.[0]}(仅开放行情/财务数据表:${Object.keys(SQL_TABLE_DOCS).join('、')})`,
    );
  }

  // Every FROM/JOIN target must be whitelisted; parenthesized subqueries are fine (their own
  // FROM clauses are caught by the same scan). Names defined by the query itself (`name AS (…)`,
  // i.e. CTEs) are legitimate targets too.
  const definedNames = new Set(
    [...trimmed.matchAll(/\b([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  for (const match of trimmed.matchAll(/\b(?:from|join)\s+[`"[]?([a-z_][a-z0-9_]*)[`"\]]?/gi)) {
    if (!ALLOWED_TABLES.has(match[1].toLowerCase()) && !definedNames.has(match[1].toLowerCase())) {
      throw new Error(
        `表 ${match[1]} 不在白名单内。可查:${Object.keys(SQL_TABLE_DOCS).join('、')}`,
      );
    }
  }

  // Row cap: queries without any LIMIT get one appended (safe after ORDER BY); queries that
  // declare LIMITs may keep them as long as none exceeds the cap (rejecting beats rewriting —
  // wrapping in a subquery would not guarantee ORDER BY preservation).
  const declaredLimits = [...trimmed.matchAll(/\blimit\s+(\d+)/gi)].map((m) => Number(m[1]));
  const declaredCap = Math.max(DECLARED_LIMIT_CAP, rowCap); // analysis callers pass larger caps
  if (!declaredLimits.length) {
    return `${trimmed} LIMIT ${rowCap}`;
  }
  if (declaredLimits.some((limit) => limit > declaredCap)) {
    throw new Error(`LIMIT 最大 ${declaredCap},请缩小或先聚合`);
  }
  return trimmed;
}

/** JSON.stringify replacer: SQLite integers come back as BigInt via the raw API. */
export function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

// —— worker host:持久只读 SQL 线程 ——

// Worker entry: dev (tsx) spawns the .mjs bootstrap; prod spawns the compiled .js.
const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./sql-worker.boot.mjs', import.meta.url)
  : new URL('./sql-worker.js', import.meta.url);

/** Prisma resolves a relative sqlite DATABASE_URL against the schema directory — mirror that. */
function databasePath(): string {
  const raw = (process.env.DATABASE_URL ?? 'file:./dev.db').replace(/^file:/, '');
  return raw.startsWith('/') ? raw : new URL(`../../../prisma/${raw}`, import.meta.url).pathname;
}

interface PendingQuery {
  resolve(rows: Record<string, unknown>[]): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

let sqlWorker: Worker | null = null;
let requestSeq = 0;
const pending = new Map<number, PendingQuery>();

function failAllPending(error: Error): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}

function ensureWorker(): Worker {
  if (sqlWorker) {
    return sqlWorker;
  }

  const worker = new Worker(workerUrl, { workerData: { dbPath: databasePath() } });
  worker.on(
    'message',
    (msg: { id: number; ok: boolean; rows?: Record<string, unknown>[]; error?: string }) => {
      const entry = pending.get(msg.id);
      if (!entry) {
        return; // timed out and already rejected
      }
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (pending.size === 0) {
        worker.unref();
      }
      if (msg.ok) {
        entry.resolve(msg.rows ?? []);
      } else {
        entry.reject(new Error(msg.error ?? 'SQL 执行失败'));
      }
    },
  );
  const drop = (error: Error) => {
    if (sqlWorker === worker) {
      sqlWorker = null;
    }
    failAllPending(error);
  };
  worker.on('error', (err) => drop(err));
  worker.on('exit', () => drop(new Error('SQL worker 已退出')));
  worker.unref(); // idle worker must not hold the process open (scripts / graceful shutdown)
  sqlWorker = worker;
  return worker;
}

/** Execute a validated read-only query in the worker with a hard wall-clock timeout. */
export async function runReadOnlySql(
  sql: string,
  rowCap?: number,
): Promise<Record<string, unknown>[]> {
  const prepared = prepareReadOnlySql(sql, rowCap);

  const worker = ensureWorker();
  const id = ++requestSeq;
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          `查询超过 ${QUERY_TIMEOUT_MS / 1000}s 超时,请加条件缩小范围(大表按 tradeDate/tsCode 过滤)`,
        ),
      );
      // The sync sqlite API can't be interrupted — kill the thread; the next query respawns it.
      if (sqlWorker === worker) {
        sqlWorker = null;
      }
      void worker.terminate();
    }, QUERY_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    worker.ref(); // hold the process open while a query is in flight
    worker.postMessage({ id, sql: prepared });
  });
}

const OBSERVATION_ROW_CAP = 50;

const argsSchema = z.object({
  sql: z
    .string()
    .min(8)
    .max(4000)
    .describe('单条 SELECT 语句(SQLite 方言),支持聚合/GROUP BY/窗口函数/CTE'),
});

/** Free-form (but guarded) SQL over the market tables — the escape hatch when runScreen's whitelist
 * spec can't express the question (aggregation, time series, fundamentals, joins). */
export const sqlQueryTool: AgentTool = {
  name: 'sqlQuery',
  description: `对本地行情/财务数据库执行只读 SQL(SQLite 方言)。适合 runScreen 表达不了的需求:统计聚合(均值/分位/计数)、按行业分组、历史时序、财务与分红、多表 JOIN。
可查表与列:
${Object.entries(SQL_TABLE_DOCS)
  .map(([table, doc]) => `- ${table}: ${doc}`)
  .join('\n')}
约定:日期一律 'YYYYMMDD' 字符串;停牌日无行;结果最多 ${SQL_ROW_CAP} 行(无 LIMIT 自动补),请尽量在 SQL 里聚合而不是拉明细;Daily 千万行级,必须带 tradeDate 或 tsCode 条件,否则会超时。`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数不合法:${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }

    const rows = await runReadOnlySql(parsed.data.sql);
    const observationRows = rows.slice(0, OBSERVATION_ROW_CAP);
    return {
      observation: JSON.stringify(
        { returned: rows.length, shown: observationRows.length, rows: observationRows },
        jsonSafe,
      ),
      rows: rows.length,
    };
  },
};
