export interface AuthFailure {
  error: {
    code: 'VALIDATION_FAILED' | 'FORBIDDEN' | 'SERVICE_UNAVAILABLE';
    message: string;
    details?: unknown;
  };
}

// Business failures carry no HTTP status or framework context.
export function authFailure(
  code: AuthFailure['error']['code'],
  message: string,
  details?: unknown,
): AuthFailure {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}
