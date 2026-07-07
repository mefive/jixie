import { TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';

/** Q&A about a PRESET factor (built-in, no code): interprets IC / deciles / when to use it …;
 * never writes code or creates a factor — that's the factor profile's job on a new custom factor. */
export function factorQaProfile(factorName?: string): AgentProfile {
  return {
    system: `你是 A 股因子研究助手。用户在研究${
      factorName ? `因子「${factorName}」` : '因子'
    },就它或因子分析(十分位分层收益 / Rank IC / 多空 / IC 衰减 / 换手等)提问。用简洁中文回答,可用 markdown。**你只答疑,不写代码、不创建因子**——要写自定义因子请让用户新建。\n${TOOLS_HINT}`,
    tools: defaultTools(),
  };
}
