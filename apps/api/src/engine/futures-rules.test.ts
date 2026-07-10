import { describe, expect, it } from 'vitest';
import { fixturePort, type FixtureSpec } from './fixture-port.js';
import { runStrategy } from './run.js';
import type { BarContext, Strategy } from './types.js';

const DATES = ['20240102', '20240103', '20240104', '20240105'];

function futureSpec(mappingByDate: Record<string, string>): FixtureSpec {
  const actualCodes = ['IF2401.CFX', 'IF2402.CFX'];
  const prices: Record<string, Record<string, { open: number; settle: number }>> = {
    'IF2401.CFX': {
      '20240102': { open: 95, settle: 95 },
      '20240103': { open: 100, settle: 105 },
      '20240104': { open: 110, settle: 112 },
      '20240105': { open: 113, settle: 114 },
    },
    'IF2402.CFX': {
      '20240102': { open: 115, settle: 116 },
      '20240103': { open: 117, settle: 118 },
      '20240104': { open: 120, settle: 122 },
      '20240105': { open: 123, settle: 124 },
    },
  };
  return {
    dates: DATES,
    stocks: [],
    futureContracts: actualCodes.map((tsCode) => ({
      tsCode,
      productCode: 'IF',
      multiplier: 300,
      listDate: '20230101',
      delistDate: '20241231',
    })),
    futureDaily: actualCodes.flatMap((tsCode) =>
      DATES.map((tradeDate) => ({
        tsCode,
        tradeDate,
        open: prices[tsCode][tradeDate].open,
        high: prices[tsCode][tradeDate].open + 2,
        low: prices[tsCode][tradeDate].open - 2,
        close: prices[tsCode][tradeDate].settle,
        settle: prices[tsCode][tradeDate].settle,
        volume: 10_000,
        amount: 100_000,
        openInterest: 20_000,
      })),
    ),
    futureMappings: Object.entries(mappingByDate).map(([tradeDate, mappedTsCode]) => ({
      continuousCode: 'IF.CFX',
      tradeDate,
      mappedTsCode,
    })),
  };
}

function strategy(actions: Record<string, (context: BarContext) => void>): Strategy {
  return {
    name: 'future-scripted',
    futures: ['IF.CFX'],
    onBar(context) {
      actions[context.date]?.(context);
    },
  };
}

function run(spec: FixtureSpec, scriptedStrategy: Strategy, initialCash = 100_000) {
  return runStrategy({
    start: DATES[0],
    end: DATES.at(-1)!,
    initialCash,
    strategy: scriptedStrategy,
    dataPort: fixturePort(spec),
    cost: {
      commission: 0,
      minCommission: 0,
      stampDuty: 0,
      transferFee: 0,
      slippageBps: 0,
      impactCoef: 0,
      futureCommissionRate: 0,
      futureSlippageTicks: 0,
      futureMarginRate: 0.1,
    },
  });
}

describe('股指期货规则', () => {
  it('次日开盘成交并按结算价逐日盯市', async () => {
    const result = await run(
      futureSpec(Object.fromEntries(DATES.map((date) => [date, 'IF2401.CFX']))),
      strategy({
        '20240102': (context) => context.orderFuture('IF.CFX', 1),
        '20240103': (context) => context.exitFuture('IF.CFX'),
      }),
    );

    expect(result.tradeLog.map((trade) => `${trade.side}@${trade.date}`)).toEqual([
      'buy@20240103',
      'sell@20240104',
    ]);
    expect(result.nav.find((point) => point.date === '20240103')?.value).toBe(101_500);
    expect(result.finalValue).toBe(103_000);
    expect(result.tradeLog[0]).toMatchObject({
      assetType: 'future',
      actualCode: 'IF2401.CFX',
      contracts: 1,
      multiplier: 300,
    });
  });

  it('支持空头并正确计算空头结算盈亏', async () => {
    const spec = futureSpec(Object.fromEntries(DATES.map((date) => [date, 'IF2401.CFX'])));
    const row = spec.futureDaily?.find(
      (daily) => daily.tsCode === 'IF2401.CFX' && daily.tradeDate === '20240103',
    );
    if (row) {
      row.settle = 90;
    }

    const result = await run(
      spec,
      strategy({ '20240102': (context) => context.orderFuture('IF.CFX', -1) }),
    );

    expect(result.nav.find((point) => point.date === '20240103')?.value).toBe(103_000);
    expect(result.tradeLog[0].side).toBe('sell');
  });

  it('保证金不足时拒单且不结转', async () => {
    const result = await run(
      futureSpec(Object.fromEntries(DATES.map((date) => [date, 'IF2401.CFX']))),
      strategy({ '20240102': (context) => context.orderFuture('IF.CFX', 10) }),
      10_000,
    );

    expect(result.trades).toBe(0);
    expect(result.finalValue).toBe(10_000);
  });

  it('主力映射变化时平旧开新并计入两段盈亏', async () => {
    const result = await run(
      futureSpec({
        '20240102': 'IF2401.CFX',
        '20240103': 'IF2402.CFX',
        '20240104': 'IF2402.CFX',
        '20240105': 'IF2402.CFX',
      }),
      strategy({ '20240102': (context) => context.orderFuture('IF.CFX', 1) }),
    );

    expect(
      result.tradeLog.map((trade) => `${trade.side}:${trade.actualCode}@${trade.date}`),
    ).toEqual(['buy:IF2401.CFX@20240103', 'sell:IF2401.CFX@20240104', 'buy:IF2402.CFX@20240104']);
    expect(result.nav.find((point) => point.date === '20240104')?.value).toBe(103_600);
  });

  it('连续合约历史按换月价差后调整,不把换月跳空当收益', async () => {
    let observedHistory: number[] = [];
    await run(
      futureSpec({
        '20240102': 'IF2401.CFX',
        '20240103': 'IF2401.CFX',
        '20240104': 'IF2402.CFX',
        '20240105': 'IF2402.CFX',
      }),
      strategy({
        '20240104': (context) => {
          observedHistory = context.futureHistory('IF.CFX', 'settle', 3);
        },
      }),
    );

    // On the roll day the new contract settles at 122 and the old at 112: add the 10-point gap
    // to older observations, preserving real within-contract moves without a synthetic roll jump.
    expect(observedHistory).toEqual([105, 115, 122]);
  });

  it('映射仍指向到期合约时按昨日持仓量在最后交易日提前换月', async () => {
    const spec = futureSpec(Object.fromEntries(DATES.map((date) => [date, 'IF2401.CFX'])));
    const expiring = spec.futureContracts?.find((contract) => contract.tsCode === 'IF2401.CFX');
    if (expiring) {
      expiring.delistDate = '20240104';
    }

    const result = await run(
      spec,
      strategy({ '20240102': (context) => context.orderFuture('IF.CFX', 1) }),
    );

    expect(
      result.tradeLog.map((trade) => `${trade.side}:${trade.actualCode}@${trade.date}`),
    ).toEqual(['buy:IF2401.CFX@20240103', 'sell:IF2401.CFX@20240104', 'buy:IF2402.CFX@20240104']);
  });

  it('混合策略先成交股票,再按实际股票敞口建立期货对冲并合并净值', async () => {
    const spec = futureSpec(Object.fromEntries(DATES.map((date) => [date, 'IF2401.CFX'])));
    spec.stocks = [
      {
        code: 'AAA',
        bars: DATES.map((date, index) => ({
          date,
          open: index === 0 ? 10 : 10,
          close: index === 1 ? 11 : 10,
          amount: 1_000_000,
        })),
      },
    ];
    const hedgeDay = spec.futureDaily?.find(
      (daily) => daily.tsCode === 'IF2401.CFX' && daily.tradeDate === '20240103',
    );
    if (hedgeDay) {
      hedgeDay.settle = 90;
      hedgeDay.close = 90;
    }

    const result = await run(spec, {
      name: 'mixed-hedge',
      watch: ['AAA'],
      futures: ['IF.CFX'],
      accounts: { stock: { cashWeight: 0.8 }, futures: { cashWeight: 0.2 } },
      onBar(context) {
        if (context.date === DATES[0]) {
          context.setHoldings({ AAA: 1 });
          context.hedgeFuture('IF.CFX');
        } else if (context.date === DATES[1]) {
          context.exitFuture('IF.CFX');
        }
      },
    });

    expect(
      result.tradeLog.slice(0, 2).map((trade) => `${trade.assetType ?? 'stock'}:${trade.side}`),
    ).toEqual(['stock:buy', 'future:sell']);
    expect(result.tradeLog[0].realShares).toBe(8_000);
    expect(result.tradeLog[1].contracts).toBe(3);
    expect(result.nav.find((point) => point.date === '20240103')?.value).toBe(117_000);
    expect(result.sleeveNav?.find((point) => point.date === '20240103')).toEqual({
      date: '20240103',
      stockValue: 88_000,
      futureValue: 29_000,
      futureMargin: 8_100,
      stockGrossExposure: 88_000,
      futureNotional: -81_000,
      netExposure: 7_000,
    });
  });

  it('混合对冲使用股票子账户实际可成交市值,不会按组合总资金过度对冲', async () => {
    const spec = futureSpec(Object.fromEntries(DATES.map((date) => [date, 'IF2401.CFX'])));
    spec.stocks = [
      {
        code: 'AAA',
        bars: DATES.map((date) => ({ date, open: 10, close: 10, amount: 1_000_000 })),
      },
    ];
    const result = await run(spec, {
      name: 'filled-exposure',
      watch: ['AAA'],
      futures: ['IF.CFX'],
      accounts: { stock: { cashWeight: 0.4 }, futures: { cashWeight: 0.6 } },
      onBar(context) {
        if (context.date === DATES[0]) {
          context.setHoldings({ AAA: 1 });
          context.hedgeFuture('IF.CFX');
        }
      },
    });

    expect(result.tradeLog.find((trade) => trade.assetType === 'future')?.contracts).toBe(1);
  });
});
