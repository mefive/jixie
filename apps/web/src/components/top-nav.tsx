import { NavLink, useLocation } from 'react-router-dom';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Menu, Segmented, Tooltip, type MenuProps } from 'antd';
import { faBars, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Locale } from '@jixie/shared';
import { authStore } from '@src/store';
import { deploymentVersionStore } from '@src/store/deployment-version-store';
import { localeStore } from '@src/i18n/locale-store';
import banner from '@src/assets/banner.png';
import './top-nav.css';

/** Shared app header: banner + page nav + language switch + user/logout. */
export const TopNav = observer(() => {
  const { t } = useTranslation();
  const location = useLocation();
  const versionLoader = deploymentVersionStore.loader;
  const revision = versionLoader.result?.revision;
  const versionLabel = revision
    ? t('deploymentVersion.label', { revision: revision.slice(0, 8) })
    : t(
        versionLoader.error
          ? 'deploymentVersion.unavailable'
          : versionLoader.loaded
            ? 'deploymentVersion.missing'
            : 'deploymentVersion.loading',
      );
  const activeNavigationKey = navigationKey(location.pathname);
  const selectedNavigationKeys = activeNavigationKey ? [activeNavigationKey] : [];
  const navigationItems: MenuProps['items'] = [
    { key: 'market', label: <NavLink to="/market">{t('nav.market')}</NavLink> },
    {
      key: 'factorWeather',
      label: <NavLink to="/factor-weather">{t('nav.factorWeather')}</NavLink>,
    },
    { key: 'strategy', label: <NavLink to="/strategy">{t('nav.strategy')}</NavLink> },
    { key: 'research', label: <NavLink to="/research">{t('nav.research')}</NavLink> },
    { key: 'factor', label: <NavLink to="/factors">{t('nav.factor')}</NavLink> },
    { key: 'valuation', label: <NavLink to="/valuation">{t('nav.valuation')}</NavLink> },
    { key: 'signals', label: <NavLink to="/signals">{t('nav.signals')}</NavLink> },
    { key: 'library', label: <NavLink to="/library">{t('nav.library')}</NavLink> },
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
          menu={{ items: navigationItems, selectedKeys: selectedNavigationKeys }}
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
              {activeNavigationKey
                ? t(`nav.${NAVIGATION_LABEL_KEYS[activeNavigationKey]}`)
                : t('nav.menu')}
            </span>
          </Button>
        </Dropdown>
        <Menu
          className="jx-topnav-nav"
          mode="horizontal"
          items={navigationItems}
          selectedKeys={selectedNavigationKeys}
        />
      </div>
      <div className="jx-topnav-user">
        <Tooltip
          title={revision ? t('deploymentVersion.details', { revision }) : versionLabel}
          trigger={['hover', 'focus', 'click']}
        >
          <Button className="jx-topnav-version" type="text" size="small" aria-label={versionLabel}>
            <span className="jx-topnav-versionLabel">{versionLabel}</span>
          </Button>
        </Tooltip>
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

const NAVIGATION_LABEL_KEYS = {
  strategy: 'strategy',
  research: 'research',
  factor: 'factor',
  market: 'market',
  factorWeather: 'factorWeather',
  valuation: 'valuation',
  signals: 'signals',
  library: 'library',
  help: 'help',
} as const;

type NavigationKey = keyof typeof NAVIGATION_LABEL_KEYS;

function navigationKey(pathname: string): NavigationKey | undefined {
  if (pathname.startsWith('/research') || pathname.startsWith('/objects')) {
    return 'research';
  }
  if (pathname.startsWith('/factors')) {
    return 'factor';
  }
  if (pathname.startsWith('/factor-weather')) {
    return 'factorWeather';
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
  if (pathname.startsWith('/library')) {
    return 'library';
  }
  if (pathname.startsWith('/strategy')) {
    return 'strategy';
  }

  return undefined;
}
