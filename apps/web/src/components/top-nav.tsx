import { NavLink } from 'react-router-dom';
import classNames from 'classnames';
import { observer } from 'mobx-react';
import { Button } from 'antd';
import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { authStore } from '@src/store';
import banner from '@src/assets/banner.png';
import './top-nav.css';

/** Shared app header: banner + page nav (回测工作台 / 选股看图) + user/logout. */
export const TopNav = observer(() => {
  return (
    <header className="jx-topnav">
      <div className="jx-topnav-left">
        <img className="jx-topnav-banner" src={banner} alt="机械交易系" />
        <nav className="jx-topnav-nav">
          <NavLink to="/lab" end className={linkClass}>
            回测工作台
          </NavLink>
          <NavLink to="/screen" className={linkClass}>
            选股看图
          </NavLink>
        </nav>
      </div>
      <div className="jx-topnav-user">
        <span className="jx-topnav-email">{authStore.user?.email}</span>
        <Button
          type="text"
          icon={<FontAwesomeIcon icon={faRightFromBracket} />}
          onClick={() => void authStore.logout()}
        >
          退出
        </Button>
      </div>
    </header>
  );
});

// —— helpers ——

function linkClass({ isActive }: { isActive: boolean }): string {
  return classNames('jx-topnav-link', { 'jx-topnav-link--active': isActive });
}
