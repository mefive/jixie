import { useEffect, useRef } from 'react';
import { faDatabase, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { reactUtils } from '@src/lib';
import type { AgentTurnStream } from './agent-turn-stream';
import { Markdown } from './markdown';
import './agent-pending.css';

/**
 * The in-flight assistant bubble: streamed text so far + phase notes (tool calls / compile repair).
 * A fenced code block streams into the EDITOR at done, not the chat — so the bubble shows only the
 * pre-fence prose plus a "writing code" indicator once a fence opens. Streams as markdown too, so
 * the final message landing doesn't re-layout the bubble. While the text grows the bubble keeps the
 * chat log pinned to the bottom — but only when the user is already there (never fight a scroll-up).
 */
export const AgentPending = reactUtils.observer(({ stream }: { stream: AgentTurnStream }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const fenceAt = stream.text.indexOf('```');
  const visibleText = fenceAt === -1 ? stream.text : stream.text.slice(0, fenceAt).trimEnd();
  const writingCode = fenceAt !== -1;

  useEffect(() => {
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
  }, [visibleText, stream.trace.length, stream.statusNote]);

  return (
    <div ref={boxRef}>
      {stream.trace.length > 0 && (
        <div className="jx-agentPending-trace">
          <FontAwesomeIcon icon={faDatabase} /> 已查库 {stream.trace.length} 次:
          {[...new Set(stream.trace.map((item) => item.name))].join('、')}
        </div>
      )}
      {visibleText && (
        <div className="jx-agentPending-text">
          <Markdown text={visibleText} />
        </div>
      )}
      <div className="jx-agentPending-status">
        <FontAwesomeIcon icon={faSpinner} spin />{' '}
        {stream.statusNote || (writingCode ? '正在写代码…' : visibleText ? '' : '思考中…')}
        <button className="jx-agentPending-stop" onClick={() => stream.cancel()}>
          停止
        </button>
      </div>
    </div>
  );
}, 'AgentPending');
