import { describe, expect, it, vi } from 'vitest';
import { TushareError } from './client.js';
import {
  ASSET_ALLOCATION_PROBES,
  probeAssetAllocationData,
  type AssetAllocationProbeDefinition,
} from './asset-allocation-probe.js';

const definitions: AssetAllocationProbeDefinition[] = [
  { domain: 'rates', apiName: 'available', params: (date) => ({ date }) },
  { domain: 'rates', apiName: 'empty', params: () => ({}) },
  { domain: 'commodity', apiName: 'forbidden', params: () => ({}) },
  { domain: 'commodity', apiName: 'bad_request', params: () => ({}) },
  { domain: 'macro', apiName: 'offline', params: () => ({}) },
];

describe('asset-allocation Tushare probe', () => {
  it('uses a bounded cross-month window for monthly LPR verification', () => {
    expect(
      ASSET_ALLOCATION_PROBES.find((probe) => probe.apiName === 'shibor_lpr')?.params('20260807'),
    ).toEqual({ start_date: '20260623', end_date: '20260807' });
  });

  it('records every outcome and continues after expected permission failures', async () => {
    const call = vi.fn(async (apiName: string) => {
      if (apiName === 'available') {
        return [{ date: '20260805', value: 1 }];
      }
      if (apiName === 'empty') {
        return [];
      }
      if (apiName === 'forbidden') {
        throw new TushareError(apiName, 40203, 'permission denied');
      }
      if (apiName === 'bad_request') {
        throw new TushareError(apiName, 50101, 'missing ts_code');
      }
      throw new Error('connection closed');
    });

    const results = await probeAssetAllocationData({ call }, '20260805', definitions);

    expect(call).toHaveBeenCalledTimes(5);
    expect(results).toEqual([
      {
        catalogVersion: 1,
        domain: 'rates',
        apiName: 'available',
        status: 'ok',
        rowCount: 1,
        fields: ['date', 'value'],
        sample: { date: '20260805', value: 1 },
      },
      {
        catalogVersion: 1,
        domain: 'rates',
        apiName: 'empty',
        status: 'empty',
        rowCount: 0,
        fields: [],
      },
      {
        catalogVersion: 1,
        domain: 'commodity',
        apiName: 'forbidden',
        status: 'permission_denied',
        rowCount: 0,
        fields: [],
        errorCode: 40203,
        errorMessage: 'permission denied',
      },
      {
        catalogVersion: 1,
        domain: 'commodity',
        apiName: 'bad_request',
        status: 'request_error',
        rowCount: 0,
        fields: [],
        errorCode: 50101,
        errorMessage: 'missing ts_code',
      },
      {
        catalogVersion: 1,
        domain: 'macro',
        apiName: 'offline',
        status: 'network_error',
        rowCount: 0,
        fields: [],
        errorMessage: 'connection closed',
      },
    ]);
  });
});
