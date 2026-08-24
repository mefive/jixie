import type { ResearchAssetTypeV1, ResearchDataCatalogResultV1 } from '@jixie/shared';
import { searchResearchDataCatalog } from './data-catalog.js';
import type { ResearchPythonAnalysis } from './workbench-runtime.js';

type ResearchDataCatalogSearch = (input: {
  query: string;
  assetType: ResearchAssetTypeV1;
  limit: number;
}) => Promise<ResearchDataCatalogResultV1>;

/** Validate every Agent-authored data.series identity before a Diff can reach the user. */
export async function validateResearchSeriesProposal(
  analyses: ResearchPythonAnalysis[],
  searchCatalog: ResearchDataCatalogSearch = searchResearchDataCatalog,
): Promise<void> {
  for (const analysis of analyses) {
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
  }
}

function isResearchAssetType(value: string): value is ResearchAssetTypeV1 {
  return value === 'stock' || value === 'etf' || value === 'index' || value === 'future';
}
