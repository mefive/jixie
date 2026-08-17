import { prisma } from '../lib/prisma.js';
import { researchCapabilityCatalog } from './catalog.js';
import type { ResearchConceptBindingV1 } from './concept-bindings.js';
import type { ResearchCatalogAssetType, ResearchCatalogSourceKind } from './concepts.js';

export interface ResearchBindingFilters {
  sourceKinds?: ResearchCatalogSourceKind[];
  assetTypes?: ResearchCatalogAssetType[];
  termYears?: number;
}

export interface ResolvedResearchConceptBinding {
  binding: ResearchConceptBindingV1;
  available: boolean;
  match: Record<string, unknown> | null;
  unavailableReason: 'binding_registered_no_local_data' | null;
}

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
  if (
    filters?.termYears != null &&
    binding.source.kind === 'yield_curve' &&
    binding.source.termYears !== filters.termYears
  ) {
    return false;
  }
  return true;
}

async function resolveBinding(
  binding: ResearchConceptBindingV1,
): Promise<ResolvedResearchConceptBinding> {
  switch (binding.source.kind) {
    case 'instrument':
      return resolveInstrumentBinding(binding, binding.source);
    case 'macro':
      return resolveMacroBinding(binding, binding.source);
    case 'yield_curve':
      return resolveYieldBinding(binding, binding.source);
    case 'fx':
      return resolveFxBinding(binding, binding.source);
  }
}

async function resolveInstrumentBinding(
  binding: ResearchConceptBindingV1,
  source: Extract<ResearchConceptBindingV1['source'], { kind: 'instrument' }>,
): Promise<ResolvedResearchConceptBinding> {
  const { assetType, id } = source;
  if (assetType === 'stock') {
    const [metadata, aggregate] = await Promise.all([
      prisma.stockBasic.findUnique({
        where: { tsCode: id },
        select: { name: true, industry: true },
      }),
      prisma.daily.aggregate({
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
      prisma.etfBasic.findUnique({
        where: { tsCode: id },
        select: { name: true, fundType: true, indexName: true, exchange: true },
      }),
      prisma.etfDaily.aggregate({
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
    const [benchmark, benchmarkCoverage] = await Promise.all([
      prisma.marketBenchmark.findUnique({
        where: { id },
        select: {
          nameZh: true,
          nameEn: true,
          providerCode: true,
          market: true,
          currency: true,
          timeZone: true,
          returnType: true,
          tradableProxyTsCode: true,
          tradableProxyKind: true,
        },
      }),
      prisma.marketBenchmarkDaily.aggregate({
        where: { benchmarkId: id },
        _count: { _all: true },
        _min: { availableDate: true },
        _max: { availableDate: true },
      }),
    ]);
    if (benchmark) {
      return bindingResult(
        binding,
        coverage(
          benchmarkCoverage._count._all,
          benchmarkCoverage._min.availableDate,
          benchmarkCoverage._max.availableDate,
          'availableDate',
        ),
        {
          kind: 'instrument',
          assetType,
          id,
          name: benchmark.nameZh,
          ...benchmark,
          compatibleMeasures: ['market.adjusted_close', 'market.cny_close'],
        },
      );
    }
    const [metadata, aggregate] = await Promise.all([
      prisma.indexBenchmark.findUnique({
        where: { tsCode: id },
        select: { name: true, fullName: true, indexType: true },
      }),
      prisma.indexDaily.aggregate({
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

  const continuous = await prisma.futureMapping.aggregate({
    where: { continuousCode: id },
    _count: { _all: true },
    _min: { tradeDate: true },
    _max: { tradeDate: true },
  });
  if (continuous._count._all > 0) {
    return bindingResult(
      binding,
      coverage(
        continuous._count._all,
        continuous._min.tradeDate,
        continuous._max.tradeDate,
        'tradeDate',
      ),
      { kind: 'instrument', assetType, id, name: binding.nameZh, continuous: true },
    );
  }
  const [metadata, aggregate] = await Promise.all([
    prisma.futureContract.findUnique({
      where: { tsCode: id },
      select: { name: true, productCode: true, exchange: true },
    }),
    prisma.futureDaily.aggregate({
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

async function resolveMacroBinding(
  binding: ResearchConceptBindingV1,
  source: Extract<ResearchConceptBindingV1['source'], { kind: 'macro' }>,
): Promise<ResolvedResearchConceptBinding> {
  const { seriesKey } = source;
  const [metadata, aggregate] = await Promise.all([
    prisma.macroSeries.findUnique({
      where: { seriesKey },
      select: {
        seriesKey: true,
        nameZh: true,
        nameEn: true,
        frequency: true,
        unit: true,
        revisionPolicy: true,
      },
    }),
    prisma.macroObservation.aggregate({
      where: { seriesKey },
      _count: { _all: true },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
  ]);
  return bindingResult(
    binding,
    coverage(
      aggregate._count._all,
      aggregate._min.availableDate,
      aggregate._max.availableDate,
      'availableDate',
    ),
    {
      kind: 'macro',
      ...(metadata ?? { seriesKey, nameZh: binding.nameZh, nameEn: binding.nameEn }),
    },
  );
}

async function resolveYieldBinding(
  binding: ResearchConceptBindingV1,
  source: Extract<ResearchConceptBindingV1['source'], { kind: 'yield_curve' }>,
): Promise<ResolvedResearchConceptBinding> {
  const { curveCode, curveType, termYears } = source;
  const [metadata, aggregate] = await Promise.all([
    prisma.yieldCurvePoint.findFirst({
      where: { curveCode, curveType, termYears },
      select: { curveName: true },
    }),
    prisma.yieldCurvePoint.aggregate({
      where: { curveCode, curveType, termYears },
      _count: { _all: true },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
  ]);
  return bindingResult(
    binding,
    coverage(
      aggregate._count._all,
      aggregate._min.availableDate,
      aggregate._max.availableDate,
      'availableDate',
    ),
    {
      kind: 'yield_curve',
      curveCode,
      curveName: metadata?.curveName ?? binding.nameZh,
      curveType,
      termYears,
    },
  );
}

async function resolveFxBinding(
  binding: ResearchConceptBindingV1,
  source: Extract<ResearchConceptBindingV1['source'], { kind: 'fx' }>,
): Promise<ResolvedResearchConceptBinding> {
  const [metadata, aggregate] = await Promise.all([
    prisma.fxDaily.findFirst({
      where: { tsCode: source.id },
      select: { exchange: true },
    }),
    prisma.fxDaily.aggregate({
      where: { tsCode: source.id },
      _count: { _all: true },
      _min: { availableDate: true },
      _max: { availableDate: true },
    }),
  ]);
  return bindingResult(
    binding,
    coverage(
      aggregate._count._all,
      aggregate._min.availableDate,
      aggregate._max.availableDate,
      'availableDate',
    ),
    { kind: 'fx', id: source.id, exchange: metadata?.exchange ?? null },
  );
}

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
        contract: binding.contract,
        selectionNoteZh: binding.selectionNoteZh,
        selectionNoteEn: binding.selectionNoteEn,
      },
      source: binding.source,
      compatibleMeasure: measureReference(binding.measure),
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
