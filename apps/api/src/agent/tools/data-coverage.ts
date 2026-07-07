import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { AgentTool } from './types.js';

const TABLE_LABELS = {
  daily: 'daily bars (OHLC/volume)',
  adjFactor: 'adjustment factor',
  dailyBasic: 'daily metrics (PE/PB/dividend yield/market cap/turnover)',
  moneyflow: 'per-stock moneyflow',
  stkLimit: 'daily up/down price limits',
  topList: 'Dragon-Tiger List',
  indexDaily: 'index daily bars',
} as const;

type TableKey = keyof typeof TABLE_LABELS;

const argsSchema = z.object({
  table: z
    .enum(Object.keys(TABLE_LABELS) as [TableKey, ...TableKey[]])
    .describe('the table whose coverage to check'),
});

interface Coverage {
  rowCount: number;
  firstTradeDate: string | null;
  lastTradeDate: string | null;
}

async function tableCoverage(table: TableKey): Promise<Coverage> {
  // One aggregate per table; Prisma delegates are per-model types, so an explicit switch keeps it typed.
  const aggregateArgs = {
    _count: true,
    _min: { tradeDate: true },
    _max: { tradeDate: true },
  } as const;
  const aggregate =
    table === 'daily'
      ? await prisma.daily.aggregate(aggregateArgs)
      : table === 'adjFactor'
        ? await prisma.adjFactor.aggregate(aggregateArgs)
        : table === 'dailyBasic'
          ? await prisma.dailyBasic.aggregate(aggregateArgs)
          : table === 'moneyflow'
            ? await prisma.moneyflow.aggregate(aggregateArgs)
            : table === 'stkLimit'
              ? await prisma.stkLimit.aggregate(aggregateArgs)
              : table === 'topList'
                ? await prisma.topList.aggregate(aggregateArgs)
                : await prisma.indexDaily.aggregate(aggregateArgs);
  return {
    rowCount: aggregate._count,
    firstTradeDate: aggregate._min.tradeDate,
    lastTradeDate: aggregate._max.tradeDate,
  };
}

/** What data is actually in the local DB — date range + row count per whitelisted table, so the
 * agent grounds "is it there / up to which day" questions in facts instead of the prompt's static description. */
export const dataCoverage: AgentTool = {
  name: 'dataCoverage',
  description: `Check the coverage of a table in the local database (first/last trade date + total row count). Available tables: ${(
    Object.entries(TABLE_LABELS) as [TableKey, string][]
  )
    .map(([key, label]) => `${key}=${label}`)
    .join(
      ', ',
    )}. Before writing a strategy/factor, confirm the coverage range of the data you need.`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }

    const coverage = await tableCoverage(parsed.data.table);
    return {
      observation: JSON.stringify({
        table: parsed.data.table,
        label: TABLE_LABELS[parsed.data.table],
        ...coverage,
      }),
      rows: 1,
    };
  },
};
