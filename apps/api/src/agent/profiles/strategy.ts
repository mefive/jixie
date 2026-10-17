import { inspectStrategyMetadata } from '#strategy/sandbox/inspect-definition.js';
import { StrategySandbox } from '#strategy/sandbox/strategy-sandbox.js';
import { buildCodegenPrompt, KNOWN_INDICES } from '#strategy/sandbox/typescript/codegen-prompt.js';

import { buildPythonCodegenPrompt } from '#strategy/sandbox/python/codegen-prompt.js';

import { prisma } from '#infra/database/prisma.js';
import { buildAgentMode, TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';

/**
 * 静态提取并去重策略中的证券代码字面量；注释中的代码也参与检查。
 * ts_code-shaped literals in the strategy code (6 digits + exchange suffix), deduped. Comments are
 * scanned too — a stale code in a comment forces the model to clean it up, which is fine.
 */
export function extractInstrumentCodes(code: string): string[] {
  return [...new Set(code.match(/\b\d{6}\.[A-Z]{2,3}\b/g) ?? [])];
}

/**
 * 拒绝本地证券、ETF 和指数数据中均不存在的代码，防止生成不可用策略。
 * Reject codes that exist nowhere in the local data (not a stock/ETF, not an offered index, not a synced
 * index series). An LLM writing a ts_code from memory otherwise fails SILENTLY at runtime: ensureBars
 * loads nothing → indicators return null → the backtest completes with zero trades. Throwing here
 * turns that into a repair-round message telling the model to look the instrument up.
 */
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

/**
 * 配置策略工作台 Agent，通过只读工具迭代并编译校验策略代码。
 * The strategy-lab agent: iterates on defineStrategy code, compile-validated, with read-only data tools.
 */
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
          const sandbox = await StrategySandbox.start({ language: 'python', code: code });
          await sandbox.close();
        } else {
          await inspectStrategyMetadata(code);
        }
        await assertKnownInstruments(code);
      },
    },
  };
}
