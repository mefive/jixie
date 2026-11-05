import { expect, it } from 'vitest';
import { DIVIDEND_SOURCE_FIELDS } from '#market/fundamentals/dividend-identity.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { planDividendUnits } from './dividend-plan.js';

it('reuses settled history and date receipts while planning missing history and daily gaps', async () =>
  withSyncDatabase(async (database) => {
    const clock = new Date('2019-01-03T08:00:00Z');
    await database.ingestionRun.create({
      data: {
        id: 'previous',
        trigger: 'manual',
        status: 'completed_with_issues',
        scopeSnapshot: {},
        targetDate: '20190102',
        startedAt: clock,
        finishedAt: clock,
      },
    });
    const addReceipt = (options: {
      scope: string;
      date: string;
      period: string;
      status?: string;
      fields?: string;
      responseComplete?: boolean;
      deferred?: boolean;
    }) => {
      const history = options.period === 'all';

      return database.ingestionBatch.create({
        data: {
          id: `${options.scope}/${options.period}`,
          runId: 'previous',
          dataset: 'dividends',
          scope: options.scope,
          period: options.period,
          api: 'dividend',
          request: [
            {
              api: 'dividend',
              params: history ? { ts_code: options.scope } : { [options.scope]: options.date },
              fields: options.fields ?? DIVIDEND_SOURCE_FIELDS,
            },
          ],
          rangeStart: history ? null : options.date,
          rangeEnd: options.deferred ? null : options.date,
          status: options.status ?? 'succeeded',
          responseComplete: options.responseComplete ?? true,
          startedAt: clock,
        },
      });
    };
    await addReceipt({ scope: '600000.SH', period: 'all', date: '20181231' });
    const partial = await addReceipt({
      scope: '600001.SH',
      period: 'all',
      date: '20181231',
      status: 'partial',
    });
    await database.ingestionIssue.create({
      data: {
        id: 'handled',
        runId: 'previous',
        batchId: partial.id,
        category: 'record',
        reasonCode: 'conflicting_business_key',
        message: 'Confirmed dividend conflict',
        payload: {},
        resolution: { create: { status: 'accepted', reason: 'Keep the current data' } },
      },
    });
    await addReceipt({
      scope: '600002.SH',
      period: 'all',
      date: '20181231',
      fields: 'ts_code,end_date',
    });
    await addReceipt({ scope: 'ann_date', period: '20190102', date: '20190102' });
    await addReceipt({
      scope: 'imp_ann_date',
      period: '20190101',
      date: '20190101',
      status: 'failed',
      responseComplete: false,
    });
    await addReceipt({
      scope: 'imp_ann_date',
      period: '20190102',
      date: '20190102',
      deferred: true,
    });

    const units = await planDividendUnits(
      ['600000.SH', '600001.SH', '600002.SH', '600003.SH'],
      '20190103',
      clock,
    );

    expect(units.map(({ scope, period }) => [scope, period])).toEqual([
      ['600002.SH', 'all'],
      ['600003.SH', 'all'],
      ['ann_date', '20190101'],
      ['imp_ann_date', '20190101'],
      ['imp_ann_date', '20190102'],
    ]);
  }));
