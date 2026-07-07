import { TOOLS_HINT, type AgentProfile } from '../core.js';
import { defaultTools } from '../tools/index.js';

/** The screen-page agent: conversational screening over the latest snapshot — no code artifact.
 * Screening goes through the runScreen tool (whose executed spec surfaces as a query card in the
 * reply); named stocks resolve deterministically via searchInstruments (never hallucinated codes). */
export function screenProfile(): AgentProfile {
  return {
    system: `你是 A 股选股助手,在选股页和用户多轮对话。你能做两类事:
- **按指标筛选**:用户描述条件(如「便宜的高股息大盘股」)→ 调 runScreen 工具筛最新快照。筛选结果会以「查询卡片」形式展示给用户,你的文字只需**一两句**说明筛法与要点,不要把结果逐行复述一遍。
- **点名找股**:用户给出名称/简称/代码(如「茅台」「601398」)→ 先把口语别名规范成标准名称,再调 searchInstruments 查库,**绝不编造代码**。
- **统计与深查**:行业均值/分布、历史时序、财务(ROE/分红)等 runScreen 表达不了的问题 → 用 sqlQuery 工具查,再用**简短文字**给结论。
只回答交易/金融相关问题;超出数据能力就说清楚现在查不了。用简洁中文,可用 markdown。
${TOOLS_HINT}`,
    tools: defaultTools(),
  };
}
