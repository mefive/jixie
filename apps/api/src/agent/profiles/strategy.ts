import { buildCodegenPrompt } from '../../strategy/code/codegen-prompt.js';
import { compileStrategy } from '../../strategy/code/compile.js';
import { buildAgentMode, TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';

/** The strategy-lab agent: iterates on defineStrategy code, compile-validated, with read-only data tools. */
export function strategyProfile(availableIndices?: string): AgentProfile {
  return {
    system: `${buildCodegenPrompt(availableIndices)}\n${buildAgentMode('strategy')}\n${TOOLS_HINT}`,
    tools: defaultTools(),
    artifact: {
      noun: 'strategy',
      validate: async (code) => {
        await compileStrategy(code);
      },
    },
  };
}
