import type { AgentTool } from './types.js';
import { searchInstruments } from './search-instruments.js';
import { dataCoverage } from './data-coverage.js';
import { runScreenTool } from './run-screen.js';
import { sqlQueryTool } from './read-only-sql.js';
import { renderChartTool } from './render-chart.js';

/** The read-only tool set shared by every agent profile (strategy / factor / screen / Q&A) —
 * profiles differ in prompt and artifact, not in what they may look at. */
export function defaultTools(): AgentTool[] {
  return [searchInstruments, dataCoverage, runScreenTool, sqlQueryTool, renderChartTool];
}
