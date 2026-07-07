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
    .describe('stock name, name-fragment, or 6-digit code, e.g. 「茅台」or 「600519」'),
});

const MAX_MATCHES = 20;

/** Deterministic DB-backed instrument lookup (the same resolver behind the screen page's direct
 * lookup) — the agent asks this instead of hallucinating ts_codes. */
export const searchInstruments: AgentTool = {
  name: 'searchInstruments',
  description:
    'Look up an A-share instrument in the local stock list by name / name-fragment / 6-digit code (deterministic matching, never fabricates codes). One lookup at a time; returns an empty list when nothing is found.',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }

    const codes = (await resolveInstruments(parsed.data.query)).slice(0, MAX_MATCHES);
    const matches = codes.length
      ? await prisma.stockBasic.findMany({
          where: { tsCode: { in: codes } },
          select: { tsCode: true, name: true, industry: true },
        })
      : [];
    return { observation: JSON.stringify({ matches }), rows: matches.length };
  },
};
