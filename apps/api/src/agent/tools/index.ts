import type { AgentTool } from './types.js';
import { searchInstruments } from './search-instruments.js';
import { dataCoverage } from './data-coverage.js';
import { runUniverseTool } from './run-universe.js';
import { sqlQueryTool } from './sql/read-only-sql.js';

/** Baseline lookups for Factor/Strategy authoring and questions, including non-page handoffs.
 * Persisted Python execution is added separately by authenticated page entry points. */
export function defaultTools(): AgentTool[] {
  return [searchInstruments, dataCoverage, runUniverseTool, sqlQueryTool];
}
