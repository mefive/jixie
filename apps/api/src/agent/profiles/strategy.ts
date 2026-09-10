import { buildCodegenPrompt, KNOWN_INDICES } from '#strategy/runtime/typescript/codegen-prompt.js';
import { compileStrategy } from '#strategy/runtime/typescript/compile.js';
import { buildPythonCodegenPrompt } from '#strategy/runtime/python/codegen-prompt.js';
import { createPythonStrategyRuntime } from '#strategy/runtime/python/runtime.js';
import { prisma } from '#infra/database/prisma.js';
import { buildAgentMode, TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';

/** ts_code-shaped literals in the strategy code (6 digits + exchange suffix), deduped. Comments are
 * scanned too — a stale code in a comment forces the model to clean it up, which is fine. */
export function extractInstrumentCodes(code: string): string[] {
  return [...new Set(code.match(/\b\d{6}\.[A-Z]{2,3}\b/g) ?? [])];
}

/** Reject codes that exist nowhere in the local data (not a stock/ETF, not an offered index, not a synced
 * index series). An LLM writing a ts_code from memory otherwise fails SILENTLY at runtime: ensureBars
 * loads nothing → indicators return null → the backtest completes with zero trades. Throwing here
 * turns that into a repair-round message telling the model to look the instrument up. */
async function assertKnownInstruments(code: string): Promise<void> {
  const candidates = extractInstrumentCodes(code).filter((tsCode) => !KNOWN_INDICES[tsCode]);
  if (candidates.length === 0) {
    return;
  }

  const [stocks, etfs, indices] = await Promise.all([
    prisma.stockBasic.findMany({ where: { tsCode: { in: candidates } }, select: { tsCode: true } }),
    prisma.etfDaily.findMany({
      where: { tsCode: { in: candidates } },
      select: { tsCode: true },
      distinct: ['tsCode'],
    }),
    prisma.indexDaily.findMany({
      where: { tsCode: { in: candidates } },
      select: { tsCode: true },
      distinct: ['tsCode'],
    }),
  ]);
  const known = new Set([...stocks, ...etfs, ...indices].map((row) => row.tsCode));

  const unknown = candidates.filter((tsCode) => !known.has(tsCode));
  if (unknown.length > 0) {
    throw new Error(
      `unknown or unsynced ts_code(s) — not in local stock data, synced ETF bars, or index data: ${unknown.join(', ')}. ` +
        'Look the instrument up with the searchInstruments tool and use the returned ts_code; never write a ts_code from memory.',
    );
  }
}

/** The strategy-lab agent: iterates on defineStrategy code, compile-validated, with read-only data tools. */
export function strategyProfile(
  availableIndices?: string,
  referencableFactors?: string,
  language: 'typescript' | 'python' = 'typescript',
): AgentProfile {
  const codegenPrompt =
    language === 'python'
      ? buildPythonCodegenPrompt(availableIndices)
      : buildCodegenPrompt(availableIndices, referencableFactors);
  return {
    system: `${codegenPrompt}\n${buildAgentMode('strategy', language)}\n${TOOLS_HINT}

# Strategy workflow
Use the Strategy SDK, current code and available context to write or explain a complete strategy. Use read-only tools when needed to check instruments, data coverage or facts. Generated code goes through the existing artifact validator; passing that check does not establish trading performance.
Backtests run only when the user explicitly starts a run in the Strategy workbench. Do not run a backtest in the conversation or recreate trading simulation with SQL or analysis tools. When asked to test a strategy, prepare the code and explain which settings and results the user should inspect in the workbench. Never claim that generated code has been backtested or invent performance metrics.`,
    tools: defaultTools(),
    artifact: {
      noun: 'strategy',
      language,
      validate: async (code) => {
        if (language === 'python') {
          const runtime = await createPythonStrategyRuntime(code);
          await runtime.close();
        } else {
          await compileStrategy(code);
        }
        await assertKnownInstruments(code);
      },
    },
  };
}
