import type { zhLogin } from '../zh/login';

// English mirror of zhLogin (structurally identical — enforced by typeof).
export const enLogin: typeof zhLogin = {
  subtitle: 'A-share quant research platform',
  email: 'Email',
  continue: 'Continue',
  developmentLogin: 'Development login',
  inviteHint: 'Registering a new email requires an invite code',
  inviteCode: 'Invite code',
  invitePlaceholder: '12-character invite code',
  sendCode: 'Send code',
  changeEmail: 'Use a different email',
  codeSentTo: 'Code sent to {{email}}',
  codeLabel: '6-digit code',
  login: 'Log in',
  restart: 'Start over',
  requestFailed: 'Request failed',
};
