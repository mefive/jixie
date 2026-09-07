import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { RESEARCH_SDK_CONTRACT_V1, renderResearchSdkPythonParameter } from '@jixie/shared';
import { PublicDocsHeader } from '@src/components/public-docs-header';
import { localeStore } from '@src/i18n/locale-store';
import { complex } from './complex';
import './sdk-doc.css';

export const ResearchSdk = complex.component(() => {
  const [selectedName, setSelectedName] = useState(
    () => window.location.hash.slice(1) || 'data.series',
  );
  useEffect(() => {
    const onHashChange = () => setSelectedName(window.location.hash.slice(1) || 'data.series');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const locale = localeStore.locale;
  const method =
    RESEARCH_SDK_CONTRACT_V1.functions.find((entry) => entry.qualifiedName === selectedName) ??
    RESEARCH_SDK_CONTRACT_V1.functions[0];
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const signature = `${method.qualifiedName}(\n${method.parameters
    .map(
      (parameter, index) =>
        `${parameter.keywordOnly && !method.parameters[index - 1]?.keywordOnly ? '    *,\n' : ''}    ${renderResearchSdkPythonParameter(parameter)},`,
    )
    .join('\n')}\n)`;

  return (
    <div className="jx-docs">
      <PublicDocsHeader current="sdk" sdkKind="research" />
      <div className="jx-docs-layout">
        <nav className="jx-docs-nav" aria-label="Research Python SDK">
          <a className="jx-docs-navLink" href="/docs/sdk">
            {t('策略 SDK', 'Strategy SDK')}
          </a>
          {['data', 'valuation', 'results', 'charts'].map((namespace) => (
            <div className="jx-docs-navGroup" key={namespace}>
              <div className="jx-docs-navGroupTitle">{namespace}</div>
              {RESEARCH_SDK_CONTRACT_V1.functions
                .filter((entry) => entry.namespace === namespace)
                .map((entry) => (
                  <a
                    key={entry.qualifiedName}
                    href={`#${entry.qualifiedName}`}
                    onClick={() => setSelectedName(entry.qualifiedName)}
                    className={classNames('jx-docs-navLink', {
                      'jx-docs-navLink--on': method.qualifiedName === entry.qualifiedName,
                    })}
                  >
                    {entry.name}
                  </a>
                ))}
            </div>
          ))}
        </nav>
        <main className="jx-docs-main">
          <div className="jx-docs-eyebrow">Research Python SDK</div>
          <h1 className="jx-docs-h2">{method.qualifiedName}</h1>
          <p className="jx-docs-p">{t(method.descriptionZh, method.descriptionEn)}</p>
          <pre className="jx-docs-code">{signature}</pre>
          <section className="jx-docs-section">
            <h2 className="jx-docs-h2">{t('参数', 'Parameters')}</h2>
            {method.parameters.map((parameter) => (
              <div className="jx-docs-symbol" key={parameter.name}>
                <h3 className="jx-docs-symName">{parameter.name}</h3>
                <p className="jx-docs-p">{t(parameter.descriptionZh, parameter.descriptionEn)}</p>
                <p className="jx-docs-p">
                  {parameter.required ? t('必填', 'Required') : t('可选', 'Optional')}
                </p>
              </div>
            ))}
          </section>
          <section className="jx-docs-section">
            <h2 className="jx-docs-h2">{t('返回值', 'Returns')}</h2>
            {method.returns.kind === 'dataframe' ? (
              method.returns.columns.map((column) => (
                <div className="jx-docs-symbol" key={column.name}>
                  <h3 className="jx-docs-symName">
                    {column.name}: {column.pythonType}
                  </h3>
                  <p className="jx-docs-p">{t(column.descriptionZh, column.descriptionEn)}</p>
                </div>
              ))
            ) : (
              <p className="jx-docs-p">
                {method.returns.kind === 'mapping'
                  ? method.returns.pythonType
                  : t('原生交互图表', 'Native interactive chart')}
              </p>
            )}
          </section>
          <section className="jx-docs-section">
            <h2 className="jx-docs-h2">{t('语义与限制', 'Semantics and limits')}</h2>
            {(locale === 'zh' ? method.notesZh : method.notesEn).map((note) => (
              <p key={note} className="jx-docs-p">
                {note}
              </p>
            ))}
          </section>
          <section className="jx-docs-section">
            <h2 className="jx-docs-h2">{t('示例', 'Examples')}</h2>
            {method.examples.map((example) => (
              <pre className="jx-docs-code" key={example}>
                {example}
              </pre>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}, 'ResearchSdk');
