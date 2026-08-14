import { TushareError, type TushareRow } from './client.js';
import {
  TUSHARE_CAPABILITIES,
  TUSHARE_CAPABILITY_CATALOG_VERSION,
  type TushareCapabilityDomain,
  type TushareCapabilityProbeCoverage,
} from './capability-catalog.js';

export type AssetAllocationProbeStatus =
  | 'ok'
  | 'empty'
  | 'permission_denied'
  | 'request_error'
  | 'network_error';

export interface AssetAllocationProbeDefinition {
  version?: number;
  domain: TushareCapabilityDomain;
  apiName: string;
  history?: {
    field?: string;
    probeCoverage: TushareCapabilityProbeCoverage;
  };
  params: (probeDate: string) => Record<string, unknown>;
}

export interface AssetAllocationProbeResult {
  catalogVersion: number;
  domain: AssetAllocationProbeDefinition['domain'];
  apiName: string;
  status: AssetAllocationProbeStatus;
  rowCount: number;
  fields: string[];
  history?: {
    field: string;
    start: string;
    end: string;
    coverage: TushareCapabilityProbeCoverage;
  };
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
export const ASSET_ALLOCATION_PROBES: readonly AssetAllocationProbeDefinition[] =
  TUSHARE_CAPABILITIES;

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
      const history = observedHistory(rows, definition.history);
      results.push({
        catalogVersion: definition.version ?? TUSHARE_CAPABILITY_CATALOG_VERSION,
        domain: definition.domain,
        apiName: definition.apiName,
        status: sample ? 'ok' : 'empty',
        rowCount: rows.length,
        fields: sample ? Object.keys(sample) : [],
        ...(history ? { history } : {}),
        ...(sample ? { sample } : {}),
      });
    } catch (error) {
      if (error instanceof TushareError) {
        results.push({
          catalogVersion: definition.version ?? TUSHARE_CAPABILITY_CATALOG_VERSION,
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
          catalogVersion: definition.version ?? TUSHARE_CAPABILITY_CATALOG_VERSION,
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

function observedHistory(
  rows: TushareRow[],
  history: AssetAllocationProbeDefinition['history'],
): AssetAllocationProbeResult['history'] | undefined {
  if (!history?.field) {
    return undefined;
  }
  const values = rows
    .map((row) => row[history.field!])
    .filter(
      (value): value is string | number => typeof value === 'string' || typeof value === 'number',
    )
    .map(String)
    .sort();
  if (values.length === 0) {
    return undefined;
  }
  return {
    field: history.field,
    start: values[0]!,
    end: values.at(-1)!,
    coverage: history.probeCoverage,
  };
}

function permissionFailure(error: TushareError): boolean {
  return error.code === 40203 || /权限|积分|permission/i.test(error.apiMsg);
}
