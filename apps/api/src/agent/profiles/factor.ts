import { buildFactorCodegenPrompt } from '../../factor/factor-codegen-prompt.js';
import { compileFactor } from '../../factor/compile-factor.js';
import type { Locale } from '@jixie/shared';
import { buildAgentMode, RESEARCH_TOOLS_HINT, TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';
import { runFactorAnalysisTool } from '../tools/run-factor-analysis.js';

/** The factor-workbench agent: iterates on defineFactor code, compile-validated, with read-only data tools. */
export function factorProfile(research?: {
  userId: string;
  factorId: string;
  currentCode: string;
  locale: Locale;
}): AgentProfile {
  return {
    system: `${buildFactorCodegenPrompt()}\n${buildAgentMode('factor')}\n${TOOLS_HINT}${research ? RESEARCH_TOOLS_HINT : ''}`,
    tools: [...defaultTools(), ...(research ? [runFactorAnalysisTool(research)] : [])],
    artifact: {
      noun: 'factor',
      validate: async (code) => {
        (await compileFactor(code)).dispose(); // validate-only: compile into an isolate, then free it
      },
    },
  };
}
