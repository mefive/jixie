import { z } from 'zod';
import {
  RESEARCH_PYTHON_RUNTIME_CAPABILITIES_V1,
  RESEARCH_PYTHON_RUNTIME_CATALOG_QUERY_V1,
  searchResearchSdkAgentCatalog,
} from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';
import { researchCapabilityCatalog } from '#research/catalog/capabilities.js';
import { resolveResearchConceptBindings } from '#research/catalog/concept-binding-resolver.js';
import {
  researchConceptBindingSdkCall,
  researchConceptBindings,
} from '#research/catalog/concept-bindings.js';
import {
  RESEARCH_CONCEPT_INSTRUMENT_FORMS,
  RESEARCH_CONCEPT_IDS,
  RESEARCH_CONCEPT_MARKETS,
  RESEARCH_CONCEPT_QUOTE_CURRENCIES,
  inferResearchConceptIds,
  researchConceptById,
  type ResearchCatalogAssetType,
  type ResearchCatalogSourceKind,
  type ResearchConceptDimensionsV1,
  type ResearchConceptId,
} from '#research/catalog/concepts.js';
import type { AgentTool } from './types.js';
import { researchSourceDecisions } from '#research/catalog/source-decisions.js';
import { compactCrossMarketDataContractRegistry } from '#research/datasets/cross-market-data-contracts.js';

const filtersSchema = z.strictObject({
  sourceKinds: z
    .array(z.enum(['instrument']))
    .min(1)
    .max(4)
    .optional(),
  assetTypes: z
    .array(z.enum(['stock', 'etf', 'index']))
    .min(1)
    .max(4)
    .optional(),
  termYears: z.number().positive().max(100).optional(),
});
const conceptDimensionsSchema = z.strictObject({
  instrumentForm: z.enum(RESEARCH_CONCEPT_INSTRUMENT_FORMS).optional(),
  quoteCurrency: z.enum(RESEARCH_CONCEPT_QUOTE_CURRENCIES).optional(),
  market: z.enum(RESEARCH_CONCEPT_MARKETS).optional(),
  termYears: z.number().positive().max(100).optional(),
});
const conceptRequestSchema = z.strictObject({
  originalText: z.string().trim().min(1).max(160),
  conceptId: z.enum(RESEARCH_CONCEPT_IDS),
  dimensions: conceptDimensionsSchema.default({}),
});
const argsSchema = z
  .strictObject({
    text: z.string().trim().min(1).max(120).optional(),
    conceptIds: z.array(z.enum(RESEARCH_CONCEPT_IDS)).max(8).default([]),
    conceptRequests: z.array(conceptRequestSchema).max(8).default([]),
    filters: filtersSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!value.text && value.conceptIds.length === 0 && value.conceptRequests.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Provide text, at least one conceptId, one conceptRequest, or a combination.',
      });
    }
    const requestIds = value.conceptRequests.map((request) => request.conceptId);
    if (new Set(requestIds).size !== requestIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['conceptRequests'],
        message: 'Provide at most one structured request per conceptId.',
      });
    }
  });

/**
 * 描述研究目录查询的概念、对象和范围，供语义解析与检索共用。
 *
 * Describe concepts, objects and scope for research catalog interpretation and lookup.
 */
export interface ResearchCatalogQueryInput {
  text?: string;
  conceptIds?: ResearchConceptId[];
  conceptRequests?: Array<{
    originalText: string;
    conceptId: ResearchConceptId;
    dimensions?: ResearchConceptDimensionsV1;
  }>;
  filters?: {
    sourceKinds?: ResearchCatalogSourceKind[];
    assetTypes?: ResearchCatalogAssetType[];
    termYears?: number;
  };
}

/**
 * 保留目录候选的身份、标签和匹配证据，供排序及澄清。
 *
 * Retain a catalog candidate's identity, label and match evidence for ranking and clarification.
 */
interface CatalogCandidate {
  match: Record<string, unknown>;
  searchValues: string[];
  sourceKind: ResearchCatalogSourceKind | 'capability';
  assetType?: ResearchCatalogAssetType;
}

const RESULT_CAP = 40;
const CONCEPT_RESULT_CAP = 12;

/**
 * 累计当前轮目录检索证据，约束后续研究引用与澄清选项。
 *
 * Retain catalog evidence discovered in the current turn for later references and clarification.
 */
export interface ResearchCatalogTurnEvidence {
  sdkReadyBindingIds: Set<string>;
  sdkMethodNames: Set<string>;
  pythonRuntimeInspected: boolean;
}

export function createResearchCatalogTurnEvidence(): ResearchCatalogTurnEvidence {
  return {
    sdkReadyBindingIds: new Set(),
    sdkMethodNames: new Set(),
    pythonRuntimeInspected: false,
  };
}

const QUERY_STOP_WORDS = new Set([
  'and',
  'data',
  'etf',
  'future',
  'futures',
  'index',
  'rate',
  'real',
  'series',
  'yield',
  'curve',
  'year',
  'yr',
  '数据',
  '指数',
  '期货',
  '收益率',
  '曲线',
]);

/**
 * 将结构化概念与命名对象解析为精确稳定的本地研究引用。
 *
 * Resolve structured concepts and named objects to exact stable local research references.
 */
export function createSearchResearchCatalogTool(evidence?: ResearchCatalogTurnEvidence): AgentTool {
  return {
    name: 'searchResearchCatalog',
    description: `Resolve one structured ConceptQuery against the local research catalog. Before proposing any Python Cell, query the exact text ${RESEARCH_PYTHON_RUNTIME_CATALOG_QUERY_V1} and follow the returned fixed-package capability contract; never guess an installed package or reimplement a supplied statistical routine. For each semantic variable interpreted from the user, prefer conceptRequests with the verbatim originalText, one canonical conceptId from the supplied manifest, and explicit dimensions such as instrumentForm, quoteCurrency, market, or termYears. Use conceptIds supplied by a loaded playbook only when the user has not specified dimensions; use text for a named object, exact code, or exact Research SDK method such as data.panel or charts.line. SDK method results provide the generated Python signature, parameter defaults, fixed return columns, examples, and PIT or frequency notes. Concept ids resolve only through audited binding allow-list entries, while lexical database search is limited to explicitly named objects. Per-concept results distinguish exact matches, choice-required results, governed alternatives, unavailable capabilities, and sdkAccess; only sdkAccess.status=ready is executable from a Python Cell. Never guess or silently substitute a different source or SDK signature.`,
    parameters: z.toJSONSchema(argsSchema),

    /**
     * 检索研究目录并检查概念维度，返回可执行引用或明确的澄清需求。
     *
     * Search the catalog and check semantic dimensions to return executable references or clarification needs.
     */
    async run(args) {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
      }

      const sdkMethods = researchSdkMethodsForCatalogQuery(parsed.data.text);
      const pythonRuntimeRequested = isResearchPythonRuntimeCatalogQuery(parsed.data.text);
      const interpretation = interpretResearchCatalogQuery(parsed.data);
      const { terms, tenorYears } = interpretation;
      const bindingFilters = {
        ...parsed.data.filters,
        ...(tenorYears == null ? {} : { termYears: tenorYears }),
      };
      const registeredBindings = interpretation.conceptIds.flatMap((conceptId) =>
        researchConceptBindings(conceptId),
      );
      const [stocks, etfs, indexes, indexCodes, resolvedBindings] = await Promise.all([
        terms.length === 0
          ? Promise.resolve([])
          : getDatabase().stockBasic.findMany({
              where: { OR: terms.flatMap((term) => textSearch(term, ['tsCode', 'name'])) },
              select: { tsCode: true, name: true },
              take: 30,
            }),
        terms.length === 0
          ? Promise.resolve([])
          : getDatabase().etfBasic.findMany({
              where: {
                OR: terms.flatMap((term) =>
                  textSearch(term, ['tsCode', 'name', 'fundType', 'indexName']),
                ),
              },
              select: { tsCode: true, name: true, fundType: true, indexName: true },
              take: 30,
            }),
        terms.length === 0
          ? Promise.resolve([])
          : getDatabase().indexBenchmark.findMany({
              where: {
                OR: terms.flatMap((term) => textSearch(term, ['tsCode', 'name', 'fullName'])),
              },
              select: { tsCode: true, name: true, indexType: true },
              take: 30,
            }),
        terms.length === 0
          ? Promise.resolve([])
          : getDatabase().indexDaily.findMany({
              where: { OR: terms.map((term) => ({ tsCode: { contains: term } })) },
              select: { tsCode: true },
              distinct: ['tsCode'],
              take: 30,
            }),
        resolveResearchConceptBindings(registeredBindings, bindingFilters),
      ]);
      const etfCoverage =
        etfs.length === 0
          ? []
          : await getDatabase().etfDaily.groupBy({
              by: ['tsCode'],
              where: { tsCode: { in: etfs.map((item) => item.tsCode) } },
              _count: { _all: true },
              _min: { tradeDate: true },
              _max: { tradeDate: true },
            });
      const etfCoverageByCode = new Map(etfCoverage.map((item) => [item.tsCode, item]));

      const knownIndexCodes = new Set(indexes.map((item) => item.tsCode));
      const candidates: CatalogCandidate[] = [
        ...rankByTerms(etfs, terms, (item) => compactValues(item)).map((item) =>
          candidate(
            etfInstrumentMatch(item, etfCoverageByCode.get(item.tsCode)),
            compactValues(item),
            'instrument',
            'etf',
          ),
        ),
        ...rankByTerms(indexes, terms, (item) => compactValues(item)).map((item) =>
          candidate(
            instrumentMatch('index', item.tsCode, item.name, item),
            compactValues(item),
            'instrument',
            'index',
          ),
        ),
        ...rankByTerms(indexCodes, terms, (item) => [item.tsCode])
          .filter((item) => !knownIndexCodes.has(item.tsCode))
          .map((item) =>
            candidate(
              instrumentMatch('index', item.tsCode, item.tsCode, item),
              [item.tsCode],
              'instrument',
              'index',
            ),
          ),
        ...rankByTerms(stocks, terms, (item) => compactValues(item)).map((item) =>
          candidate(
            instrumentMatch('stock', item.tsCode, item.name, item),
            compactValues(item),
            'instrument',
            'stock',
          ),
        ),
        ...registeredCapabilityCandidates(terms),
      ].filter((item) => candidateAllowed(item, parsed.data.filters));

      /**
       * 比较概念及别名与查询内容，供目录候选匹配使用。
       *
       * Match concepts and aliases against a catalog query.
       */
      const conceptMatches = interpretation.conceptIds.map((conceptId) => {
        const concept = researchConceptById.get(conceptId)!;
        const structuredRequest = parsed.data.conceptRequests.find(
          (request) => request.conceptId === conceptId,
        );
        const requestedDimensions: ResearchConceptDimensionsV1 = {
          ...(structuredRequest?.dimensions ?? {}),
          ...(structuredRequest?.dimensions.termYears == null && bindingFilters.termYears != null
            ? { termYears: bindingFilters.termYears }
            : {}),
        };
        const allRegistered = researchConceptBindings(conceptId);
        const sourceDecisions = researchSourceDecisions(conceptId);
        const resolved = resolvedBindings.filter((item) => item.binding.conceptId === conceptId);
        const sourceAvailable = resolved.filter((item) => item.available && item.match);
        const executable = sourceAvailable.filter((item) =>
          researchConceptBindingSdkCall(item.binding),
        );
        const exact = executable.filter(
          (item) =>
            researchConceptDimensionMismatches(requestedDimensions, item.binding.dimensions)
              .length === 0,
        );
        const exactMatches = exact.slice(0, CONCEPT_RESULT_CAP).map((item) => item.match!);
        const alternatives = executable
          .filter((item) => !exact.includes(item))
          .slice(0, CONCEPT_RESULT_CAP)
          .map((item) => ({
            ...item.match!,
            mismatches: researchConceptDimensionMismatches(
              requestedDimensions,
              item.binding.dimensions,
            ),
            requiresUserConfirmation: true,
          }));
        const matches = executable.slice(0, CONCEPT_RESULT_CAP).map((item) => item.match!);
        const unavailableBindings = resolved
          .filter((item) => !item.available || !researchConceptBindingSdkCall(item.binding))
          .map((item) => ({
            id: item.binding.id,
            version: item.binding.version,
            source: item.binding.source,
            reason: item.unavailableReason ?? 'source_available_but_not_exposed_in_research_sdk',
          }));
        const availability =
          matches.length > 0
            ? 'registered_matches'
            : allRegistered.length === 0
              ? sourceDecisions.some((decision) => decision.status === 'blocked_external_license')
                ? 'blocked_by_source_rights'
                : 'no_registered_binding'
              : resolved.length === 0
                ? 'no_binding_matches_filters'
                : sourceAvailable.length > 0
                  ? 'registered_binding_not_exposed_in_sdk'
                  : 'registered_binding_no_data';
        const resolutionStatus = researchConceptResolutionStatus({
          selectionDimensions: concept.selectionDimensions,
          requestedDimensions,
          exactMatchCount: exactMatches.length,
          alternativeCount: alternatives.length,
          availability,
        });
        return {
          id: concept.id,
          version: concept.version,
          nameZh: concept.nameZh,
          nameEn: concept.nameEn,
          descriptionZh: concept.descriptionZh,
          descriptionEn: concept.descriptionEn,
          requestedBy: interpretation.explicitConceptIds.includes(concept.id)
            ? 'explicit_concept_id'
            : 'lexical_inference',
          ...(structuredRequest ? { originalText: structuredRequest.originalText } : {}),
          selectionDimensions: concept.selectionDimensions,
          requestedDimensions,
          resolutionStatus,
          requiresUserConfirmation:
            resolutionStatus === 'choice_required' || resolutionStatus === 'no_exact_match',
          availability,
          doNotSubstitute: concept.doNotSubstitute ?? [],
          registeredBindingCount: allRegistered.length,
          sourceDecisions,
          unavailableBindings,
          exactMatches,
          alternatives,
          matches,
        };
      });
      const matches = uniqueCatalogMatches([
        ...resolvedBindings.flatMap((item) => (item.available && item.match ? [item.match] : [])),
        ...candidates.map((item) => item.match),
      ]).slice(0, RESULT_CAP);
      const capabilities = compactCapabilityCatalog();

      for (const method of sdkMethods) {
        evidence?.sdkMethodNames.add(method.qualifiedName);
      }
      if (pythonRuntimeRequested && evidence) {
        evidence.pythonRuntimeInspected = true;
      }
      for (const item of resolvedBindings) {
        if (item.available && item.match && researchConceptBindingSdkCall(item.binding)) {
          evidence?.sdkReadyBindingIds.add(item.binding.id);
        }
      }

      return {
        observation: JSON.stringify({
          request: parsed.data,
          interpretation,
          conceptRegistryVersion: 1,
          bindingRegistryVersion: 1,
          crossMarketData: compactCrossMarketDataContractRegistry(),
          ...(pythonRuntimeRequested
            ? { pythonRuntime: RESEARCH_PYTHON_RUNTIME_CAPABILITIES_V1 }
            : {}),
          sdkMethods,
          conceptMatches,
          matches,
          capabilities,
        }),
        rows: matches.length + sdkMethods.length + (pythonRuntimeRequested ? 1 : 0),
      };
    },
  };
}

export const searchResearchCatalogTool = createSearchResearchCatalogTool();

export function researchSdkMethodsForCatalogQuery(text: string | undefined) {
  return searchResearchSdkAgentCatalog(text);
}

export function isResearchPythonRuntimeCatalogQuery(text: string | undefined): boolean {
  return text?.trim().toLowerCase() === RESEARCH_PYTHON_RUNTIME_CATALOG_QUERY_V1;
}

/**
 * 将研究查询解释为结构化概念与约束，供后续精确目录检索。
 *
 * Interpret a research query into structured concepts and constraints for exact catalog lookup.
 */
export function interpretResearchCatalogQuery(input: ResearchCatalogQueryInput): {
  text: string | null;
  explicitConceptIds: ResearchConceptId[];
  inferredConceptIds: ResearchConceptId[];
  conceptIds: ResearchConceptId[];
  terms: string[];
  tenorYears: number | null;
} {
  const text = input.text?.trim() || null;
  const pythonRuntimeRequested = isResearchPythonRuntimeCatalogQuery(text ?? undefined);
  const explicitConceptIds = [
    ...new Set([
      ...(input.conceptIds ?? []),
      ...(input.conceptRequests ?? []).map((request) => request.conceptId),
    ]),
  ];
  const inferredConceptIds = text ? inferResearchConceptIds(text) : [];
  const conceptIds = [...new Set([...explicitConceptIds, ...inferredConceptIds])];
  const lexicalTerms =
    !pythonRuntimeRequested && conceptIds.length === 0 && text ? tokenizeCatalogText(text) : [];
  const stableIdentifiers = !pythonRuntimeRequested && text ? stableIdentifiersFromText(text) : [];
  const terms = [...new Set([...lexicalTerms, ...stableIdentifiers])].slice(0, 40);

  return {
    text,
    explicitConceptIds,
    inferredConceptIds,
    conceptIds,
    terms:
      terms.length > 0
        ? terms
        : !pythonRuntimeRequested && conceptIds.length === 0 && text
          ? [text]
          : [],
    tenorYears: input.filters?.termYears ?? (text ? researchCatalogTenorYears(text) : null),
  };
}

export function researchCatalogTenorYears(query: string): number | null {
  const match = query.match(/(\d+(?:\.\d+)?)\s*(?:y|yr|year|年)/i);
  if (match) {
    return Number(match[1]);
  }

  const chineseTenors: Array<[RegExp, number]> = [
    [/三十年/, 30],
    [/二十年/, 20],
    [/十年/, 10],
    [/七年/, 7],
    [/五年/, 5],
    [/三年/, 3],
    [/(?:两年|二年)/, 2],
    [/一年/, 1],
  ];
  return chineseTenors.find(([pattern]) => pattern.test(query))?.[1] ?? null;
}

/**
 * 记录用户请求与可执行目录绑定之间的语义维度差异。
 *
 * Describe a semantic dimension mismatch between a request and an executable catalog binding.
 */
export interface ResearchConceptDimensionMismatch {
  dimension: keyof ResearchConceptDimensionsV1;
  requested: string | number;
  available: string | number | null;
}

/**
 * 对比用户可确认的语义请求与已审计的可执行绑定，返回维度差异。
 *
 * Compare a user-confirmable semantic request with one audited executable binding.
 */
export function researchConceptDimensionMismatches(
  requested: ResearchConceptDimensionsV1,
  available: ResearchConceptDimensionsV1,
): ResearchConceptDimensionMismatch[] {
  const dimensions: Array<keyof ResearchConceptDimensionsV1> = [
    'instrumentForm',
    'quoteCurrency',
    'market',
    'termYears',
  ];
  return dimensions.flatMap((dimension) => {
    const requestedValue = requested[dimension];
    if (requestedValue === undefined) {
      return [];
    }
    const availableValue = available[dimension] ?? null;
    return availableValue === requestedValue
      ? []
      : [{ dimension, requested: requestedValue, available: availableValue }];
  });
}

/**
 * 根据匹配与维度差异确定研究概念的解析状态。
 *
 * Classify concept resolution from candidate matches and semantic mismatches.
 */
function researchConceptResolutionStatus(args: {
  selectionDimensions: string[];
  requestedDimensions: ResearchConceptDimensionsV1;
  exactMatchCount: number;
  alternativeCount: number;
  availability: string;
}): 'exact_match' | 'choice_required' | 'no_exact_match' | 'unavailable' {
  if (args.exactMatchCount === 1) {
    return 'exact_match';
  }
  if (args.exactMatchCount > 1) {
    return 'choice_required';
  }
  if (args.alternativeCount > 0) {
    return 'no_exact_match';
  }
  return 'unavailable';
}

function tokenizeCatalogText(text: string): string[] {
  const tokens = text.match(/[\p{Script=Han}]+|[A-Za-z][A-Za-z0-9._/-]*|\d+(?:\.\d+)?/gu) ?? [];
  return tokens
    .map((term) => term.trim())
    .filter(
      (term) =>
        term.length >= 2 &&
        (!/^\d+(?:\.\d+)?$/.test(term) || term.length >= 5) &&
        !QUERY_STOP_WORDS.has(term.toLocaleLowerCase()),
    );
}

function stableIdentifiersFromText(text: string): string[] {
  return text.match(/(?:\b\d{5,6}(?:\.[A-Z]{2,6})?\b|\b[A-Z]{1,5}\.[A-Z]{2,6}\b)/g) ?? [];
}

function registeredCapabilityCandidates(terms: string[]): CatalogCandidate[] {
  return [
    ...researchCapabilityCatalog.measures
      .filter((item) => matchesTerms([item.id, item.nameZh, item.nameEn], terms))
      .map((item) => candidate({ kind: 'measure', ...item }, compactValues(item), 'capability')),
    ...researchCapabilityCatalog.universeMeasures
      .filter((item) => matchesTerms([item.id, item.nameZh, item.nameEn], terms))
      .map((item) =>
        candidate({ kind: 'universe_measure', ...item }, compactValues(item), 'capability'),
      ),
  ];
}

function compactCapabilityCatalog() {
  return {
    measures: researchCapabilityCatalog.measures.map((measure) => ({
      id: measure.id,
      nameZh: measure.nameZh,
      nameEn: measure.nameEn,
      sourceKinds: measure.sourceKinds,
      assetTypes: measure.assetTypes,
      transforms: measure.transforms,
    })),
    universeMeasures: researchCapabilityCatalog.universeMeasures.map((measure) => ({
      id: measure.id,
      version: measure.version,
      nameZh: measure.nameZh,
      nameEn: measure.nameEn,
      unit: measure.unit,
    })),
  };
}

function candidate(
  match: Record<string, unknown>,
  searchValues: string[],
  sourceKind: CatalogCandidate['sourceKind'],
  assetType?: ResearchCatalogAssetType,
): CatalogCandidate {
  return { match, searchValues, sourceKind, assetType };
}

/**
 * 按请求的来源和资产维度筛除不兼容目录候选。
 *
 * Filter catalog candidates against requested source and asset dimensions.
 */
function candidateAllowed(
  item: CatalogCandidate,
  filters?: ResearchCatalogQueryInput['filters'],
): boolean {
  if (
    filters?.sourceKinds &&
    item.sourceKind !== 'capability' &&
    !filters.sourceKinds.includes(item.sourceKind)
  ) {
    return false;
  }
  if (filters?.assetTypes && item.assetType && !filters.assetTypes.includes(item.assetType)) {
    return false;
  }
  return true;
}

function compactValues(value: object): string[] {
  return Object.values(value).filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
}

function textSearch(term: string, fields: string[]): Record<string, { contains: string }>[] {
  return fields.map((field) => ({ [field]: { contains: term } }));
}

function matchesTerms(values: string[], terms: string[]): boolean {
  const normalized = values.map((value) => value.toLocaleLowerCase());
  return terms.some((term) => normalized.some((value) => value.includes(term.toLocaleLowerCase())));
}

function rankByTerms<T>(items: T[], terms: string[], values: (item: T) => string[]): T[] {
  return items
    .map((item, index) => ({ item, index, score: searchScore(values(item), terms) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
}

function searchScore(values: string[], terms: string[]): number {
  const normalizedValues = values.map((value) => value.toLocaleLowerCase());
  return terms.reduce((score, term) => {
    const normalizedTerm = term.toLocaleLowerCase();

    /**
     * 累积精确、前缀和包含匹配中的最高得分，供目录排序。
     *
     * Keep the strongest exact, prefix or substring score for catalog ranking.
     */
    const best = normalizedValues.reduce((valueScore, value) => {
      if (value === normalizedTerm) {
        return Math.max(valueScore, 8);
      }
      if (value.startsWith(normalizedTerm)) {
        return Math.max(valueScore, 4);
      }
      if (value.includes(normalizedTerm)) {
        return Math.max(valueScore, 2);
      }
      return valueScore;
    }, 0);
    return score + best;
  }, 0);
}

/**
 * 将证券查询匹配到本地稳定证券身份，供研究目录返回引用。
 *
 * Match an instrument query to a stable local identity for catalog references.
 */
function instrumentMatch(
  assetType: ResearchCatalogAssetType,
  id: string,
  name: string,
  metadata: object,
) {
  return {
    kind: 'instrument',
    assetType,
    id,
    name,
    ...metadata,
    source: { kind: 'instrument', assetType, id },
    compatibleMeasure: measureReference('market.adjusted_close'),
    sdkAccess: {
      status: 'ready',
      call: {
        method: 'data.series',
        assetType,
        identifier: id,
        measure: 'market.adjusted_close',
      },
    },
  };
}

/**
 * 匹配 ETF 身份与元数据，供研究目录选择可用交易代理。
 *
 * Match ETF identities and metadata for selecting available research proxies.
 */
export function etfInstrumentMatch(
  item: { tsCode: string; name: string; fundType: string | null; indexName: string | null },
  coverage:
    | {
        _count: { _all: number };
        _min: { tradeDate: string | null };
        _max: { tradeDate: string | null };
      }
    | undefined,
) {
  const base = instrumentMatch('etf', item.tsCode, item.name, item);
  const hasDailyData = coverage != null && coverage._count._all > 0;
  return {
    ...base,
    localDataCoverage: hasDailyData
      ? {
          status: 'ready',
          observations: coverage._count._all,
          startDate: coverage._min.tradeDate,
          endDate: coverage._max.tradeDate,
        }
      : {
          status: 'missing',
          reason: 'source_available_but_local_data_missing',
        },
    sdkAccess: hasDailyData
      ? base.sdkAccess
      : {
          status: 'not_ready',
          reason: 'source_available_but_local_data_missing',
        },
  };
}

function measureReference(id: string) {
  const measure = researchCapabilityCatalog.measures.find((item) => item.id === id)!;
  return {
    id: measure.id,
    version: measure.version,
    unit: measure.unit,
    transforms: measure.transforms,
  };
}

function uniqueCatalogMatches(matches: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = JSON.stringify(match.source ?? [match.kind, match.id]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
