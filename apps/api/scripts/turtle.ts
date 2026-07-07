import { prisma } from '../src/lib/prisma.js';
import { runStrategy } from '../src/engine/run.js';
import { turtleStrategy } from '../src/engine/strategies.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

/**
 * Turtle Trading event-driven backtest — System 1, long-only.
 * Usage: pnpm --filter api turtle [code1,code2,...]
 *   default: a diversified basket of liquid large caps (2015-2024).
 *
 * Demonstrates the engine running a second, very different archetype: a per-instrument, imperative,
 * OHLC + ATR + stop system — not a cross-sectional factor rebalance.
 */

// Liquid large caps across sectors (liquor/insurance/banking/appliances/pharma/utilities/brokerage/real-estate/building-materials/tech).
const DEFAULT_BASKET = [
  '600519.SH', // Kweichow Moutai
  '000858.SZ', // Wuliangye
  '601318.SH', // Ping An Insurance
  '600036.SH', // China Merchants Bank
  '000333.SZ', // Midea Group
  '600276.SH', // Hengrui Pharma
  '000651.SZ', // Gree Electric
  '600887.SH', // Yili
  '002415.SZ', // Hikvision
  '601166.SH', // Industrial Bank
  '600030.SH', // CITIC Securities
  '000002.SZ', // Vanke A
  '600585.SH', // Conch Cement
  '601398.SH', // ICBC
  '600900.SH', // China Yangtze Power
  '000001.SZ', // Ping An Bank
];

async function main(): Promise<void> {
  const arg = process.argv[2];
  const codes = arg ? arg.split(',').map((s) => s.trim()) : DEFAULT_BASKET;

  const strategy = turtleStrategy({ codes });

  const r = await runStrategy({
    start: '20150101',
    end: '20241231',
    initialCash: 1_000_000,
    strategy,
  });

  console.log(`\nStrategy ${r.name} (Turtle System 1, long-only)  ${codes.length} instruments`);
  console.log(`${r.start} ~ ${r.end}  (${r.days} trading days)`);
  console.log('-'.repeat(60));
  console.log(`Initial cash    ${r.initialCash.toLocaleString()}`);
  console.log(`Final equity    ${Math.round(r.finalValue).toLocaleString()}`);
  console.log(`Total return    ${pct(r.totalReturn)}`);
  console.log(`Annual return   ${pct(r.annReturn)}  (net of trading costs)`);
  console.log(`Sharpe          ${r.sharpe.toFixed(2)}`);
  console.log(`Max drawdown    ${pct(r.maxDrawdown)}`);
  console.log(`Trade count     ${r.trades}`);
  console.log(
    `\nRules: 20-day Donchian entry / 10-day exit, 20-day ATR position sizing (equal risk), 2N stop, ½N add up to 4 units.`,
  );
  console.log(
    `Simplifications: daily signal → next-day open fill, stop checked at close (not intraday), buy orders capped by cash (long-only, no leverage).`,
  );

  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ turtle failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
