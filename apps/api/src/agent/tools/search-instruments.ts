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
    .describe('股票名称、简称片段或 6 位代码,如「茅台」「600519」'),
});

const MAX_MATCHES = 20;

/** Deterministic DB-backed instrument lookup (the same resolver behind the screen page's direct
 * lookup) — the agent asks this instead of hallucinating ts_codes. */
export const searchInstruments: AgentTool = {
  name: 'searchInstruments',
  description:
    '按名称/简称片段/6位代码在本地股票列表中查 A 股标的(确定性匹配,绝不臆造代码)。一次查一个;找不到返回空列表。',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数不合法:${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
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
