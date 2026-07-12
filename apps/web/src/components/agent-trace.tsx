import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CodeHighlighter, Think, ThoughtChain } from '@ant-design/x';
import type { AgentTraceStep, AgentTurnDetail, AgentTurnTrace } from '@jixie/shared';
import { getAgentTurn } from '@src/api/client';
import { Markdown } from './markdown';
import './agent-trace.css';

export function AgentTrace({ turnId }: { turnId: string }) {
  const { t } = useTranslation('components');
  const [turn, setTurn] = useState<AgentTurnDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || turn) {
      return;
    }
    void getAgentTurn(turnId)
      .then(setTurn)
      .catch(() => setFailed(true));
  }, [open, turn, turnId]);

  return (
    <div className="jx-agentTrace">
      <button className="jx-agentTrace-toggle" onClick={() => setOpen(!open)}>
        {open ? t('traceHide') : t('traceShow')}
      </button>
      {open && !turn && (
        <div className="jx-agentTrace-loading">{failed ? t('loadFailed') : t('traceLoading')}</div>
      )}
      {open && turn && <TraceChain trace={turn.trace} running={turn.status === 'running'} />}
    </div>
  );
}

export function LiveReasoning({ reasoning }: { reasoning: string }) {
  const { t } = useTranslation('components');
  if (!reasoning) {
    return null;
  }
  return (
    <Think title={t('reasoning')} loading defaultExpanded={false}>
      <Markdown text={reasoning} streaming />
    </Think>
  );
}

function TraceChain({ trace, running }: { trace: AgentTurnTrace; running: boolean }) {
  const { t } = useTranslation('components');
  return (
    <ThoughtChain
      items={trace.steps.map((step, index) => ({
        key: step.id,
        title: stepTitle(step, t),
        description: stepDescription(step, t),
        status: stepStatus(step, running && index === trace.steps.length - 1),
        collapsible: hasDetails(step),
        content: <StepDetail step={step} />,
      }))}
    />
  );
}

function StepDetail({ step }: { step: AgentTraceStep }) {
  const { t } = useTranslation('components');
  switch (step.type) {
    case 'model':
      return (
        <div className="jx-agentTrace-detail">
          {step.reasoning && (
            <Think
              title={t('reasoning')}
              loading={step.status === 'running'}
              defaultExpanded={false}
            >
              <Markdown text={step.reasoning} />
            </Think>
          )}
        </div>
      );
    case 'tool':
      return (
        <div className="jx-agentTrace-detail">
          <TraceCodeBlock value={step.arguments} title={t('traceArguments')} preferSql />
          <TraceCodeBlock value={step.observation} title={t('traceObservation')} />
        </div>
      );
    case 'validation':
      return step.error ? (
        <TraceCodeBlock value={step.error} title={t('traceError')} language="text" />
      ) : null;
    case 'error':
    case 'cancelled':
      return step.message ? (
        <TraceCodeBlock value={step.message} title={t('traceError')} language="text" />
      ) : null;
  }
}

function stepTitle(step: AgentTraceStep, t: TFunction<'components'>): string {
  switch (step.type) {
    case 'model':
      return t('traceModel', { count: step.modelCall });
    case 'tool':
      return t('traceTool', { name: step.name });
    case 'validation':
      return t('traceValidation', { round: step.round + 1 });
    case 'error':
      return t('traceError');
    case 'cancelled':
      return t('traceCancelled');
  }
}

function stepDescription(step: AgentTraceStep, t: TFunction<'components'>): string {
  if (step.type === 'tool') {
    return t('traceDuration', { duration: step.durationMs });
  }
  if (step.type === 'validation') {
    return step.ok ? t('tracePassed') : t('traceFailedStatus');
  }
  return '';
}

function stepStatus(
  step: AgentTraceStep,
  live: boolean,
): 'loading' | 'success' | 'error' | 'abort' {
  if (live || (step.type === 'model' && step.status === 'running')) {
    return 'loading';
  }
  if (step.type === 'cancelled' || (step.type === 'model' && step.status === 'abort')) {
    return 'abort';
  }
  if (
    step.type === 'error' ||
    (step.type === 'tool' && !step.ok) ||
    (step.type === 'validation' && !step.ok) ||
    (step.type === 'model' && step.status === 'error')
  ) {
    return 'error';
  }
  return 'success';
}

function hasDetails(step: AgentTraceStep): boolean {
  return (
    (step.type === 'model' && Boolean(step.reasoning)) ||
    step.type === 'tool' ||
    (step.type === 'validation' && Boolean(step.error)) ||
    ((step.type === 'error' || step.type === 'cancelled') && Boolean(step.message))
  );
}

function TraceCodeBlock({
  value,
  title,
  language,
  preferSql = false,
}: {
  value: string;
  title: string;
  language?: string;
  preferSql?: boolean;
}) {
  const formatted = formatTraceValue(value, preferSql);
  return (
    <div className="jx-agentTrace-code">
      <CodeHighlighter lang={language ?? formatted.language} header={title} prismLightMode>
        {formatted.content}
      </CodeHighlighter>
    </div>
  );
}

function formatTraceValue(
  value: string,
  preferSql: boolean,
): { language: string; content: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      preferSql &&
      parsed !== null &&
      typeof parsed === 'object' &&
      'sql' in parsed &&
      typeof (parsed as { sql?: unknown }).sql === 'string'
    ) {
      return { language: 'sql', content: (parsed as { sql: string }).sql };
    }
    return { language: 'json', content: JSON.stringify(parsed, null, 2) };
  } catch {
    return { language: 'text', content: value };
  }
}
