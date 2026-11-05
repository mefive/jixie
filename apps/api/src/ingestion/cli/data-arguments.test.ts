import { expect, it } from 'vitest';
import { parseDataArguments } from './data.js';

it('reconciles all finished runs or one explicit run', () => {
  expect(parseDataArguments(['issues', 'reconcile'])).toEqual({
    action: 'reconcile-issues',
    runId: undefined,
  });
  expect(parseDataArguments(['issues', 'reconcile', 'RUN123'])).toEqual({
    action: 'reconcile-issues',
    runId: 'RUN123',
  });
  expect(() => parseDataArguments(['issues', 'reconcile', 'bad/id'])).toThrow('Usage:');
  expect(() => parseDataArguments(['issues', 'reconcile', 'RUN123', '--force'])).toThrow('Usage:');
});

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

it('requires explicit candidate version and explicit recovery acknowledgement', () => {
  const runId = '01M6F8ZGFR17X3ZMAX5Z7GD1DY';
  const hash = 'a'.repeat(64);
  expect(parseDataArguments(['runs', 'accept', runId, '--expect-candidate', hash])).toEqual({
    action: 'accept-run',
    runId,
    expectedVersion: hash,
  });
  expect(parseDataArguments(['runs', 'reject', runId, '--reason', 'Bad source'])).toEqual({
    action: 'reject-run',
    runId,
    reason: 'Bad source',
  });
  expect(() => parseDataArguments(['runs', 'recover', runId])).toThrow('Usage:');
  expect(parseDataArguments(['runs', 'recover', runId, '--confirm-stopped'])).toEqual({
    action: 'recover-run',
    runId,
  });
  expect(parseDataArguments(['runs', 'retry', runId])).toEqual({
    action: 'retry-run',
    runId,
  });
  expect(() => parseDataArguments(['runs', 'retry'])).toThrow('Usage:');
  expect(() => parseDataArguments(['runs', 'retry', runId, '--force'])).toThrow('Usage:');
});
