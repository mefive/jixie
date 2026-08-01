import { describe, expect, it } from 'vitest';
import {
  addReferenceSyncSummary,
  chunkReferenceCodes,
  emptyReferenceSyncSummary,
} from './reference-worker-process.js';

describe('reference worker process', () => {
  it('splits codes into bounded process batches', () => {
    expect(chunkReferenceCodes(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  it('aggregates worker summaries', () => {
    expect(
      addReferenceSyncSummary(emptyReferenceSyncSummary(), {
        requested: 2,
        skipped: 0,
        processed: 2,
        changed: 1,
        created: 3,
        updated: 4,
        deleted: 5,
      }),
    ).toEqual({
      requested: 2,
      skipped: 0,
      processed: 2,
      changed: 1,
      created: 3,
      updated: 4,
      deleted: 5,
    });
  });
});
