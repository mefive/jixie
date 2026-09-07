import { describe, expect, it, vi } from 'vitest';
import {
  assessMainBusinessObservations,
  probeMainBusinessSegments,
  summarizeMainBusinessRows,
} from './main-business-probe.js';

describe('main-business source probe', () => {
  it('retains source rows without guessing segment overlap from their sum', () => {
    const observation = summarizeMainBusinessRows(
      { tsCode: '000333.SZ', period: '20241231', type: 'P' },
      [
        {
          ts_code: '000333.SZ',
          end_date: '20241231',
          bz_item: 'Total products',
          bz_sales: 100,
          bz_profit: 25,
          bz_cost: 75,
          curr_type: 'CNY',
          update_flag: '0',
        },
        {
          ts_code: '000333.SZ',
          end_date: '20241231',
          bz_item: 'HVAC',
          bz_sales: 70,
          bz_profit: 20,
          bz_cost: 50,
          curr_type: 'CNY',
          update_flag: '0',
        },
        {
          ts_code: '000333.SZ',
          end_date: '20241231',
          bz_item: 'Other',
          bz_sales: 30,
          bz_profit: null,
          bz_cost: null,
          curr_type: 'CNY',
          update_flag: '0',
        },
      ],
    );

    expect(observation).toMatchObject({
      rowCount: 3,
      announcementDatesPresent: false,
      versionIdentifiersPresent: false,
      nullProfitRows: 1,
      nullCostRows: 1,
    });
  });

  it('detects renamed items between reporting periods and keeps the source out of the SDK', () => {
    const first = summarizeMainBusinessRows(
      { tsCode: '000858.SZ', period: '20241231', type: 'P' },
      [{ bz_item: 'Liquor', bz_sales: 100 }],
    );
    const second = summarizeMainBusinessRows(
      { tsCode: '000858.SZ', period: '20251231', type: 'P' },
      [{ bz_item: 'Alcohol products', bz_sales: 100 }],
    );
    const report = assessMainBusinessObservations([first, second]);

    expect(report).toMatchObject({
      itemNamesUnchangedAcrossPeriods: false,
      publicDecision: 'reject_pit_sdk',
      blockingReasons: expect.arrayContaining([
        'missing_announcement_dates',
        'item_names_changed_or_history_insufficient',
      ]),
    });
  });

  it('does not certify PIT from plausible timestamps, stable labels, or ordinary segments', () => {
    const rows = [
      {
        bz_item: 'A',
        bz_sales: 60,
        bz_cost: 40,
        bz_profit: 20,
        curr_type: 'CNY',
        ann_date: '20250401',
        version_id: '1',
      },
      {
        bz_item: 'B',
        bz_sales: 40,
        bz_cost: 30,
        bz_profit: 10,
        curr_type: 'USD',
        ann_date: '20250401',
        version_id: '1',
      },
    ];
    const first = summarizeMainBusinessRows(
      { tsCode: '000333.SZ', period: '20241231', type: 'P' },
      rows,
    );
    const second = summarizeMainBusinessRows(
      { tsCode: '000333.SZ', period: '20251231', type: 'P' },
      rows,
    );
    const report = assessMainBusinessObservations([first, second]);
    expect(first).not.toHaveProperty('aggregateOverlap');
    expect(first).not.toHaveProperty('salesSum');
    expect(first.sourceRows).toEqual(rows);
    expect(report).toMatchObject({
      itemNamesUnchangedAcrossPeriods: true,
      publicDecision: 'reject_pit_sdk',
    });
    expect(report.blockingReasons).toContain('historical_revision_availability_unverified');
    expect(report.blockingReasons).toContain('currency_requires_reconciliation');
    expect(assessMainBusinessObservations([]).blockingReasons).toContain('empty_source_sample');
  });

  it('records duplicate and conflicting source rows with order-independent fingerprints', () => {
    const probeCase = { tsCode: '000333.SZ', period: '20241231', type: 'P' as const };
    const rows = [
      { bz_item: 'A', bz_sales: 10 },
      { bz_item: 'A', bz_sales: 10 },
      { bz_item: 'A', bz_sales: 20 },
    ];
    const observation = summarizeMainBusinessRows(probeCase, rows);
    expect(observation).toMatchObject({
      duplicateRows: 1,
      conflictingItemRows: 1,
      announcementDatesPresent: false,
    });
    expect(summarizeMainBusinessRows(probeCase, [...rows].reverse()).responseFingerprint).toBe(
      observation.responseFingerprint,
    );
    expect(
      summarizeMainBusinessRows(probeCase, [{ ann_date: null, version_id: null }]),
    ).toMatchObject({ announcementDatesPresent: false, versionIdentifiersPresent: false });
  });

  it('runs bounded product, region, and industry calls without persisting rows', async () => {
    const call = vi.fn(async () => [
      {
        bz_item: 'Total',
        bz_sales: 100,
        bz_profit: 20,
        bz_cost: 80,
        curr_type: 'CNY',
        update_flag: '0',
      },
    ]);
    const cases = [
      { tsCode: '300750.SZ', period: '20241231', type: 'P' as const },
      { tsCode: '300750.SZ', period: '20241231', type: 'D' as const },
      { tsCode: '300750.SZ', period: '20241231', type: 'I' as const },
    ];
    const report = await probeMainBusinessSegments({ call }, cases);

    expect(call).toHaveBeenCalledTimes(3);
    expect(call).toHaveBeenNthCalledWith(1, 'fina_mainbz', {
      ts_code: '300750.SZ',
      period: '20241231',
      type: 'P',
    });
    expect(report.publicDecision).toBe('reject_pit_sdk');
  });
});
