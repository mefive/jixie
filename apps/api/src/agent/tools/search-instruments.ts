import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { resolveInstruments } from '../../market/instrument-resolver.js';
import { etfResearchMembership } from '../../store/etf-research-registry.js';
import type { AgentTool } from './types.js';

const argsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe('stock/ETF name, name-fragment, or 6-digit code, e.g. 「茅台」or 「510300」'),
});

const MAX_MATCHES = 20;

/** Deterministic DB-backed instrument lookup — the agent asks this instead of hallucinating codes. */
export const searchInstruments: AgentTool = {
  name: 'searchInstruments',
  description:
    'Look up an A-share stock or ETF in local metadata by name / name-fragment / 6-digit code (deterministic matching, never fabricates codes). One lookup at a time; returns an empty list when nothing is found.',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }

    const codes = (await resolveInstruments(parsed.data.query)).slice(0, MAX_MATCHES);
    const [stocks, etfs, etfCoverage] = codes.length
      ? await Promise.all([
          prisma.stockBasic.findMany({
            where: { tsCode: { in: codes } },
            select: { tsCode: true, name: true, industry: true },
          }),
          prisma.etfBasic.findMany({
            where: { tsCode: { in: codes } },
            select: {
              tsCode: true,
              name: true,
              indexName: true,
              fundType: true,
              etfType: true,
              exchange: true,
              listDate: true,
              delistDate: true,
            },
          }),
          prisma.etfDaily.groupBy({
            by: ['tsCode'],
            where: { tsCode: { in: codes } },
            _count: { _all: true },
            _min: { tradeDate: true },
            _max: { tradeDate: true },
          }),
        ])
      : [[], [], []];
    const coverageByCode = new Map(etfCoverage.map((row) => [row.tsCode, row]));
    const matches = [
      ...stocks.map((row) => ({ ...row, assetType: 'stock' as const })),
      ...etfs.map((row) => {
        const coverage = coverageByCode.get(row.tsCode);
        const membership = etfResearchMembership(row.tsCode);
        const hasDailyData = coverage != null && coverage._count._all > 0;
        return {
          ...row,
          industry: null,
          assetType: 'etf' as const,
          hasDailyData,
          localDataCoverage: hasDailyData
            ? {
                status: 'ready',
                observations: coverage._count._all,
                startDate: coverage._min.tradeDate,
                endDate: coverage._max.tradeDate,
              }
            : {
                status: 'missing',
                reason: 'source_available_but_local_data_missing',
              },
          researchRegistry: membership,
        };
      }),
    ].sort((left, right) => codes.indexOf(left.tsCode) - codes.indexOf(right.tsCode));
    return { observation: JSON.stringify({ matches }), rows: matches.length };
  },
};
