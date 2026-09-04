import { describe, expect, it, vi } from 'vitest';

import { TushareError } from '../../src/tushare/client.js';
import { probeFundamentalSources } from './source-probe.js';

const options = { tsCode: '000333.SZ', startDate: '20100101', period: '20221231' };

describe('fundamental source probe', () => {
  it('summarizes material revisions and verifies bounded VIP pagination', async () => {
    const base = {
      ts_code: '000333.SZ',
      ann_date: '20230429',
      f_ann_date: '20230429',
      end_date: '20221231',
      report_type: '1',
      comp_type: '1',
    };
    const call = vi.fn(async (_apiName: string, params?: Record<string, unknown>) => {
      if (params?.offset === 100) {
        return [{ ...base, ts_code: '000002.SZ', update_flag: '1', revenue: 2 }];
      }
      return [
        { ...base, update_flag: '0', revenue: 1 },
        { ...base, update_flag: '1', revenue: 2 },
      ];
    });

    const [result] = await probeFundamentalSources({ call }, options, [
      {
        apiName: 'income_vip',
        statementKind: 'income',
        params: ({ period }) => ({ period }),
        paginate: true,
      },
    ]);

    expect(call).toHaveBeenNthCalledWith(1, 'income_vip', {
      period: '20221231',
      limit: 100,
      offset: 0,
    });
    expect(call).toHaveBeenNthCalledWith(2, 'income_vip', {
      period: '20221231',
      limit: 100,
      offset: 100,
    });
    expect(result).toMatchObject({
      status: 'ok',
      rowCount: 3,
      historyStart: '20221231',
      historyEnd: '20221231',
      duplicateAnnouncementGroups: 1,
      ambiguousSameDateVersionGroups: 1,
      datedRevisionGroups: 0,
      pagination: {
        firstPageRows: 2,
        secondPageRows: 1,
        distinctPageBoundary: true,
      },
    });
  });

  it('keeps permission, request, empty, and network outcomes distinct', async () => {
    const call = vi.fn(async (apiName: string) => {
      if (apiName === 'forbidden') {
        throw new TushareError(apiName, 40203, 'permission denied');
      }
      if (apiName === 'invalid') {
        throw new TushareError(apiName, 50101, 'invalid parameter');
      }
      if (apiName === 'offline') {
        throw new Error('connection closed');
      }
      return [];
    });
    const definitions = ['forbidden', 'invalid', 'empty', 'offline'].map((apiName) => ({
      apiName,
      params: () => ({}),
    }));

    const results = await probeFundamentalSources({ call }, options, definitions);

    expect(results.map((result) => result.status)).toEqual([
      'permission_denied',
      'request_error',
      'empty',
      'network_error',
    ]);
  });
});
