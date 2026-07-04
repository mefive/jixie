import { useEffect, useRef } from 'react';
import classNames from 'classnames';
import type { LogLine } from '@jixie/shared';
import './log-view.css';

type LogViewProps = {
  lines: LogLine[];
  emptyText?: string; // shown before any line arrives (e.g. "正在启动回测进程…")
  className?: string;
};

/**
 * Streamed job-log panel (backtest / factor analysis). Each line is tagged 系统 (engine progress) or
 * 用户 (the strategy/factor code's own console.*) so the two are visually distinct; warn/error user
 * lines are colored. Auto-scrolls to the latest line as logs stream in.
 */
export function LogView({ lines, emptyText, className }: LogViewProps) {
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
            <span className="jx-logView-tag">{line.source === 'user' ? '用户' : '系统'}</span>
            <span className="jx-logView-text">{line.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
