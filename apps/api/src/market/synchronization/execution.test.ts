import { expect, it } from 'vitest';
import { sourceCaptureStartedAt, sourceExecution, sourceRequests } from './execution.js';
import { statementReceiptMatchesBatch } from '../fundamentals/statement-requests.js';
import { financialStatementSourceFields } from '../fundamentals/source-contract.js';

it('accepts legacy receipts and validates versioned execution metadata independently', () => {
  const requests = [
    {
      api: 'income_vip',
      params: { start_date: '20000101', end_date: '20221001', report_type: '1' },
      fields: financialStatementSourceFields('income').join(','),
    },
  ];
  const execution = {
    sourceStartedAt: '2026-11-07T00:01:00.000Z',
    sourceFinishedAt: '2026-11-07T00:01:01.000Z',
    downloadMs: 1000,
    rateLimitMs: 10,
    queueMs: 200,
    prepareMs: 5,
    writeMs: 1,
    httpRequests: 1,
    retries: 0,
  };
  const request = { version: 2, requests, execution };
  const batch = {
    scope: 'income|1',
    period: 'ann_range/20000101/20221001',
    rangeStart: '20000101',
    rangeEnd: '20221001',
    request,
  };
  expect(statementReceiptMatchesBatch(batch)).toBe(true);
  expect(statementReceiptMatchesBatch({ ...batch, request: requests })).toBe(true);
  expect(sourceRequests(request)).toEqual(requests);
  expect(sourceRequests({ version: 3, requests })).toBeUndefined();
  expect(sourceExecution(request)).toEqual(execution);
  expect(sourceExecution(requests)).toBeNull();
  expect(sourceCaptureStartedAt({ request, startedAt: new Date('2026-11-06T23:59:00Z') })).toEqual(
    new Date(execution.sourceStartedAt),
  );
  expect(
    sourceCaptureStartedAt({ request: requests, startedAt: new Date('2026-11-06T23:59:00Z') }),
  ).toEqual(new Date('2026-11-06T23:59:00Z'));
});
