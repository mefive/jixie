import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { AgentTool } from './types.js';

const TABLE_LABELS = {
  daily: '日线行情(OHLC/成交)',
  adjFactor: '复权因子',
  dailyBasic: '每日指标(PE/PB/股息率/市值/换手)',
  moneyflow: '个股资金流',
  stkLimit: '每日涨跌停价',
  topList: '龙虎榜',
  indexDaily: '指数日线',
} as const;

type TableKey = keyof typeof TABLE_LABELS;

const argsSchema = z.object({
  table: z
    .enum(Object.keys(TABLE_LABELS) as [TableKey, ...TableKey[]])
    .describe('要查覆盖情况的表'),
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
 * agent grounds "有没有/到哪天" questions in facts instead of the prompt's static description. */
export const dataCoverage: AgentTool = {
  name: 'dataCoverage',
  description: `查本地数据库某张数据表的覆盖情况(首末交易日 + 总行数)。可选表:${(
    Object.entries(TABLE_LABELS) as [TableKey, string][]
  )
    .map(([key, label]) => `${key}=${label}`)
    .join('、')}。写策略/因子前先确认所需数据的覆盖区间。`,
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数不合法:${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
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
