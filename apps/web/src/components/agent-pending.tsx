import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { faDatabase, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { reactUtils } from '@src/lib';
import type { AgentTurnStream } from './agent-turn-stream';
import { Markdown } from './markdown';
import { LiveReasoning } from './agent-trace';
import './agent-pending.css';

/**
 * 展示 Agent 等待与处理中状态，提供可读进度提示。
 * Render agent pending and processing states with readable progress.
 */
export const AgentPending = reactUtils.observer(
  ({ stream, autoScroll = true }: { stream: AgentTurnStream; autoScroll?: boolean }) => {
    const { t } = useTranslation('components');
    const boxRef = useRef<HTMLDivElement>(null);
    const fenceAt = stream.text.indexOf('```');
    const visibleText = fenceAt === -1 ? stream.text : stream.text.slice(0, fenceAt).trimEnd();
    const writingCode = fenceAt !== -1;

    useEffect(() => {
      if (!autoScroll) {
        return;
      }

      let scroller = boxRef.current?.parentElement ?? null;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      if (!scroller) {
        return;
      }
      const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distanceToBottom < 160) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    }, [autoScroll, visibleText, stream.trace.length, stream.statusNote]);

    return (
      <div ref={boxRef}>
        <LiveReasoning reasoning={stream.reasoning} />
        {stream.trace.length > 0 && (
          <div className="jx-agentPending-trace">
            <FontAwesomeIcon icon={faDatabase} />{' '}
            {t('queriedDbDone', { count: stream.trace.length })}
            {[...new Set(stream.trace.map((item) => item.name))].join('、')}
          </div>
        )}
        {visibleText && (
          <div className="jx-agentPending-text">
            <Markdown text={visibleText} streaming={stream.streaming} />
          </div>
        )}
        <div className="jx-agentPending-status">
          <FontAwesomeIcon icon={faSpinner} spin />{' '}
          {stream.statusNote || (writingCode ? t('writingCode') : visibleText ? '' : t('thinking'))}
          <button className="jx-agentPending-stop" onClick={() => stream.cancel()}>
            {t('stop')}
          </button>
        </div>
      </div>
    );
  },
  'AgentPending',
);
