import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  login_required: {
    category: 'unauthorized',
    messageKey: 'loginRequired',
  },
  session_expired: {
    category: 'unauthorized',
    messageKey: 'sessionExpired',
  },
  session_disabled: {
    category: 'unauthorized',
    messageKey: 'accountDisabled',
  },
  account_disabled: {
    category: 'forbidden',
    messageKey: 'accountDisabled',
  },
  email_already_registered: {
    category: 'invalid',
    messageKey: 'emailAlreadyRegistered',
  },
  invite_code_required: {
    category: 'invalid',
    messageKey: 'inviteCodeRequired',
  },
  invite_code_invalid_format: {
    category: 'invalid',
    messageKey: 'inviteCodeInvalidFormat',
  },
  invite_code_invalid_or_used: {
    category: 'invalid',
    messageKey: 'inviteCodeInvalidOrUsed',
  },
  code_already_sent: {
    category: 'invalid',
    messageKey: 'codeAlreadySent',
  },
  email_send_failed: {
    category: 'unavailable',
    messageKey: 'emailSendFailed',
  },
  code_invalidated: {
    category: 'invalid',
    messageKey: 'codeInvalidated',
  },
  code_already_used: {
    category: 'invalid',
    messageKey: 'codeAlreadyUsed',
  },
  code_expired: {
    category: 'invalid',
    messageKey: 'codeExpired',
  },
  too_many_attempts: {
    category: 'invalid',
    messageKey: 'tooManyAttempts',
  },
  code_wrong: {
    category: 'invalid',
    messageKey: 'codeWrong',
  },
  register_needs_invite: {
    category: 'invalid',
    messageKey: 'registerNeedsInvite',
  },
  invite_code_expired: {
    category: 'invalid',
    messageKey: 'inviteCodeExpired',
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type AuthErrorReason = keyof typeof definitions;

export class AuthError extends BusinessError<AuthErrorReason> {
  constructor(reason: AuthErrorReason, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}
