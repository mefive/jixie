import { prisma } from '../src/lib/prisma.js';
import { computeBreadthSeries, selectBuyDates } from '../src/strategy/zeng.js';

/**
 * Zeng Qinghui Phase 1 inspection. Usage: pnpm --filter api zeng:timing [codes] [gate]
 *   codes: comma-separated index codes (PIT union), or "all" for whole market.
 *          default 000906.SH,000852.SH = CSI1800. gate: breadth threshold, default 0.5.
 */
async function main(): Promise<void> {
  const t0 = Date.now();
  const arg = process.argv[2] ?? '000906.SH,000852.SH';
  const gate = Number(process.argv[3] ?? '0.5');
  const indexCodes = arg === 'all' ? undefined : arg.split(',').map((s) => s.trim());
  console.log(
    `Breadth universe: ${indexCodes ? indexCodes.join(' ∪ ') : 'whole market'}   gate: ${gate * 100}%`,
  );

  const series = await computeBreadthSeries({
    start: '20150101',
    end: '20241231',
    n: 20,
    indexCodes,
  });
  const sorted = [...series.rows].sort((a, b) => b.breadth - a.breadth);

  const atLeast = (p: number) => series.rows.filter((x) => x.breadth >= p).length;
  console.log(`\nEvaluable days (≥100 evaluable stocks) ${series.rows.length}`);
  console.table({
    '≥60%': atLeast(0.6),
    '≥50%': atLeast(0.5),
    '≥40%': atLeast(0.4),
    '≥30%': atLeast(0.3),
  });

  console.log('\nTop 12 days by breadth:');
  for (const r of sorted.slice(0, 12)) {
    console.log(`  ${r.date}  ${(r.breadth * 100).toFixed(1)}%  ${r.satisfied}/${r.evaluable}`);
  }

  const buyDates = selectBuyDates(series, { floor: gate, lookback: 0, minGap: 20 });
  console.log(
    `\nbuy_date (breadth ≥ ${gate * 100}%, deduped with ≥20-day gap): ${buyDates.length}`,
  );
  for (const b of buyDates) {
    console.log(`  ${b.buyDate} → entry ${b.entryDate}  breadth ${(b.breadth * 100).toFixed(1)}%`);
  }

  console.log(`\nElapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ zeng:timing failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
