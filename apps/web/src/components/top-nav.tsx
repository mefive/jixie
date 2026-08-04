import { NavLink, useLocation } from 'react-router-dom';
import classNames from 'classnames';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Segmented, type MenuProps } from 'antd';
import { faBars, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Locale } from '@jixie/shared';
import { authStore } from '@src/store';
import { localeStore } from '@src/i18n/locale-store';
import banner from '@src/assets/banner.png';
import './top-nav.css';

/** Shared app header: banner + page nav + language switch + user/logout. */
export const TopNav = observer(() => {
  const { t } = useTranslation();
  const location = useLocation();
  const activeMobileKey = mobileNavKey(location.pathname);
  const mobileMenuItems: MenuProps['items'] = [
    { key: 'market', label: <NavLink to="/market">{t('nav.market')}</NavLink> },
    { key: 'backtest', label: <NavLink to="/lab">{t('nav.backtest')}</NavLink> },
    { key: 'screen', label: <NavLink to="/screen">{t('nav.screen')}</NavLink> },
    { key: 'factor', label: <NavLink to="/factors">{t('nav.factor')}</NavLink> },
    { key: 'valuation', label: <NavLink to="/valuation">{t('nav.valuation')}</NavLink> },
    { key: 'signals', label: <NavLink to="/signals">{t('nav.signals')}</NavLink> },
    {
      key: 'help',
      label: (
        <a href="/docs/help" target="_blank" rel="noopener noreferrer">
          {t('nav.help')}
        </a>
      ),
    },
  ];

  return (
    <header className="jx-topnav">
      <div className="jx-topnav-left">
        <img className="jx-topnav-banner" src={banner} alt={t('appName')} />
        <Dropdown
          menu={{ items: mobileMenuItems, selectedKeys: [activeMobileKey] }}
          placement="bottomLeft"
          trigger={['click']}
        >
          <Button
            className="jx-topnav-mobileMenu"
            type="text"
            icon={<FontAwesomeIcon icon={faBars} />}
            aria-label={t('nav.menu')}
          >
            <span className="jx-topnav-mobileMenuText">
              {t(`nav.${MOBILE_NAV_LABEL_KEYS[activeMobileKey]}`)}
            </span>
          </Button>
        </Dropdown>
        <nav className="jx-topnav-nav">
          <NavLink to="/market" className={linkClass}>
            {t('nav.market')}
          </NavLink>
          <NavLink to="/lab" end className={linkClass}>
            {t('nav.backtest')}
          </NavLink>
          <NavLink to="/screen" className={linkClass}>
            {t('nav.screen')}
          </NavLink>
          <NavLink to="/factors" className={linkClass}>
            {t('nav.factor')}
          </NavLink>
          <NavLink to="/valuation" className={linkClass}>
            {t('nav.valuation')}
          </NavLink>
          <NavLink to="/signals" className={linkClass}>
            {t('nav.signals')}
          </NavLink>
          <a href="/docs/help" className="jx-topnav-link" target="_blank" rel="noopener noreferrer">
            {t('nav.help')}
          </a>
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
          <span className="jx-topnav-logoutText">{t('logout')}</span>
        </Button>
      </div>
    </header>
  );
});

// —— helpers ——

function linkClass({ isActive }: { isActive: boolean }): string {
  return classNames('jx-topnav-link', { 'jx-topnav-link--active': isActive });
}

const MOBILE_NAV_LABEL_KEYS = {
  backtest: 'backtest',
  screen: 'screen',
  factor: 'factor',
  market: 'market',
  valuation: 'valuation',
  signals: 'signals',
} as const;

type MobileNavKey = keyof typeof MOBILE_NAV_LABEL_KEYS;

function mobileNavKey(pathname: string): MobileNavKey {
  if (pathname.startsWith('/screen') || pathname.startsWith('/stock')) {
    return 'screen';
  }
  if (pathname.startsWith('/factors')) {
    return 'factor';
  }
  if (pathname.startsWith('/market')) {
    return 'market';
  }
  if (pathname.startsWith('/valuation')) {
    return 'valuation';
  }
  if (pathname.startsWith('/signals')) {
    return 'signals';
  }

  return 'backtest';
}
