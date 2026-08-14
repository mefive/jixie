import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { researchCapabilityCatalog } from '../../research/catalog.js';
import {
  RESEARCH_CONCEPT_IDS,
  inferResearchConceptIds,
  researchConceptById,
  type ResearchCatalogAssetType,
  type ResearchCatalogSourceKind,
  type ResearchConceptId,
} from '../../research/concepts.js';
import type { AgentTool } from './types.js';

const filtersSchema = z.strictObject({
  sourceKinds: z
    .array(z.enum(['instrument', 'macro', 'yield_curve', 'fx']))
    .min(1)
    .max(4)
    .optional(),
  assetTypes: z
    .array(z.enum(['stock', 'etf', 'index', 'future']))
    .min(1)
    .max(4)
    .optional(),
  termYears: z.number().positive().max(100).optional(),
});
const argsSchema = z
  .strictObject({
    text: z.string().trim().min(1).max(120).optional(),
    conceptIds: z.array(z.enum(RESEARCH_CONCEPT_IDS)).max(8).default([]),
    filters: filtersSchema.optional(),
  })
  .refine((value) => Boolean(value.text) || value.conceptIds.length > 0, {
    message: 'Provide text, at least one conceptId, or both.',
  });

export interface ResearchCatalogQueryInput {
  text?: string;
  conceptIds?: ResearchConceptId[];
  filters?: {
    sourceKinds?: ResearchCatalogSourceKind[];
    assetTypes?: ResearchCatalogAssetType[];
    termYears?: number;
  };
}

interface CatalogCandidate {
  match: Record<string, unknown>;
  searchValues: string[];
  sourceKind: ResearchCatalogSourceKind | 'capability';
  assetType?: ResearchCatalogAssetType;
  continuousFuture?: boolean;
}

const RESULT_CAP = 40;
const CONCEPT_RESULT_CAP = 12;
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

const CONTINUOUS_FUTURE_NAMES: Record<string, { zh: string; en: string }> = {
  'AU.SHF': { zh: '沪金主力连续', en: 'SHFE gold continuous future' },
  'CU.SHF': { zh: '沪铜主力连续', en: 'SHFE copper continuous future' },
  'SC.INE': { zh: '原油主力连续', en: 'INE crude-oil continuous future' },
  'M.DCE': { zh: '豆粕主力连续', en: 'DCE soybean-meal continuous future' },
  'IF.CFX': { zh: '沪深 300 股指期货主力连续', en: 'CSI 300 futures continuous contract' },
  'IH.CFX': { zh: '上证 50 股指期货主力连续', en: 'SSE 50 futures continuous contract' },
  'IC.CFX': { zh: '中证 500 股指期货主力连续', en: 'CSI 500 futures continuous contract' },
  'IM.CFX': { zh: '中证 1000 股指期货主力连续', en: 'CSI 1000 futures continuous contract' },
};

/** Resolve structured concepts and named objects to exact stable local research references. */
export const searchResearchCatalogTool: AgentTool = {
  name: 'searchResearchCatalog',
  description:
    'Resolve one structured ConceptQuery against the local research catalog. Use conceptIds supplied by a loaded research skill for semantic concepts; use text for a named object or exact code; optional filters constrain source kind, asset type, or yield-curve tenor. Lexical aliases and database fields recall candidates, but only returned source and compatibleMeasure objects are authoritative. Results are grouped per concept so an exact-series gap cannot be confused with a missing protocol. Never guess or substitute a different source.',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const interpretation = interpretResearchCatalogQuery(parsed.data);
    const { terms, tenorYears } = interpretation;
    const [stocks, etfs, indexes, indexCodes, continuousFutures, futures, macro, curves, fx] =
      await Promise.all([
        prisma.stockBasic.findMany({
          where: { OR: terms.flatMap((term) => textSearch(term, ['tsCode', 'name'])) },
          select: { tsCode: true, name: true, industry: true },
          take: 30,
        }),
        prisma.etfBasic.findMany({
          where: {
            OR: terms.flatMap((term) =>
              textSearch(term, ['tsCode', 'name', 'fundType', 'indexName']),
            ),
          },
          select: { tsCode: true, name: true, fundType: true, indexName: true },
          take: 30,
        }),
        prisma.indexBenchmark.findMany({
          where: {
            OR: terms.flatMap((term) => textSearch(term, ['tsCode', 'name', 'fullName'])),
          },
          select: { tsCode: true, name: true, indexType: true },
          take: 30,
        }),
        prisma.indexDaily.findMany({
          where: { OR: terms.map((term) => ({ tsCode: { contains: term } })) },
          select: { tsCode: true },
          distinct: ['tsCode'],
          take: 30,
        }),
        prisma.futureMapping.findMany({
          where: { OR: terms.map((term) => ({ continuousCode: { contains: term } })) },
          select: { continuousCode: true },
          distinct: ['continuousCode'],
          take: 30,
        }),
        prisma.futureContract.findMany({
          where: {
            OR: terms.flatMap((term) =>
              textSearch(term, ['tsCode', 'name', 'productCode', 'exchange']),
            ),
          },
          select: { tsCode: true, name: true, productCode: true, exchange: true },
          take: 30,
        }),
        prisma.macroSeries.findMany({
          where: {
            OR: terms.flatMap((term) => textSearch(term, ['seriesKey', 'nameZh', 'nameEn'])),
          },
          select: {
            seriesKey: true,
            nameZh: true,
            nameEn: true,
            frequency: true,
            unit: true,
            revisionPolicy: true,
          },
          take: 30,
        }),
        prisma.yieldCurvePoint.findMany({
          where: {
            AND: [
              { OR: terms.flatMap((term) => textSearch(term, ['curveCode', 'curveName'])) },
              ...(tenorYears === null ? [] : [{ termYears: tenorYears }]),
            ],
          },
          select: { curveCode: true, curveName: true, curveType: true, termYears: true },
          distinct: ['curveCode', 'curveType', 'termYears'],
          take: 30,
        }),
        prisma.fxDaily.findMany({
          where: { OR: terms.map((term) => ({ tsCode: { contains: term } })) },
          select: { tsCode: true, exchange: true },
          distinct: ['tsCode'],
          take: 30,
        }),
      ]);

    const knownIndexCodes = new Set(indexes.map((item) => item.tsCode));
    const candidates: CatalogCandidate[] = [
      ...rankByTerms(continuousFutures, terms, (item) => [item.continuousCode]).map((item) => {
        const names = CONTINUOUS_FUTURE_NAMES[item.continuousCode] ?? {
          zh: `${item.continuousCode} 主力连续`,
          en: `${item.continuousCode} continuous future`,
        };
        return candidate(
          instrumentMatch('future', item.continuousCode, names.zh, {
            nameEn: names.en,
            continuous: true,
          }),
          [item.continuousCode, names.zh, names.en],
          'instrument',
          'future',
          true,
        );
      }),
      ...rankByTerms(etfs, terms, (item) => compactValues(item)).map((item) =>
        candidate(
          instrumentMatch('etf', item.tsCode, item.name, item),
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
      ...rankByTerms(futures, terms, (item) => compactValues(item)).map((item) =>
        candidate(
          instrumentMatch('future', item.tsCode, item.name, item),
          compactValues(item),
          'instrument',
          'future',
        ),
      ),
      ...rankByTerms(macro, terms, (item) => compactValues(item)).map((item) =>
        candidate(
          {
            kind: 'macro',
            ...item,
            source: { kind: 'macro', seriesKey: item.seriesKey },
            compatibleMeasure: measureReference('macro.observation'),
          },
          compactValues(item),
          'macro',
        ),
      ),
      ...rankByTerms(curves, terms, (item) => compactValues(item)).map((item) =>
        candidate(
          {
            kind: 'yield_curve',
            ...item,
            source: {
              kind: 'yield_curve',
              curveCode: item.curveCode,
              curveType: item.curveType,
              termYears: item.termYears,
            },
            compatibleMeasure: measureReference('rates.yield_pct'),
          },
          compactValues(item),
          'yield_curve',
        ),
      ),
      ...rankByTerms(fx, terms, (item) => compactValues(item)).map((item) =>
        candidate(
          {
            kind: 'fx',
            id: item.tsCode,
            exchange: item.exchange,
            source: { kind: 'fx', id: item.tsCode },
            compatibleMeasure: measureReference('fx.mid_close'),
          },
          compactValues(item),
          'fx',
        ),
      ),
      ...registeredCapabilityCandidates(terms),
    ].filter((item) => candidateAllowed(item, parsed.data.filters));
    const concreteCandidates = candidates.filter((item) => item.sourceKind !== 'capability');
    const conceptMatches = interpretation.conceptIds.map((conceptId) => {
      const concept = researchConceptById.get(conceptId)!;
      const matches = concreteCandidates
        .filter((item) => conceptCandidateAllowed(item, concept))
        .filter((item) => searchScore(item.searchValues, concept.searchTerms) > 0)
        .sort(
          (left, right) =>
            searchScore(right.searchValues, concept.searchTerms) -
            searchScore(left.searchValues, concept.searchTerms),
        )
        .slice(0, CONCEPT_RESULT_CAP)
        .map((item) => item.match);
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
        availability: matches.length > 0 ? 'registered_matches' : 'no_registered_match',
        doNotSubstitute: concept.doNotSubstitute ?? [],
        matches,
      };
    });
    const matches = candidates.slice(0, RESULT_CAP).map((item) => item.match);
    const capabilities = compactCapabilityCatalog();

    return {
      observation: JSON.stringify({
        request: parsed.data,
        interpretation,
        conceptRegistryVersion: 1,
        conceptMatches,
        matches,
        capabilities,
      }),
      rows: matches.length,
    };
  },
};

export function interpretResearchCatalogQuery(input: ResearchCatalogQueryInput): {
  text: string | null;
  explicitConceptIds: ResearchConceptId[];
  inferredConceptIds: ResearchConceptId[];
  conceptIds: ResearchConceptId[];
  terms: string[];
  tenorYears: number | null;
} {
  const text = input.text?.trim() || null;
  const explicitConceptIds = [...new Set(input.conceptIds ?? [])];
  const inferredConceptIds = text ? inferResearchConceptIds(text) : [];
  const conceptIds = [...new Set([...explicitConceptIds, ...inferredConceptIds])];
  const conceptTerms = conceptIds.flatMap(
    (conceptId) => researchConceptById.get(conceptId)?.searchTerms ?? [],
  );
  const lexicalTerms = conceptIds.length === 0 && text ? tokenizeCatalogText(text) : [];
  const stableIdentifiers = text ? stableIdentifiersFromText(text) : [];
  const terms = [...new Set([...conceptTerms, ...lexicalTerms, ...stableIdentifiers])].slice(0, 40);

  return {
    text,
    explicitConceptIds,
    inferredConceptIds,
    conceptIds,
    terms: terms.length > 0 ? terms : text ? [text] : [],
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
    ...researchCapabilityCatalog.protocols
      .filter((item) => matchesTerms([item.id, item.nameZh, item.nameEn], terms))
      .map((item) =>
        candidate(
          {
            kind: 'protocol',
            id: item.id,
            version: item.version,
            nameZh: item.nameZh,
            nameEn: item.nameEn,
            minimumObservations: item.minimumObservations,
          },
          [item.id, item.nameZh, item.nameEn],
          'capability',
        ),
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
    protocols: researchCapabilityCatalog.protocols.map((protocol) => ({
      id: protocol.id,
      version: protocol.version,
      nameZh: protocol.nameZh,
      nameEn: protocol.nameEn,
      minimumObservations: protocol.minimumObservations,
    })),
  };
}

function candidate(
  match: Record<string, unknown>,
  searchValues: string[],
  sourceKind: CatalogCandidate['sourceKind'],
  assetType?: ResearchCatalogAssetType,
  continuousFuture = false,
): CatalogCandidate {
  return { match, searchValues, sourceKind, assetType, continuousFuture };
}

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

function conceptCandidateAllowed(
  item: CatalogCandidate,
  concept: NonNullable<ReturnType<typeof researchConceptById.get>>,
): boolean {
  if (!concept.preferredSourceKinds.includes(item.sourceKind as ResearchCatalogSourceKind)) {
    return false;
  }
  if (
    concept.preferredAssetTypes &&
    item.assetType &&
    !concept.preferredAssetTypes.includes(item.assetType)
  ) {
    return false;
  }
  if (concept.excludeDeliveryFutures && item.assetType === 'future' && !item.continuousFuture) {
    return false;
  }
  if (concept.excludedSearchTerms?.some((term) => searchScore(item.searchValues, [term]) > 0)) {
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
