import { getDatabase } from '#infra/database/prisma.js';
import { researchCapabilityCatalog } from './capabilities.js';
import {
  researchConceptBindingSdkCall,
  type ResearchConceptBindingV1,
} from './concept-bindings.js';
import type { ResearchCatalogAssetType, ResearchCatalogSourceKind } from './concepts.js';

/**
 * 约束概念绑定的资产、来源及语义维度筛选。
 *
 * Constrain concept bindings by asset, source and semantic dimensions.
 */
export interface ResearchBindingFilters {
  sourceKinds?: ResearchCatalogSourceKind[];
  assetTypes?: ResearchCatalogAssetType[];
  termYears?: number;
}

/**
 * 返回绑定解析身份、执行状态与本地覆盖。
 *
 * Collect resolved binding identity, execution status and local coverage.
 */
export interface ResolvedResearchConceptBinding {
  binding: ResearchConceptBindingV1;
  available: boolean;
  match: Record<string, unknown> | null;
  unavailableReason: 'binding_registered_no_local_data' | null;
}

/**
 * 描述本地数据起止与数量，供目录可用性说明。
 *
 * Describe local data bounds and counts for catalog availability.
 */
interface DataCoverage {
  observationCount: number;
  startDate: string;
  endDate: string;
  dateBasis: 'tradeDate' | 'availableDate';
}

export async function resolveResearchConceptBindings(
  bindings: ResearchConceptBindingV1[],
  filters?: ResearchBindingFilters,
): Promise<ResolvedResearchConceptBinding[]> {
  return Promise.all(
    bindings.filter((binding) => researchBindingAllowed(binding, filters)).map(resolveBinding),
  );
}

/**
 * 根据请求过滤条件判断已审计概念绑定是否可用。
 *
 * Check whether an audited concept binding satisfies the requested filters.
 */
export function researchBindingAllowed(
  binding: ResearchConceptBindingV1,
  filters?: ResearchBindingFilters,
): boolean {
  if (filters?.sourceKinds && !filters.sourceKinds.includes(binding.source.kind)) {
    return false;
  }
  if (
    filters?.assetTypes &&
    binding.source.kind === 'instrument' &&
    !filters.assetTypes.includes(binding.source.assetType)
  ) {
    return false;
  }
  return true;
}

/**
 * 按绑定来源分派身份解析，并附加本地覆盖与可执行状态。
 *
 * Resolve a binding by source kind and attach local coverage and execution status.
 */
async function resolveBinding(
  binding: ResearchConceptBindingV1,
): Promise<ResolvedResearchConceptBinding> {
  switch (binding.source.kind) {
    case 'instrument':
      return resolveInstrumentBinding(binding, binding.source);
  }
}

/**
 * 校验绑定证券的本地身份与行情覆盖，供目录引用使用。
 *
 * Resolve a bound instrument against local identity and market coverage.
 */
async function resolveInstrumentBinding(
  binding: ResearchConceptBindingV1,
  source: Extract<ResearchConceptBindingV1['source'], { kind: 'instrument' }>,
): Promise<ResolvedResearchConceptBinding> {
  const { assetType, id } = source;
  if (assetType === 'stock') {
    const [metadata, aggregate] = await Promise.all([
      getDatabase().stockBasic.findUnique({
        where: { tsCode: id },
        select: { name: true },
      }),
      getDatabase().daily.aggregate({
        where: { tsCode: id },
        _count: { _all: true },
        _min: { tradeDate: true },
        _max: { tradeDate: true },
      }),
    ]);
    return bindingResult(
      binding,
      coverage(
        aggregate._count._all,
        aggregate._min.tradeDate,
        aggregate._max.tradeDate,
        'tradeDate',
      ),
      { kind: 'instrument', assetType, id, name: metadata?.name ?? binding.nameZh, ...metadata },
    );
  }
  if (assetType === 'etf') {
    const [metadata, aggregate] = await Promise.all([
      getDatabase().etfBasic.findUnique({
        where: { tsCode: id },
        select: { name: true, fundType: true, indexName: true, exchange: true },
      }),
      getDatabase().etfDaily.aggregate({
        where: { tsCode: id },
        _count: { _all: true },
        _min: { tradeDate: true },
        _max: { tradeDate: true },
      }),
    ]);
    return bindingResult(
      binding,
      coverage(
        aggregate._count._all,
        aggregate._min.tradeDate,
        aggregate._max.tradeDate,
        'tradeDate',
      ),
      { kind: 'instrument', assetType, id, name: metadata?.name ?? binding.nameZh, ...metadata },
    );
  }
  if (assetType === 'index') {
    const [metadata, aggregate] = await Promise.all([
      getDatabase().indexBenchmark.findUnique({
        where: { tsCode: id },
        select: { name: true, fullName: true, indexType: true },
      }),
      getDatabase().indexDaily.aggregate({
        where: { tsCode: id },
        _count: { _all: true },
        _min: { tradeDate: true },
        _max: { tradeDate: true },
      }),
    ]);
    return bindingResult(
      binding,
      coverage(
        aggregate._count._all,
        aggregate._min.tradeDate,
        aggregate._max.tradeDate,
        'tradeDate',
      ),
      { kind: 'instrument', assetType, id, name: metadata?.name ?? binding.nameZh, ...metadata },
    );
  }

  throw new Error('Unsupported instrument type');
}

/**
 * 将绑定身份、覆盖与状态整理为目录解析结果。
 *
 * Assemble binding identity, coverage and status into a catalog resolution result.
 */
function bindingResult(
  binding: ResearchConceptBindingV1,
  dataCoverage: DataCoverage | null,
  metadata: Record<string, unknown>,
): ResolvedResearchConceptBinding {
  if (!dataCoverage) {
    return {
      binding,
      available: false,
      match: null,
      unavailableReason: 'binding_registered_no_local_data',
    };
  }
  const sdkCall = researchConceptBindingSdkCall(binding);
  return {
    binding,
    available: true,
    unavailableReason: null,
    match: {
      ...metadata,
      binding: {
        id: binding.id,
        version: binding.version,
        proxyKind: binding.proxyKind,
        nameZh: binding.nameZh,
        nameEn: binding.nameEn,
        dimensions: binding.dimensions,
        contract: binding.contract,
        selectionNoteZh: binding.selectionNoteZh,
        selectionNoteEn: binding.selectionNoteEn,
      },
      source: binding.source,
      compatibleMeasure: measureReference(binding.measure),
      sdkAccess: sdkCall
        ? { status: 'ready', call: sdkCall }
        : {
            status: 'not_exposed',
            reason: 'source_available_but_not_exposed_in_research_sdk',
          },
      dataCoverage,
    },
  };
}

function coverage(
  observationCount: number,
  startDate: string | null,
  endDate: string | null,
  dateBasis: DataCoverage['dateBasis'],
): DataCoverage | null {
  return observationCount > 0 && startDate && endDate
    ? { observationCount, startDate, endDate, dateBasis }
    : null;
}

function measureReference(id: string) {
  const measure = researchCapabilityCatalog.measures.find((candidate) => candidate.id === id)!;
  return {
    id: measure.id,
    version: measure.version,
    unit: measure.unit,
    transforms: measure.transforms,
  };
}
