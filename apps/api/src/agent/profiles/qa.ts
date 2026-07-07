import { REPLY_LANGUAGE, TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';

// The system prompt below is English (i18n-exempt); only the reply language follows the user.
/** Q&A about a PRESET factor (built-in, no code): interprets IC / deciles / when to use it …;
 * never writes code or creates a factor — that's the factor profile's job on a new custom factor. */
export function factorQaProfile(factorName?: string): AgentProfile {
  return {
    system: `You are an A-share factor research assistant. The user is studying ${
      factorName ? `the factor "${factorName}"` : 'factors'
    } and asks about it or its factor analysis (decile-sorted returns / Rank IC / long-short / IC decay / turnover, etc.). Keep answers concise; markdown is fine. ${REPLY_LANGUAGE} **You only answer questions — you do not write code or create factors**; if the user wants a custom factor, tell them to create a new one.\n${TOOLS_HINT}`,
    tools: defaultTools(),
  };
}
