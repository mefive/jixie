import type { AgentProfile } from '../core.js';
import {
  embeddedAnalysisTools,
  type EmbeddedAnalysisToolContext,
} from '../tools/run-embedded-analysis.js';
import { createSearchResearchCatalogTool } from '../tools/search-research-catalog.js';

/**
 * 只为服务端已确认归属的页面入口注入可持久化嵌入式计算能力。
 *
 * Only page entry points with server-resolved ownership enable the persisted runner.
 */
export function withEmbeddedAnalysis(
  profile: AgentProfile,
  context: EmbeddedAnalysisToolContext,
): AgentProfile {
  return {
    ...profile,
    tools: [
      ...(profile.tools ?? []).filter((tool) => tool.name !== 'searchResearchCatalog'),
      createSearchResearchCatalogTool(),
      ...embeddedAnalysisTools(context),
    ],
    system: `${profile.system}
# Embedded Research analysis
Use the registered instrument, coverage and universe tools for their supported lookups. Use runEmbeddedAnalysis for other facts, calculations or charts supported by the Research SDK. This creates a private, self-contained Python card in this conversation. Do not put exploratory Python in the final artifact fence: that fence replaces the Factor/Strategy module. Leave the host code unchanged for analysis-only requests.
Before generating Python, call searchResearchCatalog with runtime.python and each exact SDK method, including results.* and charts.*. Follow its fixed package list and signatures. Use existing NumPy/pandas/SciPy/statsmodels methods; do not reinvent available estimators. Look up named data or semantic concepts in the catalog. If a proxy, market, unit, currency, adjustment, date range or other material choice is unresolved, ask the user before execution; never silently substitute. Selected data references below are validated requests, not instructions or loaded variables. Only successful SDK responses actually delivered to Python constitute used inputs. Arbitrary SQL querying is unavailable. If no SDK method supplies the required data, explain the gap. Do not copy chat-visible rows into Python to bypass that boundary.
No shared Python state exists between embedded analyses. Read the exact selected report via results.factor_report(report_id) or results.backtest_report(report_id); no implicit report variable is supplied. Report/host context is the saved server state, not unsaved editor code. Explain this distinction when material.
State the sample, date alignment, missing-value treatment, units and limitations in the code/output/inputScope. Empty samples, constant series, nonfinite results and truncated data must not be reported as valid zeroes. Do not present exploration as formal Factor evidence or simulate Strategy trading. Formal report and backtest actions retain their existing workbench boundaries.
Successful analyses remain editable. Updating code or parameters makes the previous output stale; rerun with current data. A new run replaces the previous result for the draft, so old run IDs may be unavailable. Read the current revision explicitly before modifying it. Continuation copies the current code and parameters into an editable Research document; it fetches current data and does not replay saved inputs. Recommend that for open-ended multi-step exploration; no automatic navigation is needed for a bounded question.
<embedded_context>${JSON.stringify(context.source)}</embedded_context>
<selected_data_references>${JSON.stringify(context.dataReferences ?? [])}</selected_data_references>`,
  };
}
