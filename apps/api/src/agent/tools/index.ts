import type { AgentTool } from './types.js';
import { searchInstruments } from './search-instruments.js';
import { dataCoverage } from './data-coverage.js';
import { runUniverseTool } from './run-universe.js';
import { sqlQueryTool } from './sql/read-only-sql.js';

/**
 * 提供因子和策略编写所需的基础只读工具；页面持久化 Python 能力由授权入口另行添加。
 *
 * Baseline lookups for Factor/Strategy authoring and questions, including non-page handoffs.
 * Persisted Python execution is added separately by authenticated page entry points.
 */
export function defaultTools(): AgentTool[] {
  return [searchInstruments, dataCoverage, runUniverseTool, sqlQueryTool];
}
