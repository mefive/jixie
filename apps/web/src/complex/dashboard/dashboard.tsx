import { useTranslation } from 'react-i18next';
import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { authStore } from '@src/store';
import logo from '@src/assets/logo.png';
import { complex } from './complex';
import './dashboard.css';

export const Dashboard = complex.component(() => {
  const { t } = useTranslation('dashboard');
  return (
    <div className="jx-dashboard">
      <header className="jx-dashboard-header">
        <div className="jx-dashboard-brand">
          <img className="jx-dashboard-logo" src={logo} alt="" />
          {t('common:appName')}
        </div>
        <div className="jx-dashboard-user">
          <span className="jx-dashboard-email">{authStore.user?.email}</span>
          <button className="jx-dashboard-logout" onClick={() => void authStore.logout()}>
            <FontAwesomeIcon icon={faRightFromBracket} /> {t('common:logout')}
          </button>
        </div>
      </header>

      <main className="jx-dashboard-body">
        <div className="jx-dashboard-placeholder">{t('placeholder')}</div>
      </main>
    </div>
  );
}, 'Dashboard');
