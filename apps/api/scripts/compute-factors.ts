import { prisma } from '../src/lib/prisma.js';
import { FACTORS } from '../src/factor/factors.js';

/**
 * Pre-compute factor values → FactorValue table.
 * Run (sync market data and run migrate first): pnpm --filter api factor:compute
 *
 * Rebalance date = last trading day of each month; for every stock, compute factors on each
 * rebalance date using backward-adjusted (hfq) prices "up to that day".
 * Computed across the whole market, no pre-filter (universe filtering happens in the backtest).
 * Clears the table before recomputing — idempotent.
 */

// Month-end trading days (last open day of each month)
async function getRebalanceDates(): Promise<string[]> {
  const cal = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1 },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const out: string[] = [];
  for (let i = 0; i < cal.length; i++) {
    const cur = cal[i].calDate;
    const next = cal[i + 1]?.calDate;
    if (!next || cur.slice(0, 6) !== next.slice(0, 6)) out.push(cur);
  }
  return out;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const rebalanceDates = await getRebalanceDates();
  const rebalanceSet = new Set(rebalanceDates);
  console.log(
    `调仓日 ${rebalanceDates.length} 个：${rebalanceDates[0]} ~ ${rebalanceDates.at(-1)}`,
  );

  const stocks = await prisma.daily.findMany({
    distinct: ['tsCode'],
    select: { tsCode: true },
    orderBy: { tsCode: 'asc' },
  });
  console.log(`股票 ${stocks.length} 只，开始计算因子…`);

  // List-date map: used to drop pre-IPO "phantom bars" (BSE 920xxx has pre-listing data with
  // sub-cent placeholder prices, which produces fake single-day moves like +20400%). stockBasic
  // only includes listed stocks; delisted stocks have no listDate, but their historical bars are
  // real, so keep them all (to avoid survivorship bias).
  const listDateMap = new Map(
    (await prisma.stockBasic.findMany({ select: { tsCode: true, listDate: true } })).map((s) => [
      s.tsCode,
      s.listDate,
    ]),
  );

  await prisma.factorValue.deleteMany({}); // full recompute — clear first

  let done = 0;
  let totalRows = 0;
  let buffer: { factor: string; tsCode: string; tradeDate: string; value: number }[] = [];
  const BATCH = 2000;

  const flush = async () => {
    if (!buffer.length) return;
    await prisma.factorValue.createMany({ data: buffer });
    totalRows += buffer.length;
    buffer = [];
  };

  for (const { tsCode } of stocks) {
    // Load this stock's backward-adjusted (hfq) close-price series (ascending by date)
    const [px, adj] = await Promise.all([
      prisma.daily.findMany({
        where: { tsCode },
        select: { tradeDate: true, close: true },
        orderBy: { tradeDate: 'asc' },
      }),
      prisma.adjFactor.findMany({
        where: { tsCode },
        select: { tradeDate: true, adjFactor: true },
        orderBy: { tradeDate: 'asc' },
      }),
    ]);
    const adjMap = new Map(adj.map((a) => [a.tradeDate, a.adjFactor]));

    const listDate = listDateMap.get(tsCode);
    const dates: string[] = [];
    const adjClose: number[] = [];
    let lastAdj: number | null = null; // carry forward last value when adjustment factor is missing, to avoid fake jumps (not ??1)
    for (const r of px) {
      if (r.close == null) continue;
      if (listDate && r.tradeDate < listDate) continue; // drop pre-IPO phantom bars
      const a = adjMap.get(r.tradeDate);
      if (a != null) lastAdj = a;
      if (lastAdj == null) continue; // no adjustment factor yet at the start — skip these dates
      dates.push(r.tradeDate);
      adjClose.push(r.close * lastAdj);
    }

    for (let end = 0; end < dates.length; end++) {
      if (!rebalanceSet.has(dates[end])) continue;
      for (const f of FACTORS) {
        const v = f.fn(adjClose, dates, end);
        if (v === null || !Number.isFinite(v)) continue;
        buffer.push({ factor: f.key, tsCode, tradeDate: dates[end], value: v });
      }
    }
    if (buffer.length >= BATCH) await flush();

    done++;
    if (done % 500 === 0) console.log(`  ${done}/${stocks.length} 只，已写 ${totalRows} 行`);
  }
  await flush();

  const took = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n✅ 因子计算完成，FactorValue 共 ${await prisma.factorValue.count()} 行，耗时 ${took}s`,
  );
  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ compute-factors 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
