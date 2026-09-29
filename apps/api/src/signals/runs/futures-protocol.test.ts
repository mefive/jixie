import { describe, expect, it } from 'vitest';
import { signalWorkerOutputSchema } from './worker-protocol.js';
import {
  signalAccountsSchema,
  resolutionContextSchema,
  signalFillSchema,
} from '@jixie/shared/api/signals';

const account = {
  version: 2,
  date: '20260618',
  cash: 0,
  positions: [],
  futures: { equity: 100000, margin: 0, availableCash: 100000, positions: [] },
  conditions: [],
  consumedConditions: [],
  equity: 100000,
  risk: [],
};
const legacy = {
  dataCutoff: '20260618',
  modelEquity: 100000,
  modelCash: 100000,
  modelPositions: [],
  signals: [],
  factorInputs: [],
};

describe('versioned signal protocol', () => {
  it('decodes historical cash payloads and round-trips the dual-account boundary', () => {
    expect(signalWorkerOutputSchema.parse(legacy).resultVersion).toBe(1);
    const output = { ...legacy, resultVersion: 2, modelAccounts: account, futureSignals: [] };
    expect(signalWorkerOutputSchema.parse(JSON.parse(JSON.stringify(output)))).toEqual(output);
  });

  it('rejects mismatched versions, missing account payloads and non-finite amounts', () => {
    expect(signalWorkerOutputSchema.safeParse({ ...legacy, resultVersion: 3 }).success).toBe(false);
    expect(signalWorkerOutputSchema.safeParse({ ...legacy, resultVersion: 2 }).success).toBe(false);
    expect(signalWorkerOutputSchema.safeParse({ ...legacy, modelAccounts: account }).success).toBe(
      false,
    );
    expect(signalAccountsSchema.safeParse({ ...account, equity: Infinity }).success).toBe(false);
  });

  it('requires timestamped exposure confirmation and observed-fill evidence', () => {
    const context = {
      expectedRevision: 0,
      clientRequestId: 'resolution',
      exposureAsOf: '2026-06-19T09:30:00+08:00',
      cashExposure: 1200000,
      price: 4000,
      priceSource: 'Recorded quote',
      dependenciesConfirmed: true,
    };
    expect(resolutionContextSchema.safeParse(context).success).toBe(true);
    expect(
      resolutionContextSchema.safeParse({ ...context, dependenciesConfirmed: false }).success,
    ).toBe(false);
    expect(
      resolutionContextSchema.safeParse({ ...context, exposureAsOf: '2026-06-19' }).success,
    ).toBe(false);
    expect(signalFillSchema.safeParse({ ...context, quantity: -1 }).success).toBe(false);
  });
});
