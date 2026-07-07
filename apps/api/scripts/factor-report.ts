import { prisma } from '../src/lib/prisma.js';
import { analyzeFactor } from '../src/factor/analysis.js';
import { BUILTIN_FACTORS, seedBuiltinFactors } from '../src/factor/builtin-factors.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

// CLI: monthly analysis of every catalog factor over the full history.
async function main(): Promise<void> {
  const t0 = Date.now();
  const [start = '20150101', end = '20261231', freq = 'month'] = process.argv.slice(2);
  await seedBuiltinFactors(); // presets run from their seeded code rows
  const reports = [];
  for (const f of BUILTIN_FACTORS) {
    reports.push(await analyzeFactor(f.key, freq === 'week' ? 'week' : 'month', start, end));
  }

  for (const r of reports) {
    console.log(`\n${'='.repeat(64)}`);
    console.log(
      `Factor ${r.factor} (${r.label})  sample ${r.periods} ${r.freq === 'week' ? 'weeks' : 'months'}`,
    );
    console.log('-'.repeat(64));
    console.log(
      `Rank IC mean ${r.icMean.toFixed(4)} | IC std ${r.icStd.toFixed(4)} | ` +
        `ICIR ${r.icir.toFixed(3)} (annualized ${r.icirAnnual.toFixed(2)}) | IC>0 rate ${pct(r.icPosRate)}`,
    );
    console.log('\n  Bucket   AnnReturn    Sharpe   MaxDrawdown   FinalNAV');
    for (const b of r.buckets) {
      const tag =
        b.bucket === 0
          ? 'D1(low)'
          : b.bucket === r.buckets.length - 1
            ? 'D10(high)'
            : `D${b.bucket + 1}`;
      console.log(
        `  ${tag.padEnd(7)} ${pct(b.annReturn).padStart(8)} ${b.sharpe.toFixed(2).padStart(8)} ` +
          `${pct(b.maxDrawdown).padStart(9)} ${b.navEnd.toFixed(3).padStart(9)}`,
      );
    }
    const ls = r.longShort;
    console.log(
      `\n  Long-short(D10−D1): annualized ${pct(ls.annReturn)} | Sharpe ${ls.sharpe.toFixed(2)} | ` +
        `max drawdown ${pct(ls.maxDrawdown)} | final NAV ${ls.navEnd.toFixed(3)}`,
    );
    console.log(`  Top bucket one-way turnover (monthly avg): ${pct(r.topTurnover)}`);
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(`✅ Factor analysis done, elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(
    'Note: negative IC = factor effective in reverse (e.g. reversal / low-volatility); tradable direction should be D1−D10.',
  );
  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ Factor analysis failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
