import { observer } from 'mobx-react';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import type { Locale } from '@jixie/shared';
import banner from '@src/assets/banner.png';
import { localeStore } from '@src/i18n/locale-store';
import './public-docs-header.css';

export const PublicDocsHeader = observer(function PublicDocsHeader({
  current,
}: {
  current: 'help' | 'sdk';
}) {
  const locale = localeStore.locale;
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);

  return (
    <header className="jx-publicDocsHeader">
      <Link className="jx-publicDocsHeader-brand" to={current === 'help' ? '/help' : '/docs'}>
        <img className="jx-publicDocsHeader-banner" src={banner} alt={t('机械交易系', 'Jixie')} />
        <span className="jx-publicDocsHeader-brandSub">
          {current === 'help' ? t('· 使用帮助', '· Help') : t('· 策略 SDK', '· Strategy SDK')}
        </span>
      </Link>

      <nav className="jx-publicDocsHeader-nav" aria-label={t('公开文档', 'Public documentation')}>
        <Link
          className="jx-publicDocsHeader-link"
          to="/help"
          aria-current={current === 'help' ? 'page' : undefined}
        >
          {t('使用帮助', 'Help')}
        </Link>
        <Link
          className="jx-publicDocsHeader-link"
          to="/docs"
          aria-current={current === 'sdk' ? 'page' : undefined}
        >
          {t('SDK 文档', 'SDK Reference')}
        </Link>
        <div
          className="jx-publicDocsHeader-language"
          aria-label={t('显示语言', 'Display language')}
        >
          {(['zh', 'en'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={classNames('jx-publicDocsHeader-languageButton', {
                'jx-publicDocsHeader-languageButton--active': locale === option,
              })}
              onClick={() => localeStore.setLocale(option as Locale)}
            >
              {option === 'zh' ? '中文' : 'EN'}
            </button>
          ))}
        </div>
      </nav>
    </header>
  );
});
