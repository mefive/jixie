import { prisma } from '../src/lib/prisma.js';
import { analyzeFactor } from '../src/factor/analysis.js';
import { FACTOR_CATALOG } from '../src/factor/factors.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

// CLI: monthly analysis of every catalog factor over the full history.
async function main(): Promise<void> {
  const t0 = Date.now();
  const [start = '20150101', end = '20261231', freq = 'month'] = process.argv.slice(2);
  const reports = [];
  for (const f of FACTOR_CATALOG) {
    reports.push(await analyzeFactor(f.key, freq === 'week' ? 'week' : 'month', start, end));
  }

  for (const r of reports) {
    console.log(`\n${'='.repeat(64)}`);
    console.log(
      `因子 ${r.factor}（${r.label}）  样本 ${r.periods} 个${r.freq === 'week' ? '周' : '月'}`,
    );
    console.log('-'.repeat(64));
    console.log(
      `Rank IC 均值 ${r.icMean.toFixed(4)} | IC标准差 ${r.icStd.toFixed(4)} | ` +
        `ICIR ${r.icir.toFixed(3)}（年化 ${r.icirAnnual.toFixed(2)}） | IC>0 占比 ${pct(r.icPosRate)}`,
    );
    console.log('\n  分位   年化收益    Sharpe   最大回撤   期末净值');
    for (const b of r.buckets) {
      const tag =
        b.bucket === 0
          ? 'D1(低)'
          : b.bucket === r.buckets.length - 1
            ? 'D10(高)'
            : `D${b.bucket + 1}`;
      console.log(
        `  ${tag.padEnd(7)} ${pct(b.annReturn).padStart(8)} ${b.sharpe.toFixed(2).padStart(8)} ` +
          `${pct(b.maxDrawdown).padStart(9)} ${b.navEnd.toFixed(3).padStart(9)}`,
      );
    }
    const ls = r.longShort;
    console.log(
      `\n  多空(D10−D1): 年化 ${pct(ls.annReturn)} | Sharpe ${ls.sharpe.toFixed(2)} | ` +
        `最大回撤 ${pct(ls.maxDrawdown)} | 期末净值 ${ls.navEnd.toFixed(3)}`,
    );
    console.log(`  最高分位单边换手(月均): ${pct(r.topTurnover)}`);
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(`✅ 因子分析完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('提示：IC 为负 = 因子反向有效（如反转/低波），可交易方向应取 D1−D10。');
  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ 因子分析失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
