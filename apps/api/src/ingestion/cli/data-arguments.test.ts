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

it('accepts diagnostic export arguments in either option order', () => {
  expect(parseDataArguments(['issues', 'export', 'RUN123', '--out', 'diagnostics.json'])).toEqual({
    action: 'export-issues',
    runId: 'RUN123',
    output: 'diagnostics.json',
  });
  expect(
    parseDataArguments([
      'issues',
      'export',
      'RUN123',
      '--issue',
      'ISSUE123',
      '--out',
      '/tmp/one.json',
    ]),
  ).toEqual({
    action: 'export-issues',
    runId: 'RUN123',
    issueId: 'ISSUE123',
    output: '/tmp/one.json',
  });
  expect(
    parseDataArguments(['issues', 'export', 'RUN123', '--out', 'one.json', '--issue', 'ISSUE123']),
  ).toEqual({
    action: 'export-issues',
    runId: 'RUN123',
    issueId: 'ISSUE123',
    output: 'one.json',
  });
});

it.each([
  ['issues', 'export'],
  ['issues', 'export', 'RUN123'],
  ['issues', 'export', 'RUN123', '--out'],
  ['issues', 'export', 'RUN123', '--out', 'a.json', '--out', 'b.json'],
  ['issues', 'export', 'RUN123', '--out', 'a.json', '--issue', 'bad/id'],
  ['issues', 'export', 'RUN123', '--out', 'a.json', '--force'],
  ['issues', 'export', 'RUN123', '--out', '  '],
])('rejects incomplete, duplicate or unknown diagnostic export options: %j', (...args) => {
  expect(() => parseDataArguments(args)).toThrow('Usage: pnpm data');
});

it('lists five recent runs by default and supports a bounded explicit limit', () => {
  expect(parseDataArguments(['runs'])).toEqual({ action: 'runs', limit: 5 });
  expect(parseDataArguments(['runs', '--limit', '1'])).toEqual({ action: 'runs', limit: 1 });
  expect(parseDataArguments(['runs', '--limit', '100'])).toEqual({ action: 'runs', limit: 100 });
});

it.each([
  ['runs', '--limit'],
  ['runs', '--limit', '0'],
  ['runs', '--limit', '-1'],
  ['runs', '--limit', '101'],
  ['runs', '--limit', '1.5'],
  ['runs', '--limit', 'NaN'],
  ['runs', '--limit', '1', '--limit', '2'],
  ['runs', '--limit', '9007199254740993'],
  ['runs', '--all'],
])('rejects invalid or duplicate run listing limits: %j', (...args) => {
  expect(() => parseDataArguments(args)).toThrow('Usage: pnpm data');
});
