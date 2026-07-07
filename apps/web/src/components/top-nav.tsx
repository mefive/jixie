import { NavLink } from 'react-router-dom';
import classNames from 'classnames';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import { Button, Segmented } from 'antd';
import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Locale } from '@jixie/shared';
import { authStore } from '@src/store';
import { localeStore } from '@src/i18n/locale-store';
import banner from '@src/assets/banner.png';
import './top-nav.css';

/** Shared app header: banner + page nav + language switch + user/logout. */
export const TopNav = observer(() => {
  const { t } = useTranslation();

  return (
    <header className="jx-topnav">
      <div className="jx-topnav-left">
        <img className="jx-topnav-banner" src={banner} alt={t('appName')} />
        <nav className="jx-topnav-nav">
          <NavLink to="/lab" end className={linkClass}>
            {t('nav.backtest')}
          </NavLink>
          <NavLink to="/screen" className={linkClass}>
            {t('nav.screen')}
          </NavLink>
          <NavLink to="/factors" className={linkClass}>
            {t('nav.factor')}
          </NavLink>
        </nav>
      </div>
      <div className="jx-topnav-user">
        <Segmented
          size="small"
          value={localeStore.locale}
          onChange={(value) => localeStore.setLocale(value as Locale)}
          options={[
            { label: t('language.zh'), value: 'zh' },
            { label: t('language.en'), value: 'en' },
          ]}
        />
        <span className="jx-topnav-email">{authStore.user?.email}</span>
        <Button
          type="text"
          icon={<FontAwesomeIcon icon={faRightFromBracket} />}
          onClick={() => void authStore.logout()}
        >
          {t('logout')}
        </Button>
      </div>
    </header>
  );
});

// —— helpers ——

function linkClass({ isActive }: { isActive: boolean }): string {
  return classNames('jx-topnav-link', { 'jx-topnav-link--active': isActive });
}
