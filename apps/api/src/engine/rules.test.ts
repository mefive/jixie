import { describe, expect, it } from 'vitest';
import { runStrategy } from './run.js';
import { fixturePort, type FixtureSpec } from './fixture-port.js';
import { DEFAULT_COST, type BarContext, type BacktestResult, type Strategy } from './types.js';

/**
 * A-share rule acceptance on a synthetic world (Phase B1): each rule that A-share backtests must
 * encode (CLAUDE.md list) gets a deterministic assertion against a five-bar fixture — no real DB.
 * The engine fills at NEXT day's open, so an order issued on D1 executes at D2's open.
 */

const D = ['20240101', '20240102', '20240103', '20240104', '20240105'];

/** A scripted per-instrument strategy: run the given action on each date it appears. */
function scripted(actions: Record<string, (ctx: BarContext) => void>, watch = ['A']): Strategy {
  return {
    name: 'scripted',
    watch,
    onBar(ctx) {
      actions[ctx.date]?.(ctx);
    },
  };
}

function run(spec: FixtureSpec, strategy: Strategy, cash = 100_000): Promise<BacktestResult> {
  return runStrategy({
    start: D[0],
    end: D[D.length - 1],
    initialCash: cash,
    strategy,
    dataPort: fixturePort(spec),
    // Zero slippage keeps price assertions exact; the slippage test overrides this.
    cost: { slippageBps: 0, impactCoef: 0 },
  });
}

/** Flat 10-yuan stock across all five days (limits far away). */
function flatStock(
  overrides: Partial<Record<string, Partial<FixtureSpec['stocks'][0]['bars'][0]>>> = {},
) {
  return {
    code: 'A',
    bars: D.map((date) => ({
      date,
      open: 10,
      close: 10,
      up: 11,
      down: 9,
      ...(overrides[date] ?? {}),
    })),
  };
}

describe('A 股规则:成交与 T+1', () => {
  it('订单次日开盘成交(D1 下单 → D2 开盘价成交)', async () => {
    const result = await run(
      { dates: D, stocks: [flatStock({ '20240102': { open: 10.5 } })] },
      scripted({ '20240101': (ctx) => ctx.order('A', 100) }),
    );
    expect(result.trades).toBe(1);
    expect(result.tradeLog[0]).toMatchObject({ date: '20240102', side: 'buy', price: 10.5 });
  });

  it('T+1:同日先买(声明式调仓)后卖(指令单)被冻结拦下', async () => {
    // Both queue on D1 and both execute on D2: the rebalance buy fills first (frozen until D3),
    // then the imperative sell hits the freeze — a same-day round trip must not happen.
    const result = await run(
      { dates: D, stocks: [flatStock()] },
      scripted({
        '20240101': (ctx) => {
          ctx.setHoldings({ A: 0.5 });
          ctx.order('A', -100);
        },
      }),
    );
    expect(result.tradeLog.map((t) => t.side)).toEqual(['buy']); // the sell never filled
    const buyDate = result.tradeLog[0].date;
    expect(buyDate).toBe('20240102');
  });

  it('T+1 只冻结当日:昨日买入今日可卖', async () => {
    const result = await run(
      { dates: D, stocks: [flatStock()] },
      scripted({
        '20240101': (ctx) => ctx.order('A', 100), // fills D2
        '20240102': (ctx) => ctx.exit('A'), // fills D3 — bought D2, sold D3 = legal T+1
      }),
    );
    expect(result.tradeLog.map((t) => `${t.side}@${t.date}`)).toEqual([
      'buy@20240102',
      'sell@20240103',
    ]);
  });
});

describe('A 股规则:涨跌停', () => {
  it('涨停开盘不可买(且被拦订单不结转)', async () => {
    const result = await run(
      { dates: D, stocks: [flatStock({ '20240102': { open: 11, close: 11 } })] }, // D2 opens AT up-limit
      scripted({ '20240101': (ctx) => ctx.order('A', 100) }),
    );
    expect(result.trades).toBe(0); // blocked on D2, not carried to D3
  });

  it('跌停开盘不可卖', async () => {
    const result = await run(
      { dates: D, stocks: [flatStock({ '20240103': { open: 9, close: 9 } })] }, // D3 opens AT down-limit
      scripted({
        '20240101': (ctx) => ctx.order('A', 100), // fills D2
        '20240102': (ctx) => ctx.exit('A'), // would fill D3 — blocked at the down-limit open
      }),
    );
    expect(result.tradeLog.map((t) => t.side)).toEqual(['buy']);
  });
});

describe('A 股规则:整手与费用', () => {
  it('买入按整手(100 股)下取整,凑不足一手不成交', async () => {
    const lots = await run(
      { dates: D, stocks: [flatStock()] },
      scripted({ '20240101': (ctx) => ctx.order('A', 150) }),
    );
    expect(lots.tradeLog[0].realShares).toBe(100); // 150 → 1 lot

    const tooSmall = await run(
      { dates: D, stocks: [flatStock()] },
      scripted({ '20240101': (ctx) => ctx.order('A', 60) }),
    );
    expect(tooSmall.trades).toBe(0); // < 1 lot → no fill
  });

  it('费用:佣金(有最低)+ 仅卖出印花税 + 过户费,金额逐分一致', async () => {
    const result = await run(
      { dates: D, stocks: [flatStock()] },
      scripted({
        '20240101': (ctx) => ctx.order('A', 100), // buy 100 @10 = ¥1000
        '20240103': (ctx) => ctx.exit('A'), // sell 100 @10 on D4
      }),
    );
    const [buy, sell] = result.tradeLog;
    const value = 1000;
    const { commission, minCommission, stampDuty, transferFee } = DEFAULT_COST;
    expect(buy.fee).toBeCloseTo(
      Math.max(value * commission, minCommission) + value * transferFee,
      10,
    ); // no stamp duty on buys
    expect(sell.fee).toBeCloseTo(
      Math.max(value * commission, minCommission) + value * stampDuty + value * transferFee,
      10,
    );
  });
});

describe('A 股规则:停牌与滑点', () => {
  it('停牌日(无 bar)不成交,估值按前收携带', async () => {
    const suspended = {
      code: 'A',
      bars: D.filter((d) => d !== '20240102') // D2 suspended
        .map((date) => ({ date, open: 10, close: 10, up: 11, down: 9 })),
    };
    const result = await run(
      { dates: D, stocks: [suspended] },
      scripted({ '20240101': (ctx) => ctx.order('A', 100) }),
    );
    expect(result.trades).toBe(0); // D2 had no open → skipped, not carried
  });

  it('滑点方向:买价上浮、卖价下压(基础半价差,无成交额则无冲击项)', async () => {
    const result = await runStrategy({
      start: D[0],
      end: D[D.length - 1],
      initialCash: 100_000,
      strategy: scripted({
        '20240101': (ctx) => ctx.order('A', 100),
        '20240102': (ctx) => ctx.exit('A'),
      }),
      dataPort: fixturePort({ dates: D, stocks: [flatStock()] }),
      cost: { slippageBps: 20, impactCoef: 0 }, // 0.2% base, no impact term
    });
    const [buy, sell] = result.tradeLog;
    expect(buy.price).toBeCloseTo(10 * 1.002, 10);
    expect(sell.price).toBeCloseTo(10 * 0.998, 10);
  });
});
