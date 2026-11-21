import { OWNER_ONLY_DIRECTORY } from '#infra/file-permissions.js';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from 'ulid';
import { withVersionedStorage } from '../../tests/versioned-storage.js';
import { getApplicationDatabase } from '#infra/database/prisma.js';
import { withMarketAccess, withMaintenanceLock } from '#infra/coordination/market-access.js';
import {
  boundMarketVersionId,
  getCandidateDatabase,
  getMarketDatabase,
  withMarketDatabase,
} from '#infra/database/market-database.js';
import { cloneMarketFile, marketVersionFile } from './version-files.js';
import { publishSealedCandidate } from './version-publication.js';

it(
  'pins the 2016 market while publishing a candidate containing the next decade',
  async () =>
    withVersionedStorage(async () => {
      const app = getApplicationDatabase();
      const first = ulid();
      const second = ulid();
      const firstFile = marketVersionFile(first);
      await mkdir(dirname(firstFile), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
      const schema = await readFile(
        new URL(
          '../../prisma/market/migrations/20261116000000_market_baseline/migration.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const empty = new DatabaseSync(firstFile);
      try {
        empty.exec(schema);
      } finally {
        empty.close();
      }

      const addPrice = (tradeDate: string) =>
        getCandidateDatabase().daily.create({
          data: { tsCode: '600000.SH', tradeDate, close: 10 },
        });
      await withMarketDatabase(firstFile, 'candidate', () => addPrice('20161116'));
      const baseline = await app.marketPublication.findUniqueOrThrow({ where: { key: 'global' } });
      const claim = (id: string, parentVersionId: string | null, parentSequence: number) =>
        app.marketVersion.create({
          data: {
            id,
            runId: id,
            targetDate: parentVersionId ? '20261114' : '20161116',
            phase: 'publishing',
            activeSlot: 1,
            operation: 'fixture',
            candidateVersion: id,
            parentVersionId,
            parentSequence,
            selectionVersion: 0,
          },
        });
      const publish = (id: string) =>
        withMaintenanceLock(() => publishSealedCandidate(id, 'fixture', id));
      await claim(first, baseline.currentVersionId, 0);
      await publish(first);

      await cloneMarketFile(first, second);
      await withMarketDatabase(marketVersionFile(second), 'candidate', () => addPrice('20261113'));
      await claim(second, first, 1);

      let readerReady!: () => void;
      let finish!: () => void;
      const ready = new Promise<void>((resolve) => {
        readerReady = resolve;
      });
      const release = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const originalReader = withMarketAccess(async () => {
        expect(boundMarketVersionId()).toBe(first);
        expect(getApplicationDatabase()).toBe(app);
        await expect(getMarketDatabase().daily.deleteMany()).rejects.toThrow();
        expect(() => getCandidateDatabase()).toThrow('writable candidate');
        readerReady();
        await release;
        expect(await getMarketDatabase().daily.count()).toBe(1);
      });
      try {
        await Promise.race([ready, originalReader]);
        await publish(second);
        await withMarketAccess(async () => {
          expect(boundMarketVersionId()).toBe(second);
          expect(await getMarketDatabase().daily.count()).toBe(2);
        });
      } finally {
        finish();
        await originalReader;
      }
      expect((await publish(second)).publishedRevision).toBe(2);
      expect(
        await app.marketPublication.findUniqueOrThrow({ where: { key: 'global' } }),
      ).toMatchObject({
        sequence: 2,
        previousVersionId: first,
        currentVersionId: second,
      });
    }),
  60_000,
);

it(
  'keeps the current publication when a candidate contains a broken foreign key',
  async () =>
    withVersionedStorage(async () => {
      const app = getApplicationDatabase();
      const baseline = await app.marketPublication.findUniqueOrThrow({ where: { key: 'global' } });
      if (!baseline.currentVersionId) {
        throw new Error('Expected a published baseline');
      }

      const id = ulid();
      await cloneMarketFile(baseline.currentVersionId, id);

      const candidate = new DatabaseSync(marketVersionFile(id));
      try {
        candidate.exec('PRAGMA foreign_keys=OFF');
        candidate.exec(
          "INSERT INTO IngestionIssueResolution (issueId, updatedAt) VALUES ('missing-issue', CURRENT_TIMESTAMP)",
        );
      } finally {
        candidate.close();
      }

      await app.marketVersion.create({
        data: {
          id,
          runId: id,
          targetDate: '20261114',
          phase: 'publishing',
          activeSlot: 1,
          operation: 'fixture',
          candidateVersion: id,
          parentVersionId: baseline.currentVersionId,
          parentSequence: baseline.sequence,
          selectionVersion: baseline.selectionVersion,
        },
      });

      await expect(
        withMaintenanceLock(() => publishSealedCandidate(id, 'fixture', id)),
      ).rejects.toThrow('Market file failed sealing checks');

      expect(await app.marketPublication.findUniqueOrThrow({ where: { key: 'global' } })).toEqual(
        baseline,
      );
    }),
  60_000,
);
