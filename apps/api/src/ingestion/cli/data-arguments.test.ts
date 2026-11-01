import { expect, it } from 'vitest';
import { parseDataArguments } from './data.js';

it('accepts a target date and keeps destructive reset explicit', () => {
  expect(parseDataArguments(['ingest', '--to', '20261030'])).toEqual({
    action: 'ingest',
    targetDate: '20261030',
  });
  expect(parseDataArguments(['reset'])).toEqual({ action: 'reset', apply: false });
  expect(parseDataArguments(['reset', '--apply'])).toEqual({ action: 'reset', apply: true });
  expect(parseDataArguments(['issues', 'RUN123'])).toEqual({ action: 'issues', runId: 'RUN123' });
});
it.each([
  ['sync'],
  ['ingest', '--to', '20260230'],
  ['ingest', '--from', '20150101'],
  ['reset', '--database', 'relative.db'],
  ['reset', '--apply', '--apply'],
])('rejects obsolete or invalid arguments: %j', (...args) => {
  expect(() => parseDataArguments(args)).toThrow('Usage: pnpm data');
});
