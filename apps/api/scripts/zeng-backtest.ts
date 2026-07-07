import { prisma } from '../src/lib/prisma.js';
import { runStrategy } from '../src/engine/run.js';
import { computeBuyDates, makeZengStrategy } from '../src/strategy/zeng.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

/**
 * Zeng Qinghui strategy backtest — Phase 1 breadth timing (CSI1800, full pattern, gate 30%) + Phase 2
 * quality/dividend/MA selection. Usage: pnpm --filter api zeng:backtest
 *
 * Capital 2,000,000 split into 20 units of 100,000; buy 1 unit per qualifier on each entry date,
 * exit on a MA20/MA90 death cross. Requires fina_indicator + dividend + index_weight synced.
 */
async function main(): Promise<void> {
  const start = '20150101';
  const end = '20241231';
  const indexCodes = ['000906.SH', '000852.SH']; // CSI1800

  console.log('Phase 1: computing buy_date (CSI1800, full pattern, gate 30%)…');
  const buyDates = await computeBuyDates({
    start,
    end,
    indexCodes,
    floor: 0.3,
    lookback: 0,
    minGap: 20,
  });
  console.log(`buy_date count ${buyDates.length}:`);
  for (const b of buyDates) {
    console.log(`  ${b.buyDate} → entry ${b.entryDate}  breadth ${pct(b.breadth)}`);
  }

  console.log('\nPhase 2: preloading financials + running backtest…');
  const strategy = await makeZengStrategy({ start, end, buyDates });
  const r = await runStrategy({ start, end, initialCash: 2_000_000, strategy });

  console.log(
    `\nStrategy ${r.name} (breadth timing + quality/high-dividend selection, MA death-cross exit)`,
  );
  console.log(`${r.start} ~ ${r.end}  (${r.days} trading days)`);
  console.log('-'.repeat(60));
  console.log(`Initial cash    ${r.initialCash.toLocaleString()}  (20 units × 100k)`);
  console.log(`Final equity    ${Math.round(r.finalValue).toLocaleString()}`);
  console.log(`Total return    ${pct(r.totalReturn)}`);
  console.log(`Annual return   ${pct(r.annReturn)}  (net of trading costs)`);
  console.log(`Sharpe          ${r.sharpe.toFixed(2)}`);
  console.log(`Max drawdown    ${pct(r.maxDrawdown)}`);
  console.log(`Trade count     ${r.trades}`);

  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ zeng:backtest failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
