import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { openIngestionRun } from './runs.js';
import { getIngestionStatus } from './status.js';

it('keeps targets separate and exposes an older logical run while it is being resumed', async () =>
  withSyncDatabase(async (database) => {
    const first = await openIngestionRun('20181231', 'manual', new Date('2026-11-01T00:00:00Z'));
    await database.ingestionRun.update({
      where: { id: first.id },
      data: { status: 'interrupted', finishedAt: new Date('2026-11-01T00:01:00Z') },
    });
    const other = await openIngestionRun('20191231', 'manual', new Date('2026-11-02T00:00:00Z'));
    expect(other.id).not.toBe(first.id);
    const resumed = await openIngestionRun('20181231', 'manual', new Date('2026-11-03T00:00:00Z'));
    expect(resumed.id).toBe(first.id);
    expect(resumed.startedAt).toEqual(first.startedAt);
    expect((await getIngestionStatus()).runId).toBe(first.id);
    await database.ingestionRun.update({
      where: { id: first.id },
      data: { status: 'interrupted', finishedAt: new Date('2026-11-03T00:01:00Z') },
    });
    expect((await getIngestionStatus()).runId).toBe(first.id);
  }));

it('starts a fresh cycle after the latest completed run instead of resurrecting an older failed one', async () =>
  withSyncDatabase(async (database) => {
    await database.ingestionRun.createMany({
      data: [
        {
          id: 'old-failed',
          targetDate: '20181231',
          trigger: 'manual',
          status: 'failed',
          scopeSnapshot: {},
          startedAt: new Date('2026-11-01T00:00:00Z'),
        },
        {
          id: 'newer-completed',
          targetDate: '20181231',
          trigger: 'manual',
          status: 'completed',
          scopeSnapshot: {},
          startedAt: new Date('2026-11-02T00:00:00Z'),
        },
      ],
    });
    const next = await openIngestionRun('20181231', 'manual', new Date('2026-11-03T00:00:00Z'));
    expect(next.id).not.toBe('old-failed');
    expect(next.id).not.toBe('newer-completed');
  }));
