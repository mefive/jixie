import { prisma } from '../src/lib/prisma.js';
import { computeBreadthSeries, selectBuyDates } from '../src/strategy/zeng.js';

/**
 * 曾庆辉 Phase 1 inspection. Usage: pnpm --filter api zeng:timing [codes] [gate]
 *   codes: comma-separated index codes (PIT union), or "all" for whole market.
 *          default 000906.SH,000852.SH = 中证1800. gate: breadth threshold, default 0.5.
 */
async function main(): Promise<void> {
  const t0 = Date.now();
  const arg = process.argv[2] ?? '000906.SH,000852.SH';
  const gate = Number(process.argv[3] ?? '0.5');
  const indexCodes = arg === 'all' ? undefined : arg.split(',').map((s) => s.trim());
  console.log(`广度口径：${indexCodes ? indexCodes.join(' ∪ ') : '全市场'}   门槛：${gate * 100}%`);

  const series = await computeBreadthSeries({
    start: '20150101',
    end: '20241231',
    n: 20,
    indexCodes,
  });
  const sorted = [...series.rows].sort((a, b) => b.breadth - a.breadth);

  const atLeast = (p: number) => series.rows.filter((x) => x.breadth >= p).length;
  console.log(`\n评估日数(≥100 只可评估) ${series.rows.length}`);
  console.table({
    '≥60%': atLeast(0.6),
    '≥50%': atLeast(0.5),
    '≥40%': atLeast(0.4),
    '≥30%': atLeast(0.3),
  });

  console.log('\n广度最高的 12 天:');
  for (const r of sorted.slice(0, 12)) {
    console.log(`  ${r.date}  ${(r.breadth * 100).toFixed(1)}%  ${r.satisfied}/${r.evaluable}`);
  }

  const buyDates = selectBuyDates(series, { floor: gate, lookback: 0, minGap: 20 });
  console.log(`\nbuy_date(广度 ≥ ${gate * 100}%，间隔≥20日去重):${buyDates.length} 个`);
  for (const b of buyDates) {
    console.log(`  ${b.buyDate} → 入场 ${b.entryDate}  广度 ${(b.breadth * 100).toFixed(1)}%`);
  }

  console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ zeng:timing 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
