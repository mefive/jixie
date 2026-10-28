import {
  researchPythonAllowedImportRoots,
  type ResearchAssetTypeV1,
  type ResearchDataCatalogResultV1,
  type ResearchDataCatalogScopeV1,
} from '@jixie/shared';
import { searchResearchDataCatalog } from '../catalog/data-catalog.js';
import type { ResearchPythonAnalysis } from '../sandbox/host/analysis-types.js';

type ResearchDataCatalogSearch = (input: {
  query: string;
  assetType?: ResearchAssetTypeV1;
  scope?: ResearchDataCatalogScopeV1;
  limit: number;
}) => Promise<ResearchDataCatalogResultV1>;

/**
 * 在向用户呈现 Diff 前校验每个 Agent 生成的治理时间序列身份。
 *
 * Validate every Agent-authored governed time-series identity before a Diff can reach the user.
 */
export async function validateResearchSeriesProposal(
  analyses: ResearchPythonAnalysis[],
  searchCatalog: ResearchDataCatalogSearch = searchResearchDataCatalog,
): Promise<void> {
  const allowedImports = researchPythonAllowedImportRoots();
  for (const analysis of analyses) {
    for (const imported of analysis.imports ?? []) {
      if (!allowedImports.has(imported)) {
        throw new Error(
          `Cell ${analysis.cellId} imports unsupported module ${imported}. Agent-authored Python may import only modules declared by the runtime.python Research capability contract.`,
        );
      }
    }
    for (const request of analysis.seriesRequests ?? []) {
      if (!request.assetType || !request.identifier || !request.measure) {
        throw new Error(
          `Cell ${analysis.cellId} data.series call on line ${request.line} must use literal asset_type, identifier, and measure values so the Research catalog can validate it.`,
        );
      }
      if (!isResearchAssetType(request.assetType)) {
        throw new Error(
          `Cell ${analysis.cellId} data.series call on line ${request.line} uses unsupported asset type ${request.assetType}.`,
        );
      }
      const catalog = await searchCatalog({
        query: request.identifier,
        assetType: request.assetType,
        limit: 50,
      });
      const instrument = catalog.instruments.find(
        (candidate) =>
          candidate.assetType === request.assetType && candidate.identifier === request.identifier,
      );
      if (!instrument) {
        throw new Error(
          `Cell ${analysis.cellId} data.series call on line ${request.line} references ${request.assetType}:${request.identifier}, which is not in the Research SDK instrument catalog.`,
        );
      }
      if (!instrument.compatibleMeasureIds.includes(request.measure)) {
        throw new Error(
          `Cell ${analysis.cellId} data.series call on line ${request.line} uses measure ${request.measure}, which is not supported for ${request.assetType}:${request.identifier}.`,
        );
      }
    }
    for (const request of analysis.equityRequests ?? []) {
      if (!request.identifier) {
        throw new Error(
          `Cell ${analysis.cellId} data.${request.method} call on line ${request.line} must use a literal identifier value so the Research catalog can validate it.`,
        );
      }
      const assetType = identifierRequestAssetType(request.method);
      const catalog = await searchCatalog({ query: request.identifier, assetType, limit: 50 });
      if (
        !catalog.instruments.some(
          (candidate) =>
            candidate.assetType === assetType && candidate.identifier === request.identifier,
        )
      ) {
        throw new Error(
          `Cell ${analysis.cellId} data.${request.method} call on line ${request.line} references ${assetType} ${request.identifier}, which is not in the Research catalog.`,
        );
      }
    }
  }
}

/**
 * 将来源请求类型映射为允许的资产类型，供序列提案校验。
 *
 * Map a governed source request to its allowed asset type for proposal validation.
 */
function identifierRequestAssetType(
  method: NonNullable<ResearchPythonAnalysis['equityRequests']>[number]['method'],
): ResearchAssetTypeV1 {
  switch (method) {
    case 'index_valuation':
      return 'index';
    default:
      return 'stock';
  }
}

function isResearchAssetType(value: string): value is ResearchAssetTypeV1 {
  return value === 'stock' || value === 'etf' || value === 'index';
}
