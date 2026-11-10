import { expect, it } from 'vitest';
import {
  estimatePublicationBudget,
  loadPublicationBudgetProfile,
  type PublicationWorkload,
  type PublicationBudgetProfile,
} from './publication-budget.js';

const work: PublicationWorkload = {
  model: 'daily',
  estimatedTableRows: 1000,
  indexCount: 1,
  inserted: 100,
  updated: 10,
  deleted: 5,
  bytes: 1000,
  insertedBytes: 500,
  updatedBytes: 400,
  deletedBytes: 100,
  calls: 12,
  indexMutations: 115,
};
const profile: PublicationBudgetProfile = {
  version: 1,
  evidence: 'test-only synthetic calibration',
  bufferPercent: 50,
  minimumMs: 1,
  commitMs: 100,
  tables: [
    {
      model: 'daily',
      maximumRows: 2000,
      indexCount: 1,
      insertMs: 1,
      updateMs: 4,
      deleteMs: 2,
      insertByteMs: 0.1,
      updateByteMs: 0.1,
      deleteByteMs: 0.1,
      callMs: 2,
      indexMutationMs: 0.2,
    },
  ],
};

it('uses operation mix, bytes, calls, indexes and one overall percentage buffer', () => {
  expect(estimatePublicationBudget([work], profile)).toMatchObject({
    mode: 'estimated',
    estimatedMs: 397,
    timeoutMs: 596,
    bufferPercent: 50,
  });
  expect(estimatePublicationBudget([{ ...work, updated: 20 }], profile).timeoutMs).toBeGreaterThan(
    596,
  );
});
it('falls back instead of extrapolating from missing calibration or an undersized bucket', () => {
  expect(estimatePublicationBudget([work])).toMatchObject({ mode: 'fallback', timeoutMs: 1800000 });
  expect(estimatePublicationBudget([{ ...work, estimatedTableRows: 5000 }], profile).mode).toBe(
    'fallback',
  );
  expect(estimatePublicationBudget([{ ...work, estimatedTableRows: null }], profile).mode).toBe(
    'fallback',
  );
});
it('honors a minimum and rejects a budget beyond timer capacity before publication', () => {
  expect(estimatePublicationBudget([], { ...profile, minimumMs: 5000 }).timeoutMs).toBe(5000);
  expect(() => estimatePublicationBudget([], { ...profile, commitMs: 3_000_000_000 })).toThrow(
    'timer range',
  );
});

it('loads bundled calibration without environment configuration', () => {
  const bundled = loadPublicationBudgetProfile();
  expect(bundled.bufferPercent).toBe(50);
  expect(estimatePublicationBudget([{ ...work, indexCount: 2 }], bundled).mode).toBe('estimated');
});

it('falls back for unmeasured zero-placeholder operations in the bundled profile', () => {
  const bundled = loadPublicationBudgetProfile();
  expect(
    estimatePublicationBudget([{ ...work, model: 'dailyBasic', indexCount: 2 }], bundled),
  ).toMatchObject({
    mode: 'fallback',
    reason: 'No calibrated update cost for dailyBasic',
    timeoutMs: 1800000,
  });
});
