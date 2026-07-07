import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { faArrowLeft, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { authStore } from '@src/store';
import banner from '@src/assets/banner.png';
import { complex } from './complex';
import './login.css';

export const Login = complex.component(() => {
  const store = complex.useStore();
  const navigate = useNavigate();
  const { t } = useTranslation('login');

  // Already authed (including after setUser on successful login) → go to home page.
  // authed is read during render → tracked by observer, authStore changes trigger re-render, effect re-runs accordingly.
  const authed = authStore.authenticated;
  useEffect(() => {
    if (authed) {
      navigate('/', { replace: true });
    }
  }, [navigate, authed]);

  return (
    <div className="jx-login">
      <div className="jx-login-card">
        <img className="jx-login-banner" src={banner} alt={t('common:appName')} />
        <div className="jx-login-subtitle">{t('subtitle')}</div>

        {store.step === 'email' && <EmailStep />}
        {store.step === 'invite' && <InviteStep />}
        {store.step === 'verify' && <VerifyStep />}

        {store.errorMessage && <div className="jx-login-error">{store.errorMessage}</div>}
      </div>
    </div>
  );
}, 'Login');

// —— Subcomponents / helpers ——

const EmailStep = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('login');
  const loading = store.requestLoader.loading;
  return (
    <form
      className="jx-login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void store.submitEmail();
      }}
    >
      <label className="jx-login-label">{t('email')}</label>
      <input
        className="jx-login-input"
        type="email"
        autoFocus
        placeholder="you@example.com"
        value={store.email}
        onChange={(e) => store.setEmail(e.target.value)}
      />
      <button className="jx-login-button" type="submit" disabled={loading || !store.email.trim()}>
        {loading && <FontAwesomeIcon icon={faSpinner} spin />} {t('continue')}
      </button>
    </form>
  );
}, 'EmailStep');

const InviteStep = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('login');
  const loading = store.requestLoader.loading;
  return (
    <form
      className="jx-login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void store.submitInvite();
      }}
    >
      <div className="jx-login-hint">{t('inviteHint')}</div>
      <label className="jx-login-label">{t('inviteCode')}</label>
      <input
        className="jx-login-input"
        autoFocus
        placeholder={t('invitePlaceholder')}
        value={store.inviteCode}
        onChange={(e) => store.setInviteCode(e.target.value)}
      />
      <button
        className="jx-login-button"
        type="submit"
        disabled={loading || !store.inviteCode.trim()}
      >
        {loading && <FontAwesomeIcon icon={faSpinner} spin />} {t('sendCode')}
      </button>
      <button className="jx-login-back" type="button" onClick={() => store.back()}>
        <FontAwesomeIcon icon={faArrowLeft} /> {t('changeEmail')}
      </button>
    </form>
  );
}, 'InviteStep');

const VerifyStep = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('login');
  const loading = store.verifyLoader.loading;
  return (
    <form
      className="jx-login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void store.submitCode();
      }}
    >
      <div className="jx-login-hint">{t('codeSentTo', { email: store.email })}</div>
      <label className="jx-login-label">{t('codeLabel')}</label>
      <input
        className="jx-login-input jx-login-input--code"
        autoFocus
        inputMode="numeric"
        maxLength={6}
        placeholder="······"
        value={store.code}
        onChange={(e) => store.setCode(e.target.value.replace(/\D/g, ''))}
      />
      <button
        className="jx-login-button"
        type="submit"
        disabled={loading || store.code.length !== 6}
      >
        {loading && <FontAwesomeIcon icon={faSpinner} spin />} {t('login')}
      </button>
      <button className="jx-login-back" type="button" onClick={() => store.back()}>
        <FontAwesomeIcon icon={faArrowLeft} /> {t('restart')}
      </button>
    </form>
  );
}, 'VerifyStep');
