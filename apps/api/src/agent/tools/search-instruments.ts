import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { resolveInstruments } from '../../screen/resolve.js';
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

/** Deterministic DB-backed instrument lookup (the same resolver behind the screen page's direct
 * lookup) — the agent asks this instead of hallucinating ts_codes. */
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
    const [stocks, etfs, etfBars] = codes.length
      ? await Promise.all([
          prisma.stockBasic.findMany({
            where: { tsCode: { in: codes } },
            select: { tsCode: true, name: true, industry: true },
          }),
          prisma.etfBasic.findMany({
            where: { tsCode: { in: codes } },
            select: { tsCode: true, name: true, indexName: true, fundType: true, etfType: true },
          }),
          prisma.etfDaily.findMany({
            where: { tsCode: { in: codes } },
            select: { tsCode: true },
            distinct: ['tsCode'],
          }),
        ])
      : [[], [], []];
    const syncedEtfCodes = new Set(etfBars.map((row) => row.tsCode));
    const matches = [
      ...stocks.map((row) => ({ ...row, assetType: 'stock' as const })),
      ...etfs.map((row) => ({
        ...row,
        industry: null,
        assetType: 'etf' as const,
        hasDailyData: syncedEtfCodes.has(row.tsCode),
      })),
    ].sort((left, right) => codes.indexOf(left.tsCode) - codes.indexOf(right.tsCode));
    return { observation: JSON.stringify({ matches }), rows: matches.length };
  },
};
