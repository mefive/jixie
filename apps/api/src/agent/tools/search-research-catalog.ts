import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { researchCapabilityCatalog } from '../../research/catalog.js';
import type { AgentTool } from './types.js';

const argsSchema = z.strictObject({
  query: z.string().trim().min(1).max(80),
});

const RESULT_CAP = 40;

/** Search stable local research objects and semantic capabilities; never infer a code from model memory. */
export const searchResearchCatalogTool: AgentTool = {
  name: 'searchResearchCatalog',
  description:
    'Search the local research catalog for stocks, ETFs, indexes, futures, FX, macro series, yield curves, registered time-series measures, point-in-time Universe measures, and protocols. Call this before constructing a ResearchPlan or UniverseSpec. Every response includes the complete compact capabilities catalog. Copy exact ids, versions, and units from capabilities; never guess, abbreviate, translate, or substitute them.',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const query = parsed.data.query;
    const normalized = query.toLocaleLowerCase();
    const [stocks, etfs, indexes, indexCodes, futures, macro, curves, fx] = await Promise.all([
      prisma.stockBasic.findMany({
        where: { OR: [{ tsCode: { contains: query } }, { name: { contains: query } }] },
        select: { tsCode: true, name: true, industry: true },
        take: 10,
      }),
      prisma.etfBasic.findMany({
        where: { OR: [{ tsCode: { contains: query } }, { name: { contains: query } }] },
        select: { tsCode: true, name: true, fundType: true, indexName: true },
        take: 10,
      }),
      prisma.indexBenchmark.findMany({
        where: {
          OR: [
            { tsCode: { contains: query } },
            { name: { contains: query } },
            { fullName: { contains: query } },
          ],
        },
        select: { tsCode: true, name: true, indexType: true },
        take: 10,
      }),
      prisma.indexDaily.findMany({
        where: { tsCode: { contains: query } },
        select: { tsCode: true },
        distinct: ['tsCode'],
        take: 10,
      }),
      prisma.futureContract.findMany({
        where: {
          OR: [
            { tsCode: { contains: query } },
            { name: { contains: query } },
            { productCode: { contains: query } },
          ],
        },
        select: { tsCode: true, name: true, productCode: true, exchange: true },
        take: 10,
      }),
      prisma.macroSeries.findMany({
        where: {
          OR: [
            { seriesKey: { contains: query } },
            { nameZh: { contains: query } },
            { nameEn: { contains: query } },
          ],
        },
        select: {
          seriesKey: true,
          nameZh: true,
          nameEn: true,
          frequency: true,
          unit: true,
          revisionPolicy: true,
        },
        take: 10,
      }),
      prisma.yieldCurvePoint.findMany({
        where: { OR: [{ curveCode: { contains: query } }, { curveName: { contains: query } }] },
        select: { curveCode: true, curveName: true, curveType: true, termYears: true },
        distinct: ['curveCode', 'curveType', 'termYears'],
        take: 10,
      }),
      prisma.fxDaily.findMany({
        where: { tsCode: { contains: query } },
        select: { tsCode: true, exchange: true },
        distinct: ['tsCode'],
        take: 10,
      }),
    ]);
    const registered = [
      ...researchCapabilityCatalog.measures
        .filter((item) =>
          [item.id, item.nameZh, item.nameEn].some((value) =>
            value.toLocaleLowerCase().includes(normalized),
          ),
        )
        .map((item) => ({ kind: 'measure', ...item })),
      ...researchCapabilityCatalog.universeMeasures
        .filter((item) =>
          [item.id, item.nameZh, item.nameEn].some((value) =>
            value.toLocaleLowerCase().includes(normalized),
          ),
        )
        .map((item) => ({ kind: 'universe_measure', ...item })),
      ...researchCapabilityCatalog.protocols
        .filter((item) =>
          [item.id, item.nameZh, item.nameEn].some((value) =>
            value.toLocaleLowerCase().includes(normalized),
          ),
        )
        .map((item) => ({
          kind: 'protocol',
          id: item.id,
          version: item.version,
          nameZh: item.nameZh,
          nameEn: item.nameEn,
          minimumObservations: item.minimumObservations,
        })),
    ];
    const knownIndexCodes = new Set(indexes.map((item) => item.tsCode));
    const matches = [
      ...stocks.map((item) => ({ kind: 'instrument', assetType: 'stock', ...item })),
      ...etfs.map((item) => ({ kind: 'instrument', assetType: 'etf', ...item })),
      ...indexes.map((item) => ({ kind: 'instrument', assetType: 'index', ...item })),
      ...indexCodes
        .filter((item) => !knownIndexCodes.has(item.tsCode))
        .map((item) => ({ kind: 'instrument', assetType: 'index', name: item.tsCode, ...item })),
      ...futures.map((item) => ({ kind: 'instrument', assetType: 'future', ...item })),
      ...macro.map((item) => ({ kind: 'macro', ...item })),
      ...curves.map((item) => ({ kind: 'yield_curve', ...item })),
      ...fx.map((item) => ({ kind: 'fx', id: item.tsCode, exchange: item.exchange })),
      ...registered,
    ].slice(0, RESULT_CAP);
    const capabilities = {
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
    return {
      observation: JSON.stringify({ query, matches, capabilities }),
      rows: matches.length,
    };
  },
};
