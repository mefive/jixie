import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { faDatabase } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { AgentToolTraceItem } from '@src/api/client';
import './tool-trace.css';

/** A muted "queried the DB N times" line under a fresh agent reply — display only, never persisted
 * (a reopened conversation simply doesn't show it). Hover for the per-call detail. */
export function ToolTrace({ trace }: { trace: AgentToolTraceItem[] }) {
  const { t } = useTranslation('components');
  if (!trace.length) {
    return null;
  }
  const detail = trace
    .map((item) => {
      const outcome = item.ok
        ? item.rows != null
          ? t('traceRows', { rows: item.rows })
          : ''
        : t('traceFailed');
      return `${item.name}(${item.argsSummary})${outcome}`;
    })
    .join('\n');
  return (
    <Tooltip title={<pre className="jx-toolTrace-detail">{detail}</pre>}>
      <div className="jx-toolTrace">
        <FontAwesomeIcon icon={faDatabase} /> {t('queriedDb', { count: trace.length })}
        {[...new Set(trace.map((item) => item.name))].join('、')}
      </div>
    </Tooltip>
  );
}
