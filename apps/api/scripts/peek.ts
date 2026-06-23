import { prisma } from '../src/lib/prisma.js';

/**
 * Inspect local store contents and verify the "daily bars + adjustment" read path (ORM).
 * Usage: pnpm peek [ts_code] [start] [end]
 */
async function main(): Promise<void> {
  const [tsCode = '000001.SZ', start = '20240101', end = '20240131'] = process.argv.slice(2);

  const [sb, tc, d, af] = await Promise.all([
    prisma.stockBasic.count(),
    prisma.tradeCal.count(),
    prisma.daily.count(),
    prisma.adjFactor.count(),
  ]);
  console.log('落库统计:');
  console.table({ stock_basic: sb, trade_cal: tc, daily: d, adj_factor: af });

  const px = await prisma.daily.findMany({
    where: { tsCode, tradeDate: { gte: start, lte: end } },
    orderBy: { tradeDate: 'asc' },
  });
  const adj = await prisma.adjFactor.findMany({
    where: { tsCode, tradeDate: { gte: start, lte: end } },
  });
  const adjMap = new Map(adj.map((a) => [a.tradeDate, a.adjFactor]));

  console.log(`\n${tsCode} 后复权收盘（最后 5 个交易日，${start} ~ ${end}）:`);
  console.table(
    px.slice(-5).map((r) => {
      const factor = adjMap.get(r.tradeDate) ?? 1;
      return {
        trade_date: r.tradeDate,
        close: r.close,
        adj_factor: factor,
        hfq_close: Number(((r.close ?? 0) * factor).toFixed(3)),
        pct_chg: r.pctChg,
      };
    }),
  );

  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('\n❌ peek 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
