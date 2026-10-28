import { describe, expect, it, vi } from 'vitest';
import { TushareError } from '../../errors.js';
import {
  probeAssetAllocationData,
  type AssetAllocationProbeDefinition,
} from './asset-allocation-probe.js';

const definitions: AssetAllocationProbeDefinition[] = [
  { domain: 'etf', apiName: 'available', params: (date) => ({ date }) },
  { domain: 'etf', apiName: 'empty', params: () => ({}) },
  { domain: 'etf', apiName: 'forbidden', params: () => ({}) },
  { domain: 'etf', apiName: 'bad_request', params: () => ({}) },
  { domain: 'equity', apiName: 'offline', params: () => ({}) },
];

describe('asset-allocation Tushare probe', () => {
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
        domain: 'etf',
        apiName: 'available',
        status: 'ok',
        rowCount: 1,
        fields: ['date', 'value'],
        sample: { date: '20260805', value: 1 },
      },
      {
        catalogVersion: 1,
        domain: 'etf',
        apiName: 'empty',
        status: 'empty',
        rowCount: 0,
        fields: [],
      },
      {
        catalogVersion: 1,
        domain: 'etf',
        apiName: 'forbidden',
        status: 'permission_denied',
        rowCount: 0,
        fields: [],
        errorCode: 40203,
        errorMessage: 'permission denied',
      },
      {
        catalogVersion: 1,
        domain: 'etf',
        apiName: 'bad_request',
        status: 'request_error',
        rowCount: 0,
        fields: [],
        errorCode: 50101,
        errorMessage: 'missing ts_code',
      },
      {
        catalogVersion: 1,
        domain: 'equity',
        apiName: 'offline',
        status: 'network_error',
        rowCount: 0,
        fields: [],
        errorMessage: 'connection closed',
      },
    ]);
  });
});
