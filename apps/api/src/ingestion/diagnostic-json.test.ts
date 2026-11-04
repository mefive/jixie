import { expect, it } from 'vitest';
import { diagnosticJson } from './diagnostic-json.js';

it('redacts credentials including nested serialized payloads while preserving null and zero', () => {
  const input = {
    token: 'provider-secret',
    request: { api_key: 'key', Cookie: 'session-cookie' },
    payload: { cash_div: null, cash_div_tax: 0, ann_date: '20190423' },
    nested: JSON.stringify({ authorization: 'bearer', raw: { cash_div: 0 } }),
    url: 'https://example.test?token=hidden&ts_code=300587.SZ',
    observedAt: new Date('2026-11-04T00:00:00Z'),
  };
  const result = diagnosticJson(input);
  expect(JSON.stringify(result)).not.toContain('provider-secret');
  expect(result).toMatchObject({
    token: '[redacted]',
    request: { api_key: '[redacted]', Cookie: '[redacted]' },
    payload: { cash_div: null, cash_div_tax: 0, ann_date: '20190423' },
    nested: JSON.stringify({ authorization: '[redacted]', raw: { cash_div: 0 } }),
    url: 'https://example.test?token=[redacted]&ts_code=300587.SZ',
    observedAt: '2026-11-04T00:00:00.000Z',
  });
  expect(input.token).toBe('provider-secret');
});
