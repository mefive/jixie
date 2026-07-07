import { buildFactorCodegenPrompt } from '../../factor/factor-codegen-prompt.js';
import { compileFactor } from '../../factor/compile-factor.js';
import { buildAgentMode, TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';

/** The factor-workbench agent: iterates on defineFactor code, compile-validated, with read-only data tools. */
export function factorProfile(): AgentProfile {
  return {
    system: `${buildFactorCodegenPrompt()}\n${buildAgentMode('factor')}\n${TOOLS_HINT}`,
    tools: defaultTools(),
    artifact: {
      noun: 'factor',
      validate: async (code) => {
        (await compileFactor(code)).dispose(); // validate-only: compile into an isolate, then free it
      },
    },
  };
}
