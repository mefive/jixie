import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { faArrowLeft, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { authStore } from '@src/store';
import { complex } from './complex';
import './login.css';

export const Login = complex.component(() => {
  const store = complex.useStore();
  const navigate = useNavigate();

  // 已登录（含登录成功后 setUser）→ 进首页。
  // authed 在 render 期读取 → observer 追踪，authStore 变化触发重渲染，effect 依此重跑。
  const authed = authStore.authenticated;
  useEffect(() => {
    if (authed) navigate('/', { replace: true });
  }, [navigate, authed]);

  return (
    <div className="jx-login">
      <div className="jx-login-card">
        <div className="jx-login-brand">机械系</div>
        <div className="jx-login-subtitle">A 股量化研究平台</div>

        {store.step === 'email' && <EmailStep />}
        {store.step === 'invite' && <InviteStep />}
        {store.step === 'verify' && <VerifyStep />}

        {store.errorMessage && <div className="jx-login-error">{store.errorMessage}</div>}
      </div>
    </div>
  );
}, 'Login');

// —— 子组件 / 帮助函数 ——

const EmailStep = complex.component(() => {
  const store = complex.useStore();
  const loading = store.requestLoader.loading;
  return (
    <form
      className="jx-login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void store.submitEmail();
      }}
    >
      <label className="jx-login-label">邮箱</label>
      <input
        className="jx-login-input"
        type="email"
        autoFocus
        placeholder="you@example.com"
        value={store.email}
        onChange={(e) => store.setEmail(e.target.value)}
      />
      <button className="jx-login-button" type="submit" disabled={loading || !store.email.trim()}>
        {loading && <FontAwesomeIcon icon={faSpinner} spin />} 继续
      </button>
    </form>
  );
}, 'EmailStep');

const InviteStep = complex.component(() => {
  const store = complex.useStore();
  const loading = store.requestLoader.loading;
  return (
    <form
      className="jx-login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void store.submitInvite();
      }}
    >
      <div className="jx-login-hint">新邮箱注册需要邀请码</div>
      <label className="jx-login-label">邀请码</label>
      <input
        className="jx-login-input"
        autoFocus
        placeholder="12 位邀请码"
        value={store.inviteCode}
        onChange={(e) => store.setInviteCode(e.target.value)}
      />
      <button
        className="jx-login-button"
        type="submit"
        disabled={loading || !store.inviteCode.trim()}
      >
        {loading && <FontAwesomeIcon icon={faSpinner} spin />} 发送验证码
      </button>
      <button className="jx-login-back" type="button" onClick={() => store.back()}>
        <FontAwesomeIcon icon={faArrowLeft} /> 换个邮箱
      </button>
    </form>
  );
}, 'InviteStep');

const VerifyStep = complex.component(() => {
  const store = complex.useStore();
  const loading = store.verifyLoader.loading;
  return (
    <form
      className="jx-login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void store.submitCode();
      }}
    >
      <div className="jx-login-hint">验证码已发送至 {store.email}</div>
      <label className="jx-login-label">6 位验证码</label>
      <input
        className="jx-login-input jx-login-input--code"
        autoFocus
        inputMode="numeric"
        maxLength={6}
        placeholder="······"
        value={store.code}
        onChange={(e) => store.setCode(e.target.value.replace(/\D/g, ''))}
      />
      <button className="jx-login-button" type="submit" disabled={loading || store.code.length !== 6}>
        {loading && <FontAwesomeIcon icon={faSpinner} spin />} 登录
      </button>
      <button className="jx-login-back" type="button" onClick={() => store.back()}>
        <FontAwesomeIcon icon={faArrowLeft} /> 重新开始
      </button>
    </form>
  );
}, 'VerifyStep');
