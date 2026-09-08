import type { Locale, ResearchClarificationV1 } from '@jixie/shared';
import { t } from '../../i18n/index.js';

export function researchClarificationAnswerMessage(
  locale: Locale,
  clarification: ResearchClarificationV1,
): string {
  const selections = clarification.answer?.selections.flatMap((selection) => {
    const question = clarification.questions.find(
      (candidate) => candidate.id === selection.questionId,
    );
    if (!question) {
      return [];
    }
    const labels = selection.selectedOptionIds.flatMap((optionId) => {
      const option = question.options.find((candidate) => candidate.id === optionId);
      return option ? [locale === 'zh' ? option.labelZh : option.labelEn] : [];
    });
    if (selection.customText) {
      labels.push(selection.customText);
    }
    return labels;
  });
  return t(locale, 'researchClarificationAnswerMessage', {
    selections: selections?.join(locale === 'zh' ? '；' : '; ') || '-',
  });
}
