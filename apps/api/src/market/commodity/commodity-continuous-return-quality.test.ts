import { describe, expect, it } from 'vitest';
import type { Prisma } from '#infra/database/prisma.js';
import { buildCommodityContinuousReturns } from './commodity-continuous-returns.js';
import { auditCommodityContinuousReturns } from './commodity-continuous-return-quality.js';
import { COMMODITY_MAIN_CONTRACT_SPECS } from './commodity-futures.js';

describe('commodity continuous-return audit identity', () => {
  it('keeps mapped return equal to continuous movement plus the removed roll gap', () => {
    const [point] = buildCommodityContinuousReturns(
      [
        {
          productCode: 'CU',
          continuousCode: 'CU.SHF',
          tradeDate: '20260701',
          mappedContract: 'CU2608.SHF',
        },
        {
          productCode: 'CU',
          continuousCode: 'CU.SHF',
          tradeDate: '20260702',
          mappedContract: 'CU2609.SHF',
        },
      ],
      [
        { tsCode: 'CU2608.SHF', tradeDate: '20260701', settle: 80_000 },
        { tsCode: 'CU2609.SHF', tradeDate: '20260701', settle: 80_300 },
        { tsCode: 'CU2609.SHF', tradeDate: '20260702', settle: 80_100 },
      ],
      ['20260703'],
    );

    expect(point!.mappedLogReturn).toBeCloseTo(
      point!.continuousLogReturn + point!.rollGapLogReturn,
      12,
    );
    expect(point!.rollYieldProxy).toBeCloseTo(-point!.rollGapLogReturn, 12);
  });
});

describe('continuous-return audit range boundaries', () => {
  it('counts a one-day return using the preceding session outside the audit range', async () => {
    const { database } = auditFixture();
    const result = await auditCommodityContinuousReturns(
      { startDate: '20260910', endDate: '20260910' },
      database,
    );

    expect(result.status).toBe('pass');
    expect(result.rows).toBe(4);
    expect(result.invalidRows).toBe(0);
    expect(result.products.every((product) => product.returnSourceCoverage === 1)).toBe(true);
  });

  it('never overstates complete multi-day coverage by omitting the first interval', async () => {
    const { database } = auditFixture();
    const result = await auditCommodityContinuousReturns(
      { startDate: '20260910', endDate: '20260911' },
      database,
    );

    expect(result.status).toBe('pass');
    expect(
      result.products.every(
        (product) => product.expectedReturns === 2 && product.returnSourceCoverage === 1,
      ),
    ).toBe(true);
  });

  it('still rejects missing preceding settlement data instead of accepting the stored return', async () => {
    const { database, bars } = auditFixture();
    bars.splice(
      bars.findIndex((bar) => bar.tsCode === 'AU2612.SHF' && bar.tradeDate === '20260909'),
      1,
    );
    const result = await auditCommodityContinuousReturns(
      { startDate: '20260910', endDate: '20260910' },
      database,
    );

    expect(result.status).toBe('error');
    expect(result.invalidRows).toBe(1);
    expect(
      result.products.find((product) => product.productCode === 'AU')?.returnSourceCoverage,
    ).toBe(0);
  });

  it('does not shrink the expected interval count when a mapping is missing', async () => {
    const { database, mappings } = auditFixture();
    mappings.splice(
      mappings.findIndex(
        (mapping) => mapping.continuousCode === 'AU.SHF' && mapping.tradeDate === '20260911',
      ),
      1,
    );
    const result = await auditCommodityContinuousReturns(
      { startDate: '20260910', endDate: '20260911' },
      database,
    );

    expect(result.status).toBe('error');
    expect(result.products.find((product) => product.productCode === 'AU')).toMatchObject({
      mappingCoverage: 0.5,
      returnSourceCoverage: 0.5,
    });
  });
});

/** 用真实收益计算和日期过滤隔离数据库 I/O。 / Isolate database I/O while retaining real return computation and date filtering. */
function auditFixture() {
  const dates = ['20260909', '20260910', '20260911'];
  const calendar = [...dates, '20260914'].map((calDate) => ({ calDate }));
  const mappings = COMMODITY_MAIN_CONTRACT_SPECS.flatMap((specification) =>
    dates.map((tradeDate) => ({
      continuousCode: specification.continuousCode,
      tradeDate,
      mappedTsCode: specification.continuousCode.replace('.', '2612.'),
    })),
  );
  const bars = mappings.map((mapping) => ({
    tsCode: mapping.mappedTsCode,
    tradeDate: mapping.tradeDate,
    settle: 100 + dates.indexOf(mapping.tradeDate),
  }));
  const stored = buildCommodityContinuousReturns(
    mappings.map((mapping) => ({
      productCode: COMMODITY_MAIN_CONTRACT_SPECS.find(
        (specification) => specification.continuousCode === mapping.continuousCode,
      )!.productCode,
      continuousCode: mapping.continuousCode,
      tradeDate: mapping.tradeDate,
      mappedContract: mapping.mappedTsCode,
    })),
    bars,
    calendar.map((row) => row.calDate),
  );
  type Bounds = { gt?: string; gte?: string; lt?: string; lte?: string };
  const contains = (date: string, bounds: Bounds) =>
    (!bounds.gt || date > bounds.gt) &&
    (!bounds.gte || date >= bounds.gte) &&
    (!bounds.lt || date < bounds.lt) &&
    (!bounds.lte || date <= bounds.lte);
  const database = {
    commodityContinuousReturn: {
      findMany: async ({ where }: { where: { tradeDate: Bounds } }) =>
        stored.filter((row) => contains(row.tradeDate, where.tradeDate)),
    },
    futureMapping: {
      findMany: async ({ where }: { where: { tradeDate: Bounds } }) =>
        mappings.filter((row) => contains(row.tradeDate, where.tradeDate)),
    },
    futureDaily: {
      findMany: async ({ where }: { where: { tradeDate: Bounds } }) =>
        bars.filter((row) => contains(row.tradeDate, where.tradeDate)),
    },
    tradeCal: {
      findMany: async ({ where }: { where: { calDate: Bounds } }) =>
        calendar.filter((row) => contains(row.calDate, where.calDate)),
      findFirst: async ({ where }: { where: { calDate: Bounds } }) =>
        calendar.filter((row) => contains(row.calDate, where.calDate)).at(-1) ?? null,
    },
  } as unknown as Prisma;

  return { database, bars, mappings };
}
