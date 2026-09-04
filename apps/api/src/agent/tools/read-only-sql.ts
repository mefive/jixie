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
    'tsCode, symbol, name, area, industry, market, listDate, delistDate, listStatus(L/D/P/G) — complete stock master across listed, delisted, suspended-listing, and approved-but-not-yet-traded instruments',
  StockCodeChange:
    'oldTsCode, newTsCode, effectiveDate, source — exchange-confirmed security-code succession; market history is canonicalized to newTsCode',
  StockNameHistory:
    'tsCode, name, startDate, endDate(null=current), announcementDate, changeReason — point-in-time security-name spells; for date D use startDate<=D and (endDate is null or D<=endDate), and derive ST/risk-warning state from that historical name rather than today’s name',
  TradeCal: 'exchange, calDate, isOpen, pretradeDate — trading calendar (SSE)',
  Daily:
    'tsCode, tradeDate, open, high, low, close, preClose, pctChg(%), vol(手), amount(千元) — daily bars, unadjusted; tens-of-millions of rows, always filter by tradeDate or tsCode',
  AdjFactor:
    'tsCode, tradeDate, adjFactor — adjustment factor (after-adjustment price = close×adjFactor)',
  EtfBasic:
    'tsCode, name, fullName, indexCode, indexName, setupDate, listDate, delistDate, listStatus(L/P/D), exchange, managerName, custodianName, managementFee, fundType, etfType, sameDayTurnover, lotSize — ETF metadata across listed, pending, and delisted statuses',
  EtfDaily:
    'tsCode, tradeDate, open, high, low, close, preClose, pctChg(%), vol(lots), amount(thousand CNY) — ETF daily bars, unadjusted',
  EtfAdjFactor:
    'tsCode, tradeDate, adjFactor — ETF adjustment factor (after-adjustment price = close×adjFactor)',
  EtfShareSize:
    'tsCode, tradeDate(source exchange date), availableDate(first strictly later SSE session; mandatory PIT gate), totalShare(10,000 fund units), totalSize(CNY 10,000, nullable), nav(CNY per fund unit, nullable), close(CNY per traded unit, nullable), exchange, retrievedAt — latest-value ETF share/size history from Tushare; QDII rows can omit totalSize and nav, strict PIT research must filter availableDate<=decision date, and backfilled rows are not historical real-time vintages',
  YieldCurvePoint:
    'source, curveCode, curveName, curveType, tradeDate(source-market curve date), availableDate(first eligible SSE research date; mandatory PIT gate), termYears(years), yieldPct(%), retrievedAt — normalized sovereign and credit yield curves including mof_cgb_ytm, us_treasury_nominal, us_treasury_real, chinabond_cgb_ytm, chinabond_bank_aaa_ytm, and chinabond_cp_note_aaa_ytm; research must filter availableDate<=decision date; ChinaBond and US curves are first usable on the strictly later SSE session; a 10Y−2Y slope is (yieldPct10−yieldPct2)×100 bp, while a credit spread must subtract chinabond_cgb_ytm from the chosen AAA curve on the exact same tradeDate and termYears without interpolation',
  FxDaily:
    'tsCode(USDCNH.FXCM or USDHKD.FXCM), tradeDate(provider GMT date), availableDate(first strictly later SSE session; mandatory PIT gate), exchange(FXCM), bidOpen/bidClose/bidHigh/bidLow, askOpen/askClose/askHigh/askLow(quote currency per USD), tickQty, retrievedAt — raw daily FX quotes; derive each research close as (bidClose+askClose)/2 only after filtering availableDate<=decision date, derive HKD/CNH as USDCNH divided by USDHKD on the same availability date, and never use the same-calendar-day unfinished global FX bar for a China close signal',
  MacroSeries:
    'seriesKey, nameZh, nameEn, domain(growth/inflation/liquidity/credit/etc.), frequency(daily/monthly), unit(percent/index_point/100m_cny/trillion_cny), source, sourceApi, sourceField, defaultTransform, revisionPolicy, createdAt, updatedAt — canonical macro and money-market series catalog; join MacroObservation by seriesKey and preserve the declared unit, frequency, and revision policy',
  MacroObservation:
    'seriesKey, period(observation month YYYYMM or daily fixing YYYYMMDD), vintageDate(capture date YYYYMMDD), value, releaseDate(null when unavailable), availableDate(mandatory PIT gate), availabilityKind(official_schedule/published_intraday/conservative_lag), vintageKind(captured_as_available/latest_value_backfill), retrievedAt — macro observation vintages; Shibor is published at 11:00 and becomes usable for same-day close research, while strict PIT research must filter availableDate<=decision date AND vintageDate<=decision date, select the latest eligible vintage per series+period, and disclose latest_value_backfill because it is not a historical real-time vintage',
  MacroReleaseSchedule:
    'publishDate, title, publishMonth(calendar month containing the release), issuingOrg, dataApi, retrievedAt — raw official Chinese economic-data publication calendar; publishMonth is not the observation period and must be mapped with series-specific release rules',
  StkLimit: 'tsCode, tradeDate, upLimit, downLimit — daily up/down price limits (unadjusted)',
  TopList:
    'tsCode, tradeDate, netAmount(元) — Dragon-Tiger List net buy amount, sparse event table (no appearance that day = no row)',
  Moneyflow:
    'tsCode, tradeDate, netMain(万元), netTotal(万元) — per-stock moneyflow, sparse, exact per day, not forward-filled',
  DailyBasic:
    'tsCode, tradeDate, pe, peTtm, pb, ps, psTtm, dvRatio(%), dvTtm, totalMv(万元), circMv(万元), turnoverRate(%), turnoverRateF(% free-float) — daily valuation snapshot',
  FinaIndicator:
    'tsCode, endDate(reporting period), annDate(announcement date), roe(%), roeWaa(%), roa(%), grossprofitMargin(%), netprofitMargin(%), debtToAssets(%), orYoy(revenue YoY, %), netprofitYoy(net profit attributable to parent, YoY, %), ocfToProfit(operating cash flow / operating profit) — financial indicators; PIT rule: values are only visible after annDate, so time-series analysis must gate on annDate to avoid look-ahead; column-expansion backfill in progress as of 2026-07, new columns may be partially NULL',
  FinancialIncomeStatement:
    'id, source, contractVersion, tsCode, annDate, fAnnDate(actual announcement), endDate(reporting period), reportType(1 current consolidated / 4 adjusted comparative / 5 pre-adjustment comparative), compType(1 industrial), updateFlag(provider metadata only), observedAt, sourceRowFingerprint, announcementDate, availableDate(first strictly later SSE session), availabilityQuality(exact/conservative/reconstructed), evidenceSource, evidenceId, totalRevenue/revenue/operCost/operateProfit/totalProfit/incomeTax/nIncome/nIncomeAttrP/ebit/rdExp/finExpIntExp(CNY, cumulative YTD) — append-only statement versions; always gate on availableDate and exclude reconstructed rows for strict PIT research',
  FinancialBalanceSheet:
    'id, source, contractVersion, tsCode, annDate, fAnnDate, endDate, reportType, compType, updateFlag, observedAt, sourceRowFingerprint, announcementDate, availableDate, availabilityQuality, evidenceSource, evidenceId, moneyCap/tradAsset/notesReceiv/accountsReceiv/accountsReceivBill/othReceiv/othRcvTotal/inventories/prepayment/contractAssets/othCurAssets/totalCurAssets/fixAssets/fixAssetsTotal/cip/cipTotal/intanAssets/goodwill/deferTaxAssets/othNca/totalNca/totalAssets/notesPayable/acctPayable/accountsPay/advReceipts/contractLiab/payrollPayable/taxesPayable/othPayable/othPayTotal/stBorr/nonCurLiabDue1y/ltBorr/bondPayable/othCurLiab/totalCurLiab/othNcl/totalNcl/totalLiab/minorityInt/totalHldrEqyExcMinInt(CNY stock values), totalShare(shares) — append-only consolidated industrial balance-sheet versions; gate on availableDate',
  FinancialCashFlowStatement:
    'id, source, contractVersion, tsCode, annDate, fAnnDate, endDate, reportType, compType, updateFlag, observedAt, sourceRowFingerprint, announcementDate, availableDate, availabilityQuality, evidenceSource, evidenceId, nCashflowAct/cPayAcqConstFiolta/nCashflowInvAct/nCashFlowsFncAct/cPayDistDpcpIntExp/nIncrCashCashEqu/cCashEquBegPeriod/cCashEquEndPeriod/netProfit/deprFaCogaDpba/amortIntangAssets/freeCashflow(CNY, cumulative YTD) — append-only consolidated industrial cash-flow versions; gate on availableDate and treat vendor freeCashflow as a cross-check, not the platform definition',
  FinancialCorrectionEvidence:
    'id, source, sourceId, tsCode, publishedAt, publishedDate, title, documentUrl, affectedPeriods(JSON), sourceFingerprint, observedAt — cached public announcement evidence for a verified financial correction; search-title matches without PDF-verified affectedPeriods are not stored as exact evidence',
  Dividend:
    'id, tsCode, endDate, annDate, exDate(ex-dividend date), divProc, cashDiv(pre-tax per share), cashDivTax — dividend details; only divProc=「实施」(the "implemented" status) is an actual payout, exDate is the PIT gate',
  IndexWeight:
    'indexCode, conCode, tradeDate, weight — monthly index constituent snapshot (e.g. 000852.SH CSI 1000)',
  IndexDaily: 'tsCode, tradeDate, close — index daily bars (e.g. 000300.SH CSI 300)',
  MarketBenchmark:
    'id(stable platform benchmark id), provider, providerCode, nameZh/nameEn, market(CN/HK/US), currency(CNY/HKD/USD), timeZone, calendarId, observesDaylightSavingTime, returnType(price_return only), dataContractId, tradableProxyTsCode, tradableProxyKind — fixed cross-market research benchmark catalog; a benchmark is not tradable and its ETF proxy remains a separate instrument',
  MarketBenchmarkDaily:
    'benchmarkId, tradeDate(source-market session date), availableDate(China-close study clock), open/high/low/close/preClose/change/pctChange/swing/volume, retrievedAt — raw price-index bars; CN availableDate equals tradeDate, HK/US availableDate is the first strictly later SSE session; joins must use MarketBenchmark.id and research must never label these price indices total return',
  IndexDailyBasic:
    'tsCode, tradeDate, totalMv(yuan), floatMv(yuan), totalShare(shares), floatShare(shares), freeShare(shares), turnoverRate(%), turnoverRateF(% free-float), pe, peTtm, pb — provider-computed broad-market index daily valuation metrics; use only history available on or before the evaluated date when calculating valuation percentiles',
  IndexBenchmark:
    'tsCode, symbol, name, fullName, bmkLevel, bmkType, bmkSource, indexType — official public-fund benchmark catalog from Tushare mkt_idx_bmk; use indexType/bmkType rather than inferring index categories from names',
  SwIndexDaily:
    'tsCode, tradeDate, name, open, low, high, close, change, pctChange(%), volume(10k shares), amount(10k CNY), pe, pb, floatMv(10k CNY), totalMv(10k CNY) — official Shenwan SW2021 level-1 industry index daily bars only; calculate valuation percentiles within the same industry over history',
  MarketIndicator:
    'tradeDate, tradedCount, return20(decimal), advanceRatio(0..1), aboveMa20Ratio(0..1), aboveMa60Ratio(0..1), totalAmount(thousand CNY), floatWeightedTurnoverRate(%), topFivePercentAmountShare(0..1), extremeMoveRatio(0..1), limitUpCount, limitDownCount — precomputed descriptive whole-market state',
  IndexIndicator:
    'indexCode, tradeDate, membershipDate(latest point-in-time constituent snapshot on or before tradeDate), tradedCount, return20(decimal official-index 20-day close return), advanceRatio(0..1), aboveMa20Ratio(0..1), aboveMa60Ratio(0..1), totalAmount(thousand CNY), floatWeightedTurnoverRate(% weighted by official constituent weights), peTtm/pb(constituent-derived harmonic valuation proxies, not official index metrics), valuationCoverage(0..1 share of constituent weight with usable valuation), topFivePercentAmountShare(0..1 within index universe), extremeMoveRatio(0..1), limitUpCount, limitDownCount — precomputed descriptive state for historical index constituents',
  IndustryIndicator:
    'l1Code, l1Name, tradeDate, tradedCount, return20(decimal), excessReturn20(decimal vs whole-market equal-weight return), positiveReturn20Ratio(0..1), aboveMa20Ratio(0..1), aboveMa60Ratio(0..1), floatWeightedTurnoverRate(%), amountShare(0..1 of whole market), topFiveAmountShare(0..1 within industry) — point-in-time Shenwan level-1 state',
  FutureContract:
    'tsCode(actual contract, e.g. IF2509.CFX or AU2512.SHF), symbol, productCode, name, exchange, multiplier(contract multiplier; may be NULL when the provider omits it for research-only commodities), tradeUnit, perUnit, quoteUnit, quoteUnitDesc, deliveryMode, listDate, delistDate, deliveryMonth, lastDeliveryDate, tradeTimeDesc — actual delivery-month futures metadata; only IF/IH/IC/IM with a valid multiplier are trading-enabled, configured commodity products are research-only, and continuous symbols are not actual contracts',
  FutureDaily:
    'tsCode, tradeDate, preClose, preSettle, open, high, low, close, settle, changeClose(close-preSettle), changeSettle(settle-preSettle), volume(contracts), amount(10k CNY), openInterest(contracts), openInterestChange, deliverySettle — raw daily bars for actual futures contracts; price units follow FutureContract metadata, use settle for curve research and stock-index variation-margin calculations',
  CommodityWarehouseReceipt:
    'productCode(AU/CU/SC/M), tradeDate(exchange report date), availableDate(next SSE trading day after the after-close report), sourceName, sourceUnit(provider label; NULL only for rows persisted before provenance capture), unit(unit-stratified aggregate: AU kg, CU tonnes, SC barrels or tonnes, M lots), unitCorrectionApplied(exact audited AU anomaly registry was used), volume(sum of physical warehouse rows within the same unit), volumeChange(sum of provider changes when complete, otherwise NULL), sourceRowCount, retrievedAt — research-only warehouse-receipt aggregates keyed by product/date/unit; subtotal rows and CU bonded-copper rows are excluded, SC barrel/tonne totals must not be added without a documented conversion, and absolute levels must never be ranked across unlike units',
  CommodityHoldingPosition:
    'version, source(tushare_fut_holding), productCode(AU/CU/M; SC unavailable), tradeDate(exchange report date), availableDate(next SSE session; mandatory PIT gate), exchange, referenceContract(actual contract selected by maximum open interest), sourceSymbol, selectionMethod(max_open_interest_v1), contractOpenInterest/contractVolume, rankedVolume/rankedVolumeChange, rankedLongHolding/rankedLongChange, rankedShortHolding/rankedShortChange, topFiveLongHolding/topFiveShortHolding, volumeMemberCount/longMemberCount/shortMemberCount, sourceRowCount, excludedSummaryRowCount, sourceCorrectionApplied, retrievedAt — each metric is an exchange-published ranked-member subset, not a whole-market position; early SHFE category-total rows are excluded and counted separately to prevent double counting; the exact audited M 20201106 doubled source values are divided by two and flagged; derive ranked net=(rankedLongHolding-rankedShortHolding), long concentration=rankedLongHolding/contractOpenInterest, and top-five concentration=topFiveLongHolding/rankedLongHolding only after filtering availableDate<=decision date',
  CommodityContinuousReturn:
    'version, source(tushare_fut_mapping+fut_daily), productCode(AU/CU/SC/M), tradeDate, availableDate(next SSE session; mandatory PIT gate), continuousCode(vendor main contract: AU.SHF/CU.SHF/SC.INE/M.DCE), mappingMethod, mappedContract, previousTradeDate, previousMappedContract, settlement(current mapped contract today), sameContractPreviousSettlement(current mapped contract on previous date), previousMappedSettlement(previous mapped contract on previous date), continuousReturn/continuousLogReturn(same-contract movement), mappedLogReturn(raw switched-code movement), rollGapLogReturn(removed contract-switch basis), rollYieldProxy=-rollGapLogReturn, mappingChanged, retrievedAt — exact identity mappedLogReturn=continuousLogReturn+rollGapLogReturn; use continuousReturn as the non-tradable research market driver, and never label rollYieldProxy as realized P&L',
  FutureMapping:
    'continuousCode(e.g. IF.CFX or AU.SHF), tradeDate, mappedTsCode(actual delivery contract) — point-in-time vendor main/continuous mapping; only stock-index mappings are trading-enabled and their fills must use mappedTsCode; commodity mappings are research-only and are audited through CommodityContinuousReturn',
  FutureSettlement:
    'tsCode, tradeDate, settle, tradingFeeRate, tradingFee, deliveryFee, buyHedgeMarginRate, sellHedgeMarginRate, longMarginRate, shortMarginRate, closeTodayFee, exchange — historical exchange settlement parameters; margin rates are source percentage points (12 means 12%); broker margin add-ons are not included',
  SwIndustryMember:
    'tsCode, l1Code, l1Name(Shenwan SW2021 level-1 industry, e.g. 食品饮料), inDate, outDate(null = current) — point-in-time industry membership; a stock belongs to l1Name from inDate up to (excluding) outDate, and may have several spells (it moved industries). For a date D pick the spell where inDate<=D and (outDate is null or D<outDate)',
};

const ALLOWED_TABLES = new Set(Object.keys(SQL_TABLE_DOCS).map((name) => name.toLowerCase()));

/** Statement-level write/DDL barrier — any of these words anywhere rejects the query (string-literal
 * false positives are acceptable: the model just rephrases). */
const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|replace|drop|alter|create|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint|trigger)\b/i;

/** App tables and SQLite internals — belt-and-suspenders on top of the FROM/JOIN whitelist. */
const FORBIDDEN_NAMES =
  /\b(user|session|invitecode|emailloginchallenge|strategy|factor|factorreport|job|sqlite_master|sqlite_temp_master|sqlite_sequence)\b/i;

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

/** Free-form (but guarded) SQL over market tables for non-Research profiles when registered specs
 * spec can't express the question (aggregation, time series, fundamentals, joins). */
export const sqlQueryTool: AgentTool = {
  name: 'sqlQuery',
  description: `Run read-only SQL (SQLite dialect) over the local market/financial database. Good for statistical aggregation (mean / quantile / count), grouping by industry, historical time series, financials and dividends, and multi-table JOINs outside the stable Research data catalog.
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
