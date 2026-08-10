import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from './report-spec.js';

const mocks = vi.hoisted(() => ({
  factorFindFirst: vi.fn(),
  reportFindFirst: vi.fn(),
  factorUpdateMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    factor: {
      findFirst: mocks.factorFindFirst,
      updateMany: mocks.factorUpdateMany,
    },
    factorReport: { findFirst: mocks.reportFindFirst },
  },
}));

import { FactorPublicationError, publishFactor } from './publication.js';

const CODE = `export default defineFactor({ compute: (bar) => bar.pb });`;
const COMMODITY_CARRY_CODE = `export default defineFactorV2({
  version: 2,
  name: 'Commodity carry',
  analysisKind: 'panel',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['commodity.futures.annualizedLogCarry'],
  targetAssetClasses: ['commodity'],
  window: 2,
  compute(ctx) { return ctx.value('commodity.futures.annualizedLogCarry'); },
});`;
const COMMODITY_CARRY_TIME_SERIES_CODE = COMMODITY_CARRY_CODE.replace(
  "analysisKind: 'panel'",
  "analysisKind: 'time_series'",
);
const COMMODITY_WAREHOUSE_RECEIPT_TIME_SERIES_CODE = COMMODITY_CARRY_TIME_SERIES_CODE.replaceAll(
  'commodity.futures.annualizedLogCarry',
  'commodity.warehouseReceipt.volume',
);

describe('immutable Factor publication', () => {
  beforeEach(() => {
    mocks.factorFindFirst.mockReset().mockResolvedValue({
      id: 'factor-1',
      key: 'book_to_market',
      name: 'Book to market',
      code: CODE,
      analysisKind: 'cross_sectional',
      status: 'draft',
    });
    mocks.reportFindFirst.mockReset().mockResolvedValue({
      id: 'report-1',
      analysisKind: 'cross_sectional',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: CODE,
      factorCodeHash: sha256(CODE),
    });
    mocks.factorUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it('locks the factor against the exact approved report snapshot', async () => {
    const published = await publishFactor('user-1', 'factor-1', 'report-1');

    expect(mocks.factorUpdateMany).toHaveBeenCalledWith({
      where: { id: 'factor-1', userId: 'user-1', status: 'draft' },
      data: expect.objectContaining({
        status: 'published',
        approvedReportId: 'report-1',
        codeHash: sha256(CODE),
      }),
    });
    expect(published).toMatchObject({
      id: 'factor-1',
      key: 'book_to_market',
      status: 'published',
      approvedReportId: 'report-1',
    });
  });

  it('rejects an outdated report snapshot', async () => {
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'cross_sectional',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: `${CODE}\n`,
      factorCodeHash: sha256(`${CODE}\n`),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_outdated'),
    );
  });

  it('rejects already published factors', async () => {
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-1',
      key: 'book_to_market',
      name: 'Book to market',
      code: CODE,
      analysisKind: 'cross_sectional',
      status: 'published',
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('not_draft'),
    );
  });

  it('rejects a sealed holdout report', async () => {
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'cross_sectional',
      phase: 'holdout',
      revealedAt: null,
      factorCodeSnapshot: CODE,
      factorCodeHash: sha256(CODE),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_invalid'),
    );
  });

  it('keeps the controlled commodity-carry template research-only', async () => {
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-1',
      key: 'commodity_carry',
      name: 'Commodity carry',
      code: COMMODITY_CARRY_CODE,
      analysisKind: 'panel',
      status: 'draft',
    });
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'panel',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: COMMODITY_CARRY_CODE,
      factorCodeHash: sha256(COMMODITY_CARRY_CODE),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_invalid'),
    );
    expect(mocks.factorUpdateMany).not.toHaveBeenCalled();
  });

  it('also keeps the commodity-carry time-series template research-only', async () => {
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-1',
      key: 'commodity_carry_time_series',
      name: 'Commodity carry time series',
      code: COMMODITY_CARRY_TIME_SERIES_CODE,
      analysisKind: 'time_series',
      status: 'draft',
    });
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'time_series',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: COMMODITY_CARRY_TIME_SERIES_CODE,
      factorCodeHash: sha256(COMMODITY_CARRY_TIME_SERIES_CODE),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_invalid'),
    );
    expect(mocks.factorUpdateMany).not.toHaveBeenCalled();
  });

  it('keeps warehouse-receipt research inputs out of published Factors', async () => {
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-1',
      key: 'commodity_warehouse_receipt_pressure',
      name: 'Commodity warehouse-receipt pressure',
      code: COMMODITY_WAREHOUSE_RECEIPT_TIME_SERIES_CODE,
      analysisKind: 'time_series',
      status: 'draft',
    });
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'time_series',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: COMMODITY_WAREHOUSE_RECEIPT_TIME_SERIES_CODE,
      factorCodeHash: sha256(COMMODITY_WAREHOUSE_RECEIPT_TIME_SERIES_CODE),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_invalid'),
    );
    expect(mocks.factorUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a latest-vintage macro report even when its source snapshot matches', async () => {
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-1',
      key: 'macro_regime',
      name: 'Macro regime',
      code: CODE,
      analysisKind: 'macro_regime',
      status: 'draft',
    });
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'macro_regime',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: CODE,
      factorCodeHash: sha256(CODE),
      specJson: JSON.stringify({
        version: 1,
        analysisKind: 'macro_regime',
        start: '20200101',
        end: '20250101',
        observationFrequency: 'monthly',
        targetAssets: ['510300.SH'],
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: {
          pointInTime: true,
          revisionPolicy: 'latest_vintage',
          dataCutoff: '20260809',
        },
        stateModel: { kind: 'threshold', states: 4 },
      }),
      payload: JSON.stringify({ pointInTimeEligible: false, futureVintageRows: 775 }),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_invalid'),
    );
    expect(mocks.factorUpdateMany).not.toHaveBeenCalled();
  });

  it('allows a macro report only when both its policy and payload prove PIT eligibility', async () => {
    mocks.factorFindFirst.mockResolvedValue({
      id: 'factor-1',
      key: 'macro_regime',
      name: 'Macro regime',
      code: CODE,
      analysisKind: 'macro_regime',
      status: 'draft',
    });
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'macro_regime',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: CODE,
      factorCodeHash: sha256(CODE),
      specJson: JSON.stringify({
        version: 1,
        analysisKind: 'macro_regime',
        start: '20270101',
        end: '20290101',
        observationFrequency: 'monthly',
        targetAssets: ['510300.SH'],
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: {
          pointInTime: true,
          revisionPolicy: 'as_available',
          dataCutoff: '20290131',
        },
        stateModel: { kind: 'threshold', states: 4 },
      }),
      payload: JSON.stringify({ pointInTimeEligible: true, futureVintageRows: 0 }),
    });

    await expect(publishFactor('user-1', 'factor-1', 'report-1')).resolves.toMatchObject({
      status: 'published',
      analysisKind: 'macro_regime',
    });
  });
});
