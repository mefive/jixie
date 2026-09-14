import type { ChatMessage } from '@jixie/shared';
import { useTranslation } from 'react-i18next';
import { Alert } from 'antd';
import './factor-question-context.css';

interface FactorQuestionContextProps {
  message: ChatMessage;
  selectedReportId: string;
}

export function FactorQuestionContext({ message, selectedReportId }: FactorQuestionContextProps) {
  const { t } = useTranslation('factor');
  const context = message.contextSnapshot;
  if (!context) {
    return null;
  }
  const report = context.report;
  const failed =
    message.turnStatus && ['error', 'cancelled', 'interrupted'].includes(message.turnStatus);
  return (
    <div className="jx-factorQuestion-context" data-testid="factor-question-context">
      <details>
        <summary>
          {t('questions.context', { factor: context.factor.name })} ·{' '}
          {report ? t('questions.report', { id: report.id }) : t('questions.definitionOnly')}
        </summary>
        <p>{t('questions.savedAt', { date: context.capturedAt })}</p>
        {report && selectedReportId !== report.id && <p>{t('questions.differentReport')}</p>}
        <p>
          {t('questions.savedDefinition')} · {context.factor.key} · {context.factor.sourceHash}
        </p>
        <pre>{context.factor.source}</pre>
        {report && (
          <>
            <p>{t('questions.summaryOnly')}</p>
            <pre>{JSON.stringify(report.summary, null, 2)}</pre>
            <p>
              {t('questions.reportHash')} · {report.contentHash}
            </p>
            {report.factorCodeSnapshot && (
              <details>
                <summary>{t('questions.reportCode')}</summary>
                <pre>{report.factorCodeSnapshot}</pre>
              </details>
            )}
          </>
        )}
      </details>
      {failed && (
        <Alert
          type="warning"
          showIcon
          message={t(
            `questions.status.${message.turnStatus as 'error' | 'cancelled' | 'interrupted'}`,
          )}
          description={message.turnStatus === 'error' ? message.turnError : undefined}
        />
      )}
    </div>
  );
}
