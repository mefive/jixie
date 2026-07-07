import { Tooltip } from 'antd';
import { faDatabase } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { AgentToolTraceItem } from '@src/api/client';
import './tool-trace.css';

/** A muted "queried the DB N times" line under a fresh agent reply — display only, never persisted
 * (a reopened conversation simply doesn't show it). Hover for the per-call detail. */
export function ToolTrace({ trace }: { trace: AgentToolTraceItem[] }) {
  if (!trace.length) {
    return null;
  }
  const detail = trace
    .map(
      (item) =>
        `${item.name}(${item.argsSummary})${item.ok ? (item.rows != null ? ` → ${item.rows} 行` : '') : ' → 失败'}`,
    )
    .join('\n');
  return (
    <Tooltip title={<pre className="jx-toolTrace-detail">{detail}</pre>}>
      <div className="jx-toolTrace">
        <FontAwesomeIcon icon={faDatabase} /> 查库 {trace.length} 次:
        {[...new Set(trace.map((item) => item.name))].join('、')}
      </div>
    </Tooltip>
  );
}
