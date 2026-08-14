import { Collapse } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ResearchFormulaDefinitionV1, ResearchFormulaGroupV1 } from '@jixie/shared';
import { Markdown } from './markdown';
import './research-formulae.css';

interface ResearchFormulaeProps {
  formulae: ResearchFormulaDefinitionV1[];
  zh: boolean;
}

export function ResearchFormulae({ formulae, zh }: ResearchFormulaeProps) {
  const { t } = useTranslation('research');
  const items = FORMULA_GROUPS.flatMap((group) => {
    const groupedFormulae = formulae.filter(
      (formula) => (formula.group ?? 'core_estimate') === group,
    );
    if (groupedFormulae.length === 0) {
      return [];
    }

    return [
      {
        key: group,
        label: t(`result.formulaGroup.${group}`),
        children: (
          <div className="jx-researchFormulae-group">
            {groupedFormulae.map((formula) => (
              <section key={formula.id} className="jx-researchFormulae-formula">
                <h4>{zh ? formula.labelZh : formula.labelEn}</h4>
                <div className="jx-researchFormulae-equation">
                  <Markdown text={`$$${formula.latex}$$`} />
                </div>
                {formula.variables.length > 0 && (
                  <div className="jx-researchFormulae-variables">
                    <h5>{t('result.formulaVariables')}</h5>
                    <dl>
                      {formula.variables.map((variable) => (
                        <div key={variable.symbol}>
                          <dt>
                            <Markdown text={`$${variable.symbol}$`} />
                          </dt>
                          <dd>{zh ? variable.descriptionZh : variable.descriptionEn}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </section>
            ))}
          </div>
        ),
      },
    ];
  });

  if (items.length === 0) {
    return null;
  }

  return (
    <Collapse
      className="jx-researchFormulae"
      size="small"
      defaultActiveKey={['core_estimate']}
      items={items}
    />
  );
}

const FORMULA_GROUPS: ResearchFormulaGroupV1[] = ['core_estimate', 'inference', 'robustness'];
