import { buildCodegenPrompt, KNOWN_INDICES } from '../../strategy/code/codegen-prompt.js';
import { compileStrategy } from '../../strategy/code/compile.js';
import { prisma } from '../../lib/prisma.js';
import { buildAgentMode, TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';

/** ts_code-shaped literals in the strategy code (6 digits + exchange suffix), deduped. Comments are
 * scanned too — a stale code in a comment forces the model to clean it up, which is fine. */
export function extractInstrumentCodes(code: string): string[] {
  return [...new Set(code.match(/\b\d{6}\.[A-Z]{2,3}\b/g) ?? [])];
}

/** Reject codes that exist nowhere in the local data (not a stock, not an offered index, not a synced
 * index series). An LLM writing a ts_code from memory otherwise fails SILENTLY at runtime: ensureBars
 * loads nothing → indicators return null → the backtest completes with zero trades. Throwing here
 * turns that into a repair-round message telling the model to look the instrument up. */
async function assertKnownInstruments(code: string): Promise<void> {
  const candidates = extractInstrumentCodes(code).filter((tsCode) => !KNOWN_INDICES[tsCode]);
  if (candidates.length === 0) {
    return;
  }

  const [stocks, indices] = await Promise.all([
    prisma.stockBasic.findMany({ where: { tsCode: { in: candidates } }, select: { tsCode: true } }),
    prisma.indexDaily.findMany({
      where: { tsCode: { in: candidates } },
      select: { tsCode: true },
      distinct: ['tsCode'],
    }),
  ]);
  const known = new Set([...stocks, ...indices].map((row) => row.tsCode));

  const unknown = candidates.filter((tsCode) => !known.has(tsCode));
  if (unknown.length > 0) {
    throw new Error(
      `unknown ts_code(s) — not in the local stock list or index data: ${unknown.join(', ')}. ` +
        'Look the instrument up with the searchInstruments tool and use the returned ts_code; never write a ts_code from memory.',
    );
  }
}

/** The strategy-lab agent: iterates on defineStrategy code, compile-validated, with read-only data tools. */
export function strategyProfile(
  availableIndices?: string,
  referencableFactors?: string,
): AgentProfile {
  return {
    system: `${buildCodegenPrompt(availableIndices, referencableFactors)}\n${buildAgentMode('strategy')}\n${TOOLS_HINT}`,
    tools: defaultTools(),
    artifact: {
      noun: 'strategy',
      validate: async (code) => {
        await compileStrategy(code);
        await assertKnownInstruments(code);
      },
    },
  };
}
