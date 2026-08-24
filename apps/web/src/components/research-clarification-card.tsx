import { useState } from 'react';
import { Button, Checkbox, Input, Radio, Tooltip } from 'antd';
import { faCheck, faCircleQuestion } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { ResearchClarificationSelectionV1, ResearchClarificationV1 } from '@jixie/shared';
import { useTranslation } from 'react-i18next';
import i18n from '@src/i18n';
import './research-clarification-card.css';

interface ResearchClarificationCardProps {
  clarification: ResearchClarificationV1;
  busy: boolean;
  onAnswer?: (
    clarification: ResearchClarificationV1,
    selections: ResearchClarificationSelectionV1[],
  ) => Promise<void>;
}

export default function ResearchClarificationCard({
  clarification,
  busy,
  onAnswer,
}: ResearchClarificationCardProps) {
  const { t } = useTranslation('research');
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      clarification.questions.map((question) => [
        question.id,
        clarification.answer?.selections.find((selection) => selection.questionId === question.id)
          ?.selectedOptionIds ?? [],
      ]),
    ),
  );
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      clarification.questions.map((question) => [
        question.id,
        clarification.answer?.selections.find((selection) => selection.questionId === question.id)
          ?.customText ?? '',
      ]),
    ),
  );
  const pending = clarification.status === 'pending';
  const selections = clarification.questions.map(
    (question): ResearchClarificationSelectionV1 => ({
      questionId: question.id,
      selectedOptionIds: selected[question.id] ?? [],
      ...(custom[question.id]?.trim() ? { customText: custom[question.id].trim() } : {}),
    }),
  );
  const valid = clarification.questions.every((question) => {
    const selectedCount = selected[question.id]?.length ?? 0;
    return selectedCount > 0 || Boolean(custom[question.id]?.trim());
  });

  return (
    <section
      className="jx-researchClarification"
      data-testid={`research-clarification-${clarification.id}`}
    >
      <header className="jx-researchClarification-head">
        <span className="jx-researchClarification-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faCircleQuestion} />
        </span>
        <strong>{clarification.title}</strong>
        <span
          className={`jx-researchClarification-status jx-researchClarification-status--${clarification.status}`}
        >
          {t(`workbench.clarification.status.${clarification.status}`)}
        </span>
      </header>

      <div className="jx-researchClarification-questions">
        {clarification.questions.map((question) => (
          <fieldset key={question.id} className="jx-researchClarification-question">
            <legend>{question.prompt}</legend>
            {question.selectionMode === 'single' ? (
              <Radio.Group
                className="jx-researchClarification-options"
                value={selected[question.id]?.[0]}
                disabled={!pending || busy}
                onChange={(event) =>
                  setSelected((current) => ({
                    ...current,
                    [question.id]: [event.target.value],
                  }))
                }
              >
                {question.options.map((option) => (
                  <Radio
                    key={option.id}
                    className="jx-researchClarification-option"
                    value={option.id}
                  >
                    <OptionCopy option={option} />
                  </Radio>
                ))}
              </Radio.Group>
            ) : (
              <Checkbox.Group
                className="jx-researchClarification-options"
                value={selected[question.id] ?? []}
                disabled={!pending || busy}
                onChange={(values) =>
                  setSelected((current) => ({
                    ...current,
                    [question.id]: values.map(String),
                  }))
                }
              >
                {question.options.map((option) => (
                  <Checkbox
                    key={option.id}
                    className="jx-researchClarification-option"
                    value={option.id}
                  >
                    <OptionCopy option={option} />
                  </Checkbox>
                ))}
              </Checkbox.Group>
            )}
            {question.allowCustom && (
              <Input.TextArea
                className="jx-researchClarification-custom"
                value={custom[question.id] ?? ''}
                disabled={!pending || busy}
                autoSize={{ minRows: 1, maxRows: 3 }}
                placeholder={t('workbench.clarification.customPlaceholder')}
                onChange={(event) =>
                  setCustom((current) => ({ ...current, [question.id]: event.target.value }))
                }
              />
            )}
          </fieldset>
        ))}
      </div>

      {pending && (
        <footer className="jx-researchClarification-actions">
          <Tooltip title={t('workbench.clarification.submit')}>
            <Button
              className="jx-researchClarification-submit"
              type="primary"
              shape="circle"
              loading={busy}
              disabled={!valid || !onAnswer}
              aria-label={t('workbench.clarification.submit')}
              icon={!busy ? <FontAwesomeIcon icon={faCheck} /> : undefined}
              onClick={() => void onAnswer?.(clarification, selections)}
            />
          </Tooltip>
        </footer>
      )}
    </section>
  );
}

function OptionCopy({
  option,
}: {
  option: ResearchClarificationV1['questions'][number]['options'][number];
}) {
  const useChinese = i18n.resolvedLanguage?.startsWith('zh') ?? true;
  return (
    <span className="jx-researchClarification-optionCopy">
      <strong>{useChinese ? option.labelZh : option.labelEn}</strong>
      <small>{useChinese ? option.descriptionZh : option.descriptionEn}</small>
    </span>
  );
}
