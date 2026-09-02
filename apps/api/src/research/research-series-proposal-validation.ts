import {
  RESEARCH_FX_SERIES_IDS_V1,
  RESEARCH_MACRO_SERIES_KEYS_V1,
  RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1,
  RESEARCH_COMMODITY_PRODUCT_CODES_V1,
  researchPythonAllowedImportRoots,
  type ResearchAssetTypeV1,
  type ResearchDataCatalogResultV1,
} from '@jixie/shared';
import { researchYieldCurveSourceForSdkCall } from './concept-bindings.js';
import { searchResearchDataCatalog } from './data-catalog.js';
import type { ResearchPythonAnalysis } from './workbench-runtime.js';

type ResearchDataCatalogSearch = (input: {
  query: string;
  assetType: ResearchAssetTypeV1;
  limit: number;
}) => Promise<ResearchDataCatalogResultV1>;

/** Validate every Agent-authored governed time-series identity before a Diff can reach the user. */
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
    for (const request of analysis.yieldCurveRequests ?? []) {
      if (!request.curve || !request.tenor) {
        throw new Error(
          `Cell ${analysis.cellId} data.yield_curve call on line ${request.line} must use literal curve and tenor values so the Research catalog can validate it.`,
        );
      }
      if (!researchYieldCurveSourceForSdkCall(request.curve, request.tenor)) {
        throw new Error(
          `Cell ${analysis.cellId} data.yield_curve call on line ${request.line} references unsupported curve/tenor pair ${request.curve}:${request.tenor}.`,
        );
      }
    }
    for (const request of analysis.macroRequests ?? []) {
      if (!request.series) {
        throw new Error(
          `Cell ${analysis.cellId} data.macro call on line ${request.line} must use a literal series value so the Research catalog can validate it.`,
        );
      }
      if (!RESEARCH_MACRO_SERIES_KEYS_V1.includes(request.series as never)) {
        throw new Error(
          `Cell ${analysis.cellId} data.macro call on line ${request.line} references unsupported series ${request.series}.`,
        );
      }
    }
    for (const request of analysis.fxRequests ?? []) {
      if (!request.pair) {
        throw new Error(
          `Cell ${analysis.cellId} data.fx call on line ${request.line} must use a literal pair value so the Research catalog can validate it.`,
        );
      }
      if (!RESEARCH_FX_SERIES_IDS_V1.includes(request.pair as never)) {
        throw new Error(
          `Cell ${analysis.cellId} data.fx call on line ${request.line} references unsupported pair ${request.pair}.`,
        );
      }
    }
    for (const request of analysis.commodityRequests ?? []) {
      if (!request.product) {
        throw new Error(
          `Cell ${analysis.cellId} data.${request.method} call on line ${request.line} must use a literal product value so the Research catalog can validate it.`,
        );
      }
      const products =
        request.method === 'commodity_holdings'
          ? RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1
          : RESEARCH_COMMODITY_PRODUCT_CODES_V1;
      if (!(products as readonly string[]).includes(request.product)) {
        throw new Error(
          `Cell ${analysis.cellId} data.${request.method} call on line ${request.line} references unsupported product ${request.product}.`,
        );
      }
    }
    for (const request of analysis.equityRequests ?? []) {
      if (!request.identifier) {
        throw new Error(
          `Cell ${analysis.cellId} data.${request.method} call on line ${request.line} must use a literal identifier value so the Research catalog can validate it.`,
        );
      }
      const catalog = await searchCatalog({
        query: request.identifier,
        assetType: 'stock',
        limit: 50,
      });
      if (
        !catalog.instruments.some(
          (candidate) =>
            candidate.assetType === 'stock' && candidate.identifier === request.identifier,
        )
      ) {
        throw new Error(
          `Cell ${analysis.cellId} data.${request.method} call on line ${request.line} references stock ${request.identifier}, which is not in the Research catalog.`,
        );
      }
    }
  }
}

function isResearchAssetType(value: string): value is ResearchAssetTypeV1 {
  return value === 'stock' || value === 'etf' || value === 'index' || value === 'future';
}
