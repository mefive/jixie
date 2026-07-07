import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { AgentTool } from './types.js';

/**
 * Read-only SQL over the market-data tables (design: docs/design/unified-agent.md, an explicit
 * relaxation of the tool principle; 2026-07-07 user decision: fully open read-only SQL, restricted
 * to specific tables, hard read-only at the connection layer). Guard layers, in order:
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
    'tsCode, symbol, name, area, industry, market, listDate, listStatus — stock list (listed only)',
  TradeCal: 'exchange, calDate, isOpen, pretradeDate — trading calendar (SSE)',
  Daily:
    'tsCode, tradeDate, open, high, low, close, preClose, pctChg(%), vol(手), amount(千元) — daily bars, unadjusted; tens-of-millions of rows, always filter by tradeDate or tsCode',
  AdjFactor:
    'tsCode, tradeDate, adjFactor — adjustment factor (after-adjustment price = close×adjFactor)',
  StkLimit: 'tsCode, tradeDate, upLimit, downLimit — daily up/down price limits (unadjusted)',
  TopList:
    'tsCode, tradeDate, netAmount(元) — Dragon-Tiger List net buy amount, sparse event table (no appearance that day = no row)',
  Moneyflow:
    'tsCode, tradeDate, netMain(万元), netTotal(万元) — per-stock moneyflow, sparse, exact per day, not forward-filled',
  DailyBasic:
    'tsCode, tradeDate, pe, peTtm, pb, ps, psTtm, dvRatio(%), dvTtm, totalMv(万元), circMv(万元), turnoverRate(%) — daily valuation snapshot',
  FinaIndicator:
    'tsCode, endDate(reporting period), annDate(announcement date), roe(%), roeWaa(%), roa(%), grossprofitMargin(%), netprofitMargin(%), debtToAssets(%), orYoy(revenue YoY, %), netprofitYoy(net profit attributable to parent, YoY, %), ocfToProfit(operating cash flow / operating profit) — financial indicators; PIT rule: values are only visible after annDate, so time-series analysis must gate on annDate to avoid look-ahead; column-expansion backfill in progress as of 2026-07, new columns may be partially NULL',
  Dividend:
    'id, tsCode, endDate, annDate, exDate(ex-dividend date), divProc, cashDiv(pre-tax per share), cashDivTax — dividend details; only divProc=「实施」(the "implemented" status) is an actual payout, exDate is the PIT gate',
  IndexWeight:
    'indexCode, conCode, tradeDate, weight — monthly index constituent snapshot (e.g. 000852.SH CSI 1000)',
  IndexDaily: 'tsCode, tradeDate, close — index daily bars (e.g. 000300.SH CSI 300)',
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
    throw new Error('Only a single statement is allowed (no semicolons)');
  }
  if (!/^\s*(select|with)\b/i.test(trimmed)) {
    throw new Error('Only SELECT queries are allowed (a WITH-prefixed CTE is fine)');
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    throw new Error(
      `Query contains a forbidden keyword (read-only): ${trimmed.match(FORBIDDEN_KEYWORDS)?.[0]}`,
    );
  }
  if (FORBIDDEN_NAMES.test(trimmed)) {
    throw new Error(
      `Access to ${trimmed.match(FORBIDDEN_NAMES)?.[0]} is not allowed (only market/financial data tables are exposed: ${Object.keys(SQL_TABLE_DOCS).join(', ')})`,
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
        `Table ${match[1]} is not in the whitelist. Queryable: ${Object.keys(SQL_TABLE_DOCS).join(', ')}`,
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
    throw new Error(`LIMIT max is ${declaredCap}; reduce it or aggregate first`);
  }
  return trimmed;
}

/** JSON.stringify replacer: SQLite integers come back as BigInt via the raw API. */
export function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

// —— worker host: persistent read-only SQL thread ——

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
        entry.reject(new Error(msg.error ?? 'SQL execution failed'));
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
  worker.on('exit', () => drop(new Error('SQL worker has exited')));
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
          `Query exceeded the ${QUERY_TIMEOUT_MS / 1000}s timeout; add conditions to narrow the range (filter large tables by tradeDate/tsCode)`,
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
    .describe(
      'a single SELECT statement (SQLite dialect); supports aggregation / GROUP BY / window functions / CTE',
    ),
});

/** Free-form (but guarded) SQL over the market tables — the escape hatch when runScreen's whitelist
 * spec can't express the question (aggregation, time series, fundamentals, joins). */
export const sqlQueryTool: AgentTool = {
  name: 'sqlQuery',
  description: `Run read-only SQL (SQLite dialect) over the local market/financial database. Good for needs runScreen can't express: statistical aggregation (mean / quantile / count), grouping by industry, historical time series, financials and dividends, multi-table JOINs.
Queryable tables and columns:
${Object.entries(SQL_TABLE_DOCS)
  .map(([table, doc]) => `- ${table}: ${doc}`)
  .join('\n')}
Conventions: dates are always 'YYYYMMDD' strings; suspended days have no rows; results are capped at ${SQL_ROW_CAP} rows (a LIMIT is auto-appended when absent), so prefer aggregating in SQL over pulling detail rows; Daily has tens-of-millions of rows and must be filtered by tradeDate or tsCode, otherwise it will time out.`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
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
