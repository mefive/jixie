import { prisma } from '../src/lib/prisma.js';
import { runStrategy } from '../src/engine/run.js';
import { turtleStrategy } from '../src/engine/strategies.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

/**
 * Turtle Trading (海龟交易法则) event-driven backtest — System 1, long-only.
 * Usage: pnpm --filter api turtle [code1,code2,...]
 *   default: a diversified basket of liquid large caps (2015-2024).
 *
 * Demonstrates the engine running a second, very different archetype: a per-instrument, imperative,
 * OHLC + ATR + stop system — not a cross-sectional factor rebalance.
 */

// Liquid large caps across sectors (白酒/保险/银行/家电/医药/电力/券商/地产/建材/科技).
const DEFAULT_BASKET = [
  '600519.SH', // 贵州茅台
  '000858.SZ', // 五粮液
  '601318.SH', // 中国平安
  '600036.SH', // 招商银行
  '000333.SZ', // 美的集团
  '600276.SH', // 恒瑞医药
  '000651.SZ', // 格力电器
  '600887.SH', // 伊利股份
  '002415.SZ', // 海康威视
  '601166.SH', // 兴业银行
  '600030.SH', // 中信证券
  '000002.SZ', // 万科A
  '600585.SH', // 海螺水泥
  '601398.SH', // 工商银行
  '600900.SH', // 长江电力
  '000001.SZ', // 平安银行
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

  console.log(`\n策略 ${r.name}（海龟 System 1，只做多）  标的 ${codes.length} 只`);
  console.log(`${r.start} ~ ${r.end}  (${r.days} 个交易日)`);
  console.log('-'.repeat(60));
  console.log(`期初资金   ${r.initialCash.toLocaleString()}`);
  console.log(`期末权益   ${Math.round(r.finalValue).toLocaleString()}`);
  console.log(`累计收益   ${pct(r.totalReturn)}`);
  console.log(`年化收益   ${pct(r.annReturn)}  (已扣交易成本)`);
  console.log(`Sharpe     ${r.sharpe.toFixed(2)}`);
  console.log(`最大回撤   ${pct(r.maxDrawdown)}`);
  console.log(`成交笔数   ${r.trades}`);
  console.log(
    `\n规则：20日唐奇安入场 / 10日出场，20日 ATR 定仓(等风险)，2N 止损，½N 加仓至 4 unit。`,
  );
  console.log(`简化：日线信号→次日开盘成交、收盘判止损(非盘中)、买单按现金封顶(只做多不加杠杆)。`);

  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ turtle 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
