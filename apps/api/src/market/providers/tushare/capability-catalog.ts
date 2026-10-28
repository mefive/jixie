export type TushareCapabilityDomain = 'equity' | 'etf';
export type TushareCapabilityFrequency = 'reference' | 'event' | 'daily' | 'monthly' | 'quarterly';
export type TushareCapabilityProbeCoverage =
  | 'single_date'
  | 'bounded_window'
  | 'full_response'
  | 'reference_snapshot';

/**
 * 定义来源能力的域、频率、权限与探测覆盖。
 *
 * Describe provider capability domain, frequency, permissions and probe coverage.
 */
export interface TushareCapabilityDefinitionV1 {
  version: 1;
  domain: TushareCapabilityDomain;
  apiName: string;
  nameZh: string;
  nameEn: string;
  keywords: string[];
  requiredFields: string[];
  permission:
    | { kind: 'points'; minimumPoints: number; documentedAsOf: string }
    | { kind: 'separate_permission'; documentedAsOf: string }
    | { kind: 'token_dependent' };
  history: {
    frequency: TushareCapabilityFrequency;
    field?: string;
    probeCoverage: TushareCapabilityProbeCoverage;
  };
  params: (probeDate: string) => Record<string, unknown>;
}

export const TUSHARE_CAPABILITY_CATALOG_VERSION = 1;

export const TUSHARE_CAPABILITIES: readonly TushareCapabilityDefinitionV1[] = [
  capability({
    domain: 'etf',
    apiName: 'etf_share_size',
    nameZh: 'ETF 份额与规模',
    nameEn: 'ETF shares and size',
    keywords: ['ETF 规模', 'ETF 份额', 'fund size', 'fund shares'],
    requiredFields: ['trade_date', 'ts_code', 'etf_name', 'total_share', 'total_size', 'exchange'],
    permission: { kind: 'points', minimumPoints: 8000, documentedAsOf: '2026-08-04' },
    history: { frequency: 'daily', field: 'trade_date', probeCoverage: 'single_date' },
    params: (date) => ({ trade_date: date }),
  }),
];

function capability(
  definition: Omit<TushareCapabilityDefinitionV1, 'version' | 'permission'> & {
    permission?: TushareCapabilityDefinitionV1['permission'];
  },
): TushareCapabilityDefinitionV1 {
  return {
    version: 1,
    permission: { kind: 'token_dependent' },
    ...definition,
  };
}
