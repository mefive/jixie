import { useEffect, useRef } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { LogLine } from '@jixie/shared';
import './log-view.css';

type LogViewProps = {
  lines: LogLine[];
  emptyText?: string; // shown before any line arrives (e.g. "Starting the backtest process…")
  className?: string;
};

/**
 * Streamed job-log panel (backtest / factor analysis). Each line is tagged as system (engine progress) or
 * user (the strategy/factor code's own console.*) so the two are visually distinct; warn/error user
 * lines are colored. Auto-scrolls to the latest line as logs stream in.
 */
export function LogView({ lines, emptyText, className }: LogViewProps) {
  const { t } = useTranslation('components');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div ref={ref} className={classNames('jx-logView', className)}>
      {lines.length === 0 && emptyText ? (
        <div className="jx-logView-empty">{emptyText}</div>
      ) : (
        lines.map((line, index) => (
          <div
            key={index}
            className={classNames('jx-logView-line', `jx-logView-line--${line.source}`, {
              'jx-logView-line--warn': line.level === 'warn',
              'jx-logView-line--error': line.level === 'error',
            })}
          >
            <span className="jx-logView-tag">
              {line.source === 'user' ? t('tagUser') : t('tagSystem')}
            </span>
            <span className="jx-logView-text">{line.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
