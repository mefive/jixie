import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, seedSessions } from '../../../tests/market-contract-fixtures.js';
import { normalizeStockIdentity } from './normalize-identity.js';
import { STOCK_CODE_CHANGES } from './stock-identity.js';
import { fingerprint } from '../synchronization/rows.js';
import { FINANCIAL_STATEMENT_FIELDS } from '../fundamentals/source-contract.js';

const change = STOCK_CODE_CHANGES[0];
const date = '20150105';
const codes = [change.oldTsCode, change.newTsCode];

describe('stored stock identity reconciliation', () => {
  it('prefers successor snapshots and keeps legacy provenance unknown', async () =>
    withSyncDatabase(async (database) => {
      await database.daily.createMany({
        data: codes.map((tsCode, index) => ({ tsCode, tradeDate: date, close: 10 + index })),
      });
      await database.adjFactor.createMany({
        data: codes.map((tsCode, index) => ({ tsCode, tradeDate: date, adjFactor: 1 + index })),
      });
      await database.dailyBasic.createMany({
        data: codes.map((tsCode, index) => ({
          tsCode,
          tradeDate: date,
          dvRatio: index ? 1.7865 : null,
        })),
      });
      await database.stkLimit.createMany({
        data: codes.map((tsCode, index) => ({
          tsCode,
          tradeDate: date,
          upLimit: 10 + index,
          downLimit: 1,
        })),
      });
      await database.stockNameHistory.createMany({
        data: codes.map((tsCode, index) => ({ tsCode, startDate: date, name: `name${index}` })),
      });
      await database.finaIndicator.createMany({
        data: codes.map((tsCode, index) => ({ tsCode, endDate: '20141231', roe: index })),
      });
      await database.indexWeight.createMany({
        data: codes.map((conCode, index) => ({
          indexCode: '000300.SH',
          conCode,
          tradeDate: date,
          weight: 10 + index,
        })),
      });
      await database.dividend.createMany({
        data: codes.map((tsCode, index) => {
          const identity = {
            tsCode,
            endDate: '20141231',
            annDate: date,
            exDate: date,
            divProc: '实施',
          };
          return {
            ...identity,
            id: index ? fingerprint(identity) : 'legacy-dividend-id',
            cashDiv: index,
            observedAt: new Date('2026-09-01T00:00:00Z'),
          };
        }),
      });

      await database.$transaction((transaction) => normalizeStockIdentity(transaction, change));
      expect(await database.daily.findMany()).toMatchObject([
        { tsCode: change.newTsCode, close: 11, sourceTsCode: null },
      ]);
      expect(await database.adjFactor.findMany()).toMatchObject([{ adjFactor: 2 }]);
      expect(await database.dailyBasic.findMany()).toMatchObject([{ dvRatio: 1.7865 }]);
      expect(await database.stkLimit.findMany()).toMatchObject([{ upLimit: 11 }]);
      expect(await database.stockNameHistory.findMany()).toMatchObject([{ name: 'name1' }]);
      expect(await database.finaIndicator.findMany()).toMatchObject([{ roe: 1 }]);
      expect(await database.indexWeight.findMany()).toMatchObject([{ weight: 11 }]);
      expect(await database.dividend.findMany()).toMatchObject([
        { cashDiv: 1, observedAt: new Date('2026-09-01T00:00:00Z') },
      ]);
      const repeated = await database.$transaction((transaction) =>
        normalizeStockIdentity(transaction, change),
      );
      expect(repeated.changed).toBe(false);
    }));

  it('uses recorded origin and atomically rejects equal-source conflicts', async () =>
    withSyncDatabase(async (database) => {
      await database.daily.createMany({
        data: [
          { tsCode: change.oldTsCode, sourceTsCode: change.newTsCode, tradeDate: date, close: 11 },
          { tsCode: change.newTsCode, sourceTsCode: change.oldTsCode, tradeDate: date, close: 10 },
        ],
      });
      await database.$transaction((transaction) => normalizeStockIdentity(transaction, change));
      expect(await database.daily.findMany()).toMatchObject([
        { tsCode: change.newTsCode, sourceTsCode: change.newTsCode, close: 11 },
      ]);
      await database.daily.create({
        data: {
          tsCode: change.oldTsCode,
          sourceTsCode: change.newTsCode,
          tradeDate: date,
          close: 12,
        },
      });
      await expect(
        database.$transaction((transaction) => normalizeStockIdentity(transaction, change)),
      ).rejects.toThrow('same-source');
      expect(await database.daily.count()).toBe(2);
    }));

  it('moves all version identities without changing source evidence or capture times', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260901');
      for (const kind of ['income', 'balance_sheet', 'cash_flow']) {
        const fields = Object.fromEntries(
          FINANCIAL_STATEMENT_FIELDS.filter((field) => field.statementKind === kind).map(
            (field) => [field.sourceField, null],
          ),
        );
        await acceptSource(
          database,
          {
            call: async () =>
              codes.map((ts_code) => ({
                ...fields,
                ts_code,
                end_date: '20260630',
                ann_date: '20260831',
                f_ann_date: '20260831',
                report_type: '1',
                comp_type: '1',
                update_flag: '0',
              })),
          },
          {
            dataset: 'financial-statements',
            scope: `${kind}|1`,
            startDate: '20260630',
            endDate: '20260630',
          },
        );
      }
      await database.finaIndicatorVersion.createMany({
        data: codes.map((sourceTsCode) => ({
          id: sourceTsCode,
          tsCode: sourceTsCode,
          sourceTsCode,
          endDate: '20260630',
          availableDate: '20260901',
          availabilityQuality: 'latest_only',
          sourceFingerprint: sourceTsCode,
          observedAt: new Date('2026-08-31T00:00:00Z'),
        })),
      });
      const moveBack = {
        where: { sourceTsCode: change.oldTsCode },
        data: { tsCode: change.oldTsCode },
      };
      await database.financialIncomeStatement.updateMany(moveBack);
      await database.financialBalanceSheet.updateMany(moveBack);
      await database.financialCashFlowStatement.updateMany(moveBack);
      const readVersions = async () =>
        [
          ...(await database.finaIndicatorVersion.findMany()),
          ...(await database.financialIncomeStatement.findMany()),
          ...(await database.financialBalanceSheet.findMany()),
          ...(await database.financialCashFlowStatement.findMany()),
        ].sort((left, right) => left.id.localeCompare(right.id));
      const before = await readVersions();

      await database.$transaction((transaction) => normalizeStockIdentity(transaction, change));
      expect(await readVersions()).toEqual(
        before.map((row) => ({ ...row, tsCode: change.newTsCode })),
      );
      expect(before).toHaveLength(8);
    }));
});
