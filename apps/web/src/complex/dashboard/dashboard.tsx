import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { authStore } from '@src/store';
import logo from '@src/assets/logo.png';
import { complex } from './complex';
import './dashboard.css';

export const Dashboard = complex.component(() => {
  return (
    <div className="jx-dashboard">
      <header className="jx-dashboard-header">
        <div className="jx-dashboard-brand">
          <img className="jx-dashboard-logo" src={logo} alt="" />
          机械交易系
        </div>
        <div className="jx-dashboard-user">
          <span className="jx-dashboard-email">{authStore.user?.email}</span>
          <button className="jx-dashboard-logout" onClick={() => void authStore.logout()}>
            <FontAwesomeIcon icon={faRightFromBracket} /> 退出
          </button>
        </div>
      </header>

      <main className="jx-dashboard-body">
        <div className="jx-dashboard-placeholder">
          因子研究与回测面板建设中 —— 数据通道、行情落库已就绪。
        </div>
      </main>
    </div>
  );
}, 'Dashboard');
