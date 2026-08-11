import {
  MARKET_RISK_FACTOR_KEYS_V1,
  type MarketRiskFactorDefinitionV1,
  type MarketRiskFactorKeyV1,
  type RiskDataLineageV1,
} from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import { COMMODITY_MAIN_CONTRACT_SPECS } from '../commodity/commodity-futures.js';
import { CHINA_TREASURY_CURVE_CODE } from '../rates/china-treasury-curve.js';
import { CHINABOND_PUBLIC_CURVES } from '../rates/chinabond-credit-curves.js';
import { USD_CNH_CODE, US_REAL_CURVE_CODE } from '../rates/external-market-drivers.js';

export const MARKET_RISK_EQUITY_INDEX = '000300.SH';
export const MARKET_RISK_GOLD_PRODUCT = 'AU';
export const MARKET_RISK_COMMODITY_PRODUCTS = ['CU', 'SC', 'M'] as const;

const CREDIT_CURVE_CODES = {
  government: CHINABOND_PUBLIC_CURVES[0].curveCode,
  bank: CHINABOND_PUBLIC_CURVES[1].curveCode,
  corporate: CHINABOND_PUBLIC_CURVES[2].curveCode,
} as const;
const CREDIT_CURVE_CODE_SET = new Set<string>(Object.values(CREDIT_CURVE_CODES));
const MARKET_RISK_COMMODITY_PRODUCT_SET = new Set<string>(MARKET_RISK_COMMODITY_PRODUCTS);

export const MARKET_RISK_FACTOR_DEFINITIONS_V1: readonly MarketRiskFactorDefinitionV1[] = [
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'cn_equity',
    frequency: 'daily',
    unit: 'decimal_return',
    sourceSeries: [`IndexDaily:${MARKET_RISK_EQUITY_INDEX}`],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'cgb_level',
    frequency: 'daily',
    unit: 'basis_point_change',
    sourceSeries: [`YieldCurvePoint:${CHINA_TREASURY_CURVE_CODE}:10Y`],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'cgb_slope',
    frequency: 'daily',
    unit: 'basis_point_change',
    sourceSeries: [`YieldCurvePoint:${CHINA_TREASURY_CURVE_CODE}:10Y-2Y`],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'cgb_curvature',
    frequency: 'daily',
    unit: 'basis_point_change',
    sourceSeries: [`YieldCurvePoint:${CHINA_TREASURY_CURVE_CODE}:2*5Y-2Y-10Y`],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'credit_spread',
    frequency: 'daily',
    unit: 'basis_point_change',
    sourceSeries: [
      `YieldCurvePoint:${CREDIT_CURVE_CODES.government}:5Y`,
      `YieldCurvePoint:${CREDIT_CURVE_CODES.bank}:5Y`,
      `YieldCurvePoint:${CREDIT_CURVE_CODES.corporate}:5Y`,
    ],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'usd_cnh',
    frequency: 'daily',
    unit: 'decimal_return',
    sourceSeries: [`FxDaily:${USD_CNH_CODE}:midClose`],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'us_real_yield',
    frequency: 'daily',
    unit: 'basis_point_change',
    sourceSeries: [`YieldCurvePoint:${US_REAL_CURVE_CODE}:10Y`],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'gold',
    frequency: 'daily',
    unit: 'decimal_return',
    sourceSeries: [`CommodityContinuousReturn:${MARKET_RISK_GOLD_PRODUCT}`],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'market_risk_factor',
    key: 'commodity',
    frequency: 'daily',
    unit: 'decimal_return',
    sourceSeries: MARKET_RISK_COMMODITY_PRODUCTS.map(
      (productCode) => `CommodityContinuousReturn:${productCode}`,
    ),
    pointInTime: true,
  },
];

export interface MarketRiskIndexClose {
  tradeDate: string;
  close: number;
}

export interface MarketRiskCurvePoint {
  curveCode: string;
  tradeDate: string;
  availableDate: string;
  termYears: number;
  yieldPct: number;
}

export interface MarketRiskFxClose {
  tradeDate: string;
  availableDate: string;
  bidClose: number;
  askClose: number;
}

export interface MarketRiskCommodityReturn {
  productCode: string;
  tradeDate: string;
  availableDate: string;
  continuousReturn: number;
}

export interface MarketRiskDriverObservationV1 {
  date: string;
  values: Partial<Record<MarketRiskFactorKeyV1, number>>;
}

export interface MarketRiskDriverHistoryV1 {
  version: 1;
  definitions: readonly MarketRiskFactorDefinitionV1[];
  observations: MarketRiskDriverObservationV1[];
  lineage: RiskDataLineageV1;
}

export interface BuildMarketRiskDriverHistoryInput {
  dataCutoff: string;
  openDates: string[];
  indexRows: MarketRiskIndexClose[];
  curveRows: MarketRiskCurvePoint[];
  fxRows: MarketRiskFxClose[];
  commodityRows: MarketRiskCommodityReturn[];
}

/** Build non-revised daily drivers keyed by the first SSE session on which every value is usable. */
export function buildMarketRiskDriverHistory(
  input: BuildMarketRiskDriverHistoryInput,
): MarketRiskDriverHistoryV1 {
  assertDate(input.dataCutoff, 'market-risk data cutoff');
  const openDates = [...new Set(input.openDates)].sort();
  if (openDates.some((date) => !validDate(date))) {
    throw new Error('Market-risk open dates must be valid YYYYMMDD values.');
  }
  const valuesByFactor = emptyFactorMaps();

  buildPriceReturns(
    input.indexRows.map((row) => ({
      sourceDate: row.tradeDate,
      availableDate: nextOpenDate(row.tradeDate, openDates),
      value: row.close,
    })),
    valuesByFactor.cn_equity,
    'CSI 300 close',
  );

  const domesticCurveLevels = buildDomesticCurveLevels(input.curveRows);
  buildLevelChanges(domesticCurveLevels.level, valuesByFactor.cgb_level, 'CGB level');
  buildLevelChanges(domesticCurveLevels.slope, valuesByFactor.cgb_slope, 'CGB slope');
  buildLevelChanges(domesticCurveLevels.curvature, valuesByFactor.cgb_curvature, 'CGB curvature');
  buildLevelChanges(
    buildCreditSpreadLevels(input.curveRows),
    valuesByFactor.credit_spread,
    'credit spread',
  );

  buildPriceReturns(
    input.fxRows.map((row) => ({
      sourceDate: row.tradeDate,
      availableDate: row.availableDate,
      value: (row.bidClose + row.askClose) / 2,
    })),
    valuesByFactor.usd_cnh,
    'USD/CNH midpoint',
  );
  buildLevelChanges(
    input.curveRows
      .filter((row) => row.curveCode === US_REAL_CURVE_CODE && row.termYears === 10)
      .map((row) => ({
        sourceDate: row.tradeDate,
        availableDate: row.availableDate,
        value: row.yieldPct * 100,
      })),
    valuesByFactor.us_real_yield,
    'US 10Y real yield',
  );

  const commodityByProductDate = new Map<string, MarketRiskCommodityReturn>();
  for (const row of input.commodityRows) {
    validateAvailableObservation(row, `commodity return ${row.productCode}`);
    if (!Number.isFinite(row.continuousReturn)) {
      throw new Error(`Invalid commodity return ${row.productCode} ${row.tradeDate}.`);
    }
    const key = `${row.productCode}|${row.availableDate}`;
    if (commodityByProductDate.has(key)) {
      throw new Error(`Duplicate commodity return ${key}.`);
    }
    commodityByProductDate.set(key, row);
    if (row.productCode === MARKET_RISK_GOLD_PRODUCT) {
      valuesByFactor.gold.set(row.availableDate, row.continuousReturn);
    }
  }
  const commodityDates = new Set(
    input.commodityRows
      .filter((row) => MARKET_RISK_COMMODITY_PRODUCT_SET.has(row.productCode))
      .map((row) => row.availableDate),
  );
  for (const date of commodityDates) {
    const values = MARKET_RISK_COMMODITY_PRODUCTS.map(
      (productCode) => commodityByProductDate.get(`${productCode}|${date}`)?.continuousReturn,
    );
    if (values.every((value): value is number => value != null)) {
      valuesByFactor.commodity.set(
        date,
        values.reduce((sum, value) => sum + value, 0) / values.length,
      );
    }
  }

  const dates = new Set<string>();
  for (const values of Object.values(valuesByFactor)) {
    for (const date of values.keys()) {
      if (date <= input.dataCutoff) {
        dates.add(date);
      }
    }
  }
  const observations = [...dates].sort().map((date) => ({
    date,
    values: Object.fromEntries(
      MARKET_RISK_FACTOR_KEYS_V1.flatMap((factor) => {
        const value = valuesByFactor[factor].get(date);
        return value == null ? [] : [[factor, value]];
      }),
    ) as Partial<Record<MarketRiskFactorKeyV1, number>>,
  }));
  const lineageSeries = MARKET_RISK_FACTOR_KEYS_V1.map((factor) => {
    const availableThrough = [...valuesByFactor[factor].keys()]
      .filter((date) => date <= input.dataCutoff)
      .sort()
      .at(-1);
    if (!availableThrough) {
      throw new Error(`Market-risk driver ${factor} has no point-in-time observations.`);
    }
    return { seriesKey: factor, availableThrough, revisionPolicy: 'not_revised' as const };
  });
  return {
    version: 1,
    definitions: MARKET_RISK_FACTOR_DEFINITIONS_V1,
    observations,
    lineage: {
      dataCutoff: input.dataCutoff,
      pointInTimeEligible: true,
      futureVintageRows: 0,
      series: lineageSeries,
    },
  };
}

export async function loadMarketRiskDriverHistory(
  options: { startDate: string; endDate: string },
  database: Prisma = prisma,
): Promise<MarketRiskDriverHistoryV1> {
  assertDate(options.startDate, 'market-risk start');
  assertDate(options.endDate, 'market-risk end');
  if (options.startDate > options.endDate) {
    throw new Error('Market-risk startDate must not exceed endDate.');
  }
  const contextStart = addDays(options.startDate, -45);
  const curveCodes = [
    CHINA_TREASURY_CURVE_CODE,
    CREDIT_CURVE_CODES.government,
    CREDIT_CURVE_CODES.bank,
    CREDIT_CURVE_CODES.corporate,
    US_REAL_CURVE_CODE,
  ];
  const [indexRows, curveRows, fxRows, commodityRows, calendarRows] = await Promise.all([
    database.indexDaily.findMany({
      where: {
        tsCode: MARKET_RISK_EQUITY_INDEX,
        tradeDate: { gte: contextStart, lte: options.endDate },
      },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.yieldCurvePoint.findMany({
      where: {
        curveCode: { in: curveCodes },
        tradeDate: { gte: contextStart },
        availableDate: { lte: options.endDate },
        OR: [
          { curveCode: CHINA_TREASURY_CURVE_CODE, termYears: { in: [2, 5, 10] } },
          {
            curveCode: {
              in: [
                CREDIT_CURVE_CODES.government,
                CREDIT_CURVE_CODES.bank,
                CREDIT_CURVE_CODES.corporate,
              ],
            },
            termYears: 5,
          },
          { curveCode: US_REAL_CURVE_CODE, termYears: 10 },
        ],
      },
      select: {
        curveCode: true,
        tradeDate: true,
        availableDate: true,
        termYears: true,
        yieldPct: true,
      },
      orderBy: [{ tradeDate: 'asc' }, { curveCode: 'asc' }, { termYears: 'asc' }],
    }),
    database.fxDaily.findMany({
      where: {
        tsCode: USD_CNH_CODE,
        tradeDate: { gte: contextStart },
        availableDate: { lte: options.endDate },
      },
      select: {
        tradeDate: true,
        availableDate: true,
        bidClose: true,
        askClose: true,
      },
      orderBy: { tradeDate: 'asc' },
    }),
    database.commodityContinuousReturn.findMany({
      where: {
        productCode: {
          in: COMMODITY_MAIN_CONTRACT_SPECS.map((specification) => specification.productCode),
        },
        tradeDate: { gte: contextStart },
        availableDate: { lte: options.endDate },
      },
      select: {
        productCode: true,
        tradeDate: true,
        availableDate: true,
        continuousReturn: true,
      },
      orderBy: [{ tradeDate: 'asc' }, { productCode: 'asc' }],
    }),
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gt: contextStart, lte: addDays(options.endDate, 14) },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
  ]);
  const history = buildMarketRiskDriverHistory({
    dataCutoff: options.endDate,
    openDates: calendarRows.map((row) => row.calDate),
    indexRows,
    curveRows,
    fxRows,
    commodityRows,
  });
  return {
    ...history,
    observations: history.observations.filter(
      (observation) => observation.date >= options.startDate && observation.date <= options.endDate,
    ),
  };
}

interface LevelObservation {
  sourceDate: string;
  availableDate: string;
  value: number;
}

function buildDomesticCurveLevels(rows: MarketRiskCurvePoint[]): {
  level: LevelObservation[];
  slope: LevelObservation[];
  curvature: LevelObservation[];
} {
  const grouped = groupCurveTerms(rows, CHINA_TREASURY_CURVE_CODE, [2, 5, 10]);
  const level: LevelObservation[] = [];
  const slope: LevelObservation[] = [];
  const curvature: LevelObservation[] = [];
  for (const group of grouped) {
    const two = group.terms.get(2);
    const five = group.terms.get(5);
    const ten = group.terms.get(10);
    if (two == null || five == null || ten == null) {
      continue;
    }
    level.push({ ...group.identity, value: ten * 100 });
    slope.push({ ...group.identity, value: (ten - two) * 100 });
    curvature.push({ ...group.identity, value: (2 * five - two - ten) * 100 });
  }
  return { level, slope, curvature };
}

function buildCreditSpreadLevels(rows: MarketRiskCurvePoint[]): LevelObservation[] {
  const byDate = new Map<string, Map<string, MarketRiskCurvePoint>>();
  for (const row of rows) {
    if (!CREDIT_CURVE_CODE_SET.has(row.curveCode) || row.termYears !== 5) {
      continue;
    }
    validateAvailableObservation(row, `credit curve ${row.curveCode}`);
    const bucket = byDate.get(row.tradeDate) ?? new Map<string, MarketRiskCurvePoint>();
    if (bucket.has(row.curveCode)) {
      throw new Error(`Duplicate credit curve ${row.curveCode} ${row.tradeDate}.`);
    }
    bucket.set(row.curveCode, row);
    byDate.set(row.tradeDate, bucket);
  }
  const levels: LevelObservation[] = [];
  for (const [sourceDate, bucket] of [...byDate].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const government = bucket.get(CREDIT_CURVE_CODES.government);
    const bank = bucket.get(CREDIT_CURVE_CODES.bank);
    const corporate = bucket.get(CREDIT_CURVE_CODES.corporate);
    if (!government || !bank || !corporate) {
      continue;
    }
    if (
      government.availableDate !== bank.availableDate ||
      government.availableDate !== corporate.availableDate
    ) {
      throw new Error(`Credit curve availability mismatch on ${sourceDate}.`);
    }
    levels.push({
      sourceDate,
      availableDate: government.availableDate,
      value: ((bank.yieldPct + corporate.yieldPct) / 2 - government.yieldPct) * 100,
    });
  }
  return levels;
}

function groupCurveTerms(rows: MarketRiskCurvePoint[], curveCode: string, terms: number[]) {
  const allowed = new Set(terms);
  const grouped = new Map<
    string,
    { identity: { sourceDate: string; availableDate: string }; terms: Map<number, number> }
  >();
  for (const row of rows) {
    if (row.curveCode !== curveCode || !allowed.has(row.termYears)) {
      continue;
    }
    validateAvailableObservation(row, `curve ${curveCode}`);
    const bucket = grouped.get(row.tradeDate) ?? {
      identity: { sourceDate: row.tradeDate, availableDate: row.availableDate },
      terms: new Map<number, number>(),
    };
    if (bucket.identity.availableDate !== row.availableDate || bucket.terms.has(row.termYears)) {
      throw new Error(
        `Invalid curve term identity ${curveCode} ${row.tradeDate} ${row.termYears}.`,
      );
    }
    bucket.terms.set(row.termYears, row.yieldPct);
    grouped.set(row.tradeDate, bucket);
  }
  return [...grouped.values()].sort((left, right) =>
    left.identity.sourceDate.localeCompare(right.identity.sourceDate),
  );
}

function buildPriceReturns(
  rows: LevelObservation[],
  output: Map<string, number>,
  label: string,
): void {
  const sorted = validateLevelRows(rows, label);
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.value <= 0 || current.value <= 0) {
      throw new Error(`${label} prices must be positive.`);
    }
    output.set(current.availableDate, current.value / previous.value - 1);
  }
}

function buildLevelChanges(
  rows: LevelObservation[],
  output: Map<string, number>,
  label: string,
): void {
  const sorted = validateLevelRows(rows, label);
  for (let index = 1; index < sorted.length; index++) {
    output.set(sorted[index]!.availableDate, sorted[index]!.value - sorted[index - 1]!.value);
  }
}

function validateLevelRows(rows: LevelObservation[], label: string): LevelObservation[] {
  const sourceDates = new Set<string>();
  const latestByAvailableDate = new Map<string, LevelObservation>();
  for (const row of [...rows].sort((left, right) =>
    left.sourceDate.localeCompare(right.sourceDate),
  )) {
    validateAvailableObservation(
      { tradeDate: row.sourceDate, availableDate: row.availableDate },
      label,
    );
    if (!Number.isFinite(row.value)) {
      throw new Error(`${label} has a non-finite value on ${row.sourceDate}.`);
    }
    if (sourceDates.has(row.sourceDate)) {
      throw new Error(`${label} has a duplicate source date ${row.sourceDate}.`);
    }
    sourceDates.add(row.sourceDate);
    // Weekend/global-market observations can collapse onto one later SSE session. At that
    // availability point only the latest source observation is the valid as-of level; the change
    // from the prior availability point still captures the whole intervening move.
    const existing = latestByAvailableDate.get(row.availableDate);
    if (!existing || row.sourceDate > existing.sourceDate) {
      latestByAvailableDate.set(row.availableDate, row);
    }
  }
  return [...latestByAvailableDate.values()].sort((left, right) =>
    left.availableDate.localeCompare(right.availableDate),
  );
}

function nextOpenDate(tradeDate: string, openDates: string[]): string {
  assertDate(tradeDate, 'market-risk source date');
  const availableDate = openDates.find((date) => date > tradeDate);
  if (!availableDate) {
    throw new Error(`No next SSE session after market-risk source date ${tradeDate}.`);
  }
  return availableDate;
}

function validateAvailableObservation(
  row: { tradeDate: string; availableDate: string },
  label: string,
): void {
  if (
    !validDate(row.tradeDate) ||
    !validDate(row.availableDate) ||
    row.availableDate <= row.tradeDate
  ) {
    throw new Error(`Invalid ${label} PIT dates ${row.tradeDate}/${row.availableDate}.`);
  }
}

function emptyFactorMaps(): Record<MarketRiskFactorKeyV1, Map<string, number>> {
  return Object.fromEntries(
    MARKET_RISK_FACTOR_KEYS_V1.map((factor) => [factor, new Map<string, number>()]),
  ) as Record<MarketRiskFactorKeyV1, Map<string, number>>;
}

function assertDate(value: string, label: string): void {
  if (!validDate(value)) {
    throw new Error(`${label} must be YYYYMMDD.`);
  }
}

function validDate(value: string): boolean {
  return /^\d{8}$/.test(value);
}
