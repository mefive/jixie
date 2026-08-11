import { addDays } from '../lib/date.js';
import { TushareError, type TushareRow } from './client.js';

export type AssetAllocationProbeStatus =
  | 'ok'
  | 'empty'
  | 'permission_denied'
  | 'request_error'
  | 'network_error';

export interface AssetAllocationProbeDefinition {
  domain: 'etf' | 'rates' | 'commodity' | 'macro';
  apiName: string;
  params: (probeDate: string) => Record<string, unknown>;
}

export interface AssetAllocationProbeResult {
  domain: AssetAllocationProbeDefinition['domain'];
  apiName: string;
  status: AssetAllocationProbeStatus;
  rowCount: number;
  fields: string[];
  sample?: TushareRow;
  errorCode?: number;
  errorMessage?: string;
}

export interface AssetAllocationProbeClient {
  call(apiName: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

/**
 * Read-only capability probes for the data families in docs/design/asset-allocation-data.md.
 * Parameters deliberately request one date where possible so a permission check cannot become a
 * large accidental download. Empty results are distinct from permission and transport failures.
 */
export const ASSET_ALLOCATION_PROBES: readonly AssetAllocationProbeDefinition[] = [
  { domain: 'etf', apiName: 'etf_share_size', params: (date) => ({ trade_date: date }) },
  { domain: 'rates', apiName: 'yc_cb', params: (date) => ({ trade_date: date }) },
  { domain: 'rates', apiName: 'shibor', params: (date) => ({ date }) },
  { domain: 'rates', apiName: 'repo_daily', params: (date) => ({ trade_date: date }) },
  {
    domain: 'rates',
    apiName: 'shibor_lpr',
    params: (date) => ({ start_date: `${date.slice(0, 6)}01`, end_date: date }),
  },
  {
    domain: 'commodity',
    apiName: 'fut_index_daily',
    params: (date) => ({ ts_code: 'NHCI.NH', trade_date: date }),
  },
  { domain: 'commodity', apiName: 'sge_basic', params: () => ({}) },
  { domain: 'commodity', apiName: 'sge_daily', params: (date) => ({ trade_date: date }) },
  {
    domain: 'commodity',
    apiName: 'fut_basic',
    params: () => ({ exchange: 'SHFE', fut_type: '1' }),
  },
  {
    domain: 'commodity',
    apiName: 'fut_daily',
    params: (date) => ({ exchange: 'SHFE', trade_date: date }),
  },
  {
    domain: 'commodity',
    apiName: 'fut_mapping',
    params: (date) => ({ exchange: 'SHFE', trade_date: date }),
  },
  { domain: 'commodity', apiName: 'fut_wsr', params: (date) => ({ trade_date: date }) },
  {
    domain: 'commodity',
    apiName: 'fut_holding',
    params: (date) => ({ exchange: 'SHFE', trade_date: date }),
  },
  { domain: 'macro', apiName: 'cn_pmi', params: () => ({}) },
  { domain: 'macro', apiName: 'cn_gdp', params: () => ({}) },
  { domain: 'macro', apiName: 'cn_cpi', params: () => ({}) },
  { domain: 'macro', apiName: 'cn_ppi', params: () => ({}) },
  { domain: 'macro', apiName: 'sf_month', params: () => ({}) },
  { domain: 'macro', apiName: 'cn_m', params: () => ({}) },
  { domain: 'macro', apiName: 'us_tycr', params: (date) => ({ date }) },
  { domain: 'macro', apiName: 'us_trycr', params: (date) => ({ date }) },
  {
    domain: 'macro',
    apiName: 'fx_daily',
    params: (date) => ({
      ts_code: 'USDCNH.FXCM',
      start_date: addDays(date, -10),
      end_date: date,
    }),
  },
  { domain: 'macro', apiName: 'cn_schedule', params: (date) => ({ date }) },
];

export async function probeAssetAllocationData(
  client: AssetAllocationProbeClient,
  probeDate: string,
  definitions: readonly AssetAllocationProbeDefinition[] = ASSET_ALLOCATION_PROBES,
): Promise<AssetAllocationProbeResult[]> {
  const results: AssetAllocationProbeResult[] = [];
  for (const definition of definitions) {
    try {
      const rows = await client.call(definition.apiName, definition.params(probeDate));
      const sample = rows[0];
      results.push({
        domain: definition.domain,
        apiName: definition.apiName,
        status: sample ? 'ok' : 'empty',
        rowCount: rows.length,
        fields: sample ? Object.keys(sample) : [],
        ...(sample ? { sample } : {}),
      });
    } catch (error) {
      if (error instanceof TushareError) {
        results.push({
          domain: definition.domain,
          apiName: definition.apiName,
          status: permissionFailure(error) ? 'permission_denied' : 'request_error',
          rowCount: 0,
          fields: [],
          errorCode: error.code,
          errorMessage: error.apiMsg,
        });
      } else {
        results.push({
          domain: definition.domain,
          apiName: definition.apiName,
          status: 'network_error',
          rowCount: 0,
          fields: [],
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return results;
}

function permissionFailure(error: TushareError): boolean {
  return error.code === 40203 || /权限|积分|permission/i.test(error.apiMsg);
}
