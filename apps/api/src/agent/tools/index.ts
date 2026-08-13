import type { AgentTool } from './types.js';
import { searchInstruments } from './search-instruments.js';
import { dataCoverage } from './data-coverage.js';
import { runUniverseTool } from './run-universe.js';
import { sqlQueryTool } from './read-only-sql.js';
import { renderChartTool } from './render-chart.js';
import { renderComputedChartTool } from './render-computed-chart.js';
import { analyzeDataTool } from './analyze-data.js';

/** The read-only tool set shared by every agent profile (strategy / factor / screen / Q&A) —
 * profiles differ in prompt and artifact, not in what they may look at. */
export function defaultTools(): AgentTool[] {
  return [
    searchInstruments,
    dataCoverage,
    runUniverseTool,
    sqlQueryTool,
    renderChartTool,
    renderComputedChartTool,
    analyzeDataTool,
  ];
}
