import { futureMarketSchema } from '#market/futures/snapshot.js';
import { publishedFutureRows } from '#market/futures/publication.js';
import { z } from 'zod';
import type { EngineDataPort } from '#backtesting/data/data-port.js';
import { EngineData } from '#backtesting/data/engine-data.js';
import { prismaDataPort } from '#backtesting/adapters/prisma-port.js';
import { prisma } from '#infra/database/prisma.js';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import { SignalsError } from '../errors.js';

const number = z.number().finite();
const nullableNumber = number.nullable();

const marketInputSchema = z.object({
  date: z.string(),
  previousDate: z.string(),
  nextDate: z.string(),
  futures: futureMarketSchema,
  etfs: z.array(
    z.object({
      tsCode: z.string(),
      listDate: z.string().nullable(),
      delistDate: z.string().nullable(),
      listStatus: z.string(),
      sameDayTurnover: z.boolean(),
    }),
  ),
  bars: z.object({
    px: z.array(
      z.object({
        tsCode: z.string(),
        tradeDate: z.string(),
        open: nullableNumber,
        high: nullableNumber,
        low: nullableNumber,
        close: nullableNumber,
        vol: nullableNumber,
        amount: nullableNumber,
      }),
    ),
    adj: z.array(
      z.object({ tsCode: z.string(), tradeDate: z.string(), adjFactor: number.positive() }),
    ),
    limits: z.array(
      z.object({ tsCode: z.string(), tradeDate: z.string(), upLimit: number, downLimit: number }),
    ),
    turnoverRatesF: z.array(
      z.object({ tsCode: z.string(), tradeDate: z.string(), turnoverRateF: nullableNumber }),
    ),
  }),
  codes: z.array(z.string()),
});
export type SignalMarketInput = z.infer<typeof marketInputSchema>;

export function replayDataPort(input: SignalMarketInput): EngineDataPort {
  return {
    openDates: async () => [input.previousDate, input.date, input.nextDate],
    stockBasics: async () => [],
    industryMemberships: async () => [],
    stockNameHistory: async () => [],
    etfBasics: async () => input.etfs,
    topListRange: async () => [],
    indexDailyAll: async () => [],
    indexDailyBasicAll: async () => [],
    yieldCurvePoints: async () => [],
    moneyflowRange: async () => [],
    crossSectionRows: async () => ({ price: [], adj: [], basic: [] }),
    finaIndicators: async () => [],
    indexWeights: async () => [],
    barsRows: async () => input.bars,
    futuresRange: async () => input.futures,
  };
}

export async function createReplayData(
  input: SignalMarketInput,
  strictFutures = true,
): Promise<EngineData> {
  const data = new EngineData({
    start: input.previousDate,
    end: input.date,
    strictFutures,
    dataPort: replayDataPort(input),
    preloadCodes: input.codes,
  });
  await data.load();

  return data;
}

export async function loadSignalMarketInput(
  deploymentId: string,
  date: string,
  codes: string[],
  futureCodes: string[] = [],
  kind: 'simulation' | 'actual' = 'simulation',
  refresh = false,
): Promise<SignalMarketInput> {
  const saved = await prisma.signalAccountMarketInput.findFirst({
    where: { deploymentId, tradeDate: date },
    orderBy: { revision: 'desc' },
  });
  if (saved && !refresh) {
    const parsed = marketInputSchema.parse(saved.payload);
    if (codes.some((code) => !parsed.codes.includes(code))) {
      throw new SignalsError('data_not_ready', {
        params: { date },
        details: { reason: 'frozen_input_missing_code' },
      });
    }
    validateFutureInput(parsed, futureCodes, kind);

    return parsed;
  }

  const [previous, next] = await Promise.all([
    prisma.tradeCal.findFirst({
      where: { exchange: 'SSE', isOpen: 1, calDate: { lt: date } },
      orderBy: { calDate: 'desc' },
    }),
    prisma.tradeCal.findFirst({
      where: { exchange: 'SSE', isOpen: 1, calDate: { gt: date } },
      orderBy: { calDate: 'asc' },
    }),
  ]);
  if (!previous || !next) {
    throw new SignalsError('next_date_missing');
  }
  const [bars, futures, etfs] = await Promise.all([
    prismaDataPort.barsRows(codes, previous.calDate, date),
    refresh
      ? prismaDataPort.futuresRange(previous.calDate, date)
      : publishedFutureRows(previous.calDate, date),
    prismaDataPort.etfBasics(),
  ]);
  const input = marketInputSchema.parse({
    date,
    previousDate: previous.calDate,
    nextDate: next.calDate,
    codes,
    bars,
    futures,
    etfs: etfs.filter((etf) => codes.includes(etf.tsCode)),
  });
  validateFutureInput(input, futureCodes, kind);
  return input;
}

export async function freezeSignalMarketInput(deploymentId: string, input: SignalMarketInput) {
  const saved = await prisma.signalAccountMarketInput.findFirst({
    where: { deploymentId, tradeDate: input.date },
    orderBy: { revision: 'desc' },
  });
  const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  if (saved) {
    if (saved.inputHash !== inputHash) {
      throw new SignalsError('execution_unavailable');
    }
    return;
  }
  const frozen = await prisma.signalAccountMarketInput.upsert({
    where: {
      deploymentId_tradeDate_revision: { deploymentId, tradeDate: input.date, revision: 0 },
    },
    update: {},
    create: {
      id: ulid(),
      deploymentId,
      tradeDate: input.date,
      payload: input as Prisma.InputJsonValue,
      inputHash,
    },
  });
  if (frozen.inputHash !== inputHash) {
    throw new SignalsError('execution_unavailable');
  }
}

function validateFutureInput(
  input: SignalMarketInput,
  futureCodes: string[],
  kind: 'simulation' | 'actual',
) {
  for (const code of futureCodes) {
    const contract = input.futures.contracts.find((row) => row.tsCode === code);
    if (kind === 'actual' && contract && contract.delistDate < input.date) {
      throw new SignalsError('unresolved_expiry', { params: { code, date: input.date } });
    }
    const actualCode = input.futures.contracts.some((contract) => contract.tsCode === code)
      ? code
      : input.futures.mappings.find(
          (mapping) => mapping.continuousCode === code && mapping.tradeDate === input.previousDate,
        )?.mappedTsCode;
    const bar = input.futures.daily.find(
      (row) => row.tsCode === actualCode && row.tradeDate === input.date,
    );
    if (!actualCode || !bar?.settle || (kind === 'simulation' && !bar.open)) {
      throw new SignalsError('data_not_ready', { params: { date: input.date }, details: { code } });
    }
  }
}
