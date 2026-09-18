import { describe, expect, it } from 'vitest';
import { summarizeMacroPit } from './audit.js';

describe('market data audit', () => {
  it('audits macro availability evidence and vintage disclosure', () => {
    const result = summarizeMacroPit(
      ['cn_pmi_manufacturing', 'cn_cpi_yoy'],
      [
        {
          seriesKey: 'cn_pmi_manufacturing',
          period: '202601',
          releaseDate: '20260201',
          availableDate: '20260202',
          availabilityKind: 'official_schedule',
          vintageKind: 'captured_as_available',
        },
        {
          seriesKey: 'cn_cpi_yoy',
          period: '202601',
          releaseDate: null,
          availableDate: '20260221',
          availabilityKind: 'conservative_lag',
          vintageKind: 'latest_value_backfill',
        },
        {
          seriesKey: 'cn_cpi_yoy',
          period: '202602',
          releaseDate: '20260310',
          availableDate: '20260309',
          availabilityKind: 'official_schedule',
          vintageKind: 'captured_as_available',
        },
      ],
      new Set(['20260202', '20260309']),
    );

    expect(result).toEqual({
      missingSeries: [
        'cn_ppi_yoy',
        'cn_m1_balance',
        'cn_m1_yoy',
        'cn_m2_balance',
        'cn_m2_yoy',
        'cn_social_financing_increment',
        'cn_social_financing_stock',
        'cn_shibor_overnight',
        'cn_shibor_1w',
        'cn_shibor_1m',
        'cn_shibor_3m',
        'us_cpi_u_all_items_nsa',
      ],
      invalidAvailabilityRows: 1,
      nonTradingAvailabilityRows: 1,
      conservativeLagRows: 1,
      latestValueBackfillRows: 1,
      capturedAsAvailableRows: 2,
    });
  });
});
