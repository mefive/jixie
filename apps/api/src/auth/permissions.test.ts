import { describe, expect, it, vi, afterEach } from 'vitest';
import { canPublishIngestion, describeAuthUser } from './permissions.js';

const user = { id: 'reader', email: 'reader@example.test', name: null };

afterEach(() => vi.unstubAllEnvs());

describe('ingestion publication permission', () => {
  it('requires an explicit development environment or an exact normalized administrator email', () => {
    expect(canPublishIngestion(user, {})).toBe(false);
    expect(canPublishIngestion(user, { NODE_ENV: 'test' })).toBe(false);
    expect(canPublishIngestion(user, { NODE_ENV: 'development' })).toBe(true);
    expect(
      canPublishIngestion(user, {
        NODE_ENV: 'production',
        JIXIE_ADMIN_EMAILS: ' other@example.test, READER@EXAMPLE.TEST ',
      }),
    ).toBe(true);
    expect(
      canPublishIngestion(user, {
        NODE_ENV: 'production',
        JIXIE_ADMIN_EMAILS: 'other-reader@example.test',
      }),
    ).toBe(false);
    expect(
      canPublishIngestion(
        { ...user, email: '' },
        {
          NODE_ENV: 'production',
          JIXIE_ADMIN_EMAILS: '',
        },
      ),
    ).toBe(false);
  });

  it('maps the same capability into login and refreshed-session identities', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JIXIE_ADMIN_EMAILS', 'reader@example.test');
    expect(describeAuthUser(user)).toEqual({ ...user, capabilities: { publishIngestion: true } });
    vi.stubEnv('JIXIE_ADMIN_EMAILS', '');
    expect(describeAuthUser(user).capabilities.publishIngestion).toBe(false);
  });
});
