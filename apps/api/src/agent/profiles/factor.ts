import { buildFactorCodegenPrompt } from '../../factor/factor-codegen-prompt.js';
import { validateFactorDefinition } from '../../factor/validate-factor-definition.js';
import type { Locale } from '@jixie/shared';
import { buildAgentMode, RESEARCH_TOOLS_HINT, TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';
import { runFactorAnalysisTool } from '../tools/run-factor-analysis.js';
import { runTimeSeriesFactorAnalysisTool } from '../tools/run-time-series-factor-analysis.js';

/** The factor-workbench agent: iterates on defineFactor code, compile-validated, with read-only data tools. */
export function factorProfile(research?: {
  userId: string;
  factorId: string;
  currentCode: string;
  locale: Locale;
  analysisKind?: 'cross_sectional' | 'time_series' | 'panel';
}): AgentProfile {
  const analysisKind = research?.analysisKind ?? 'cross_sectional';
  return {
    system: `${buildFactorCodegenPrompt(analysisKind)}\n${buildAgentMode('factor')}\n${TOOLS_HINT}${research ? RESEARCH_TOOLS_HINT : ''}`,
    tools: [
      ...defaultTools(),
      ...(research && analysisKind !== 'panel'
        ? [
            analysisKind === 'time_series'
              ? runTimeSeriesFactorAnalysisTool(research)
              : runFactorAnalysisTool(research),
          ]
        : []),
    ],
    artifact: {
      noun: 'factor',
      validate: async (code) => {
        await validateFactorDefinition(code, analysisKind);
      },
    },
  };
}
