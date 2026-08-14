import type { ResearchFrequencyV1, ResearchSeriesSourceV1 } from '@jixie/shared';
import type { ResearchConceptId } from './concepts.js';

export interface ResearchBindingDataContractV1 {
  frequency: ResearchFrequencyV1;
  unit: string;
  currency: string | null;
  sourceTimeZone: string;
  availabilityPolicy: string;
  revisionPolicy: string;
}

/** An audited allow-list entry from one semantic concept to one executable local series. */
export interface ResearchConceptBindingV1 {
  id: string;
  version: 1;
  conceptId: ResearchConceptId;
  nameZh: string;
  nameEn: string;
  source: ResearchSeriesSourceV1;
  measure: string;
  measureVersion: 1;
  proxyKind: 'canonical' | 'approved_proxy';
  priority: number;
  contract: ResearchBindingDataContractV1;
  selectionNoteZh: string;
  selectionNoteEn: string;
}

const chinaMarketPriceContract: ResearchBindingDataContractV1 = {
  frequency: 'daily',
  unit: 'quote_currency',
  currency: 'CNY',
  sourceTimeZone: 'Asia/Shanghai',
  availabilityPolicy: 'available after the registered China-market close',
  revisionPolicy: 'not_revised',
};

const usYieldContract: ResearchBindingDataContractV1 = {
  frequency: 'daily',
  unit: 'percent',
  currency: null,
  sourceTimeZone: 'America/New_York',
  availabilityPolicy: 'first SSE session strictly later than the source-market date',
  revisionPolicy: 'not_revised',
};

const chinaMacroContract: ResearchBindingDataContractV1 = {
  frequency: 'monthly',
  unit: 'percent',
  currency: null,
  sourceTimeZone: 'Asia/Shanghai',
  availabilityPolicy: 'official release date when known, otherwise a documented conservative lag',
  revisionPolicy: 'captured vintages with latest_value_backfill disclosure for historical imports',
};

const goldInstrumentBindings: ResearchConceptBindingV1[] = [
  instrumentBinding({
    id: 'commodity.gold.price.future.au_shf',
    conceptId: 'commodity.gold.price',
    assetType: 'future',
    sourceId: 'AU.SHF',
    nameZh: '沪金主力连续',
    nameEn: 'SHFE gold continuous future',
    proxyKind: 'canonical',
    priority: 10,
    noteZh: '人民币计价的连续期货代理，不等同于美元现货黄金。',
    noteEn: 'A CNY continuous-future proxy; it is not USD spot gold.',
  }),
  ...[
    ['518880.SH', '黄金 ETF 518880.SH'],
    ['159812.SZ', '黄金 ETF 159812.SZ'],
    ['159934.SZ', '黄金 ETF 159934.SZ'],
    ['159937.SZ', '黄金 ETF 159937.SZ'],
    ['518660.SH', '黄金 ETF 518660.SH'],
    ['518800.SH', '黄金 ETF 518800.SH'],
    ['518850.SH', '黄金 ETF 518850.SH'],
  ].map(([sourceId, nameZh], index) =>
    instrumentBinding({
      id: `commodity.gold.price.etf.${sourceId!.toLocaleLowerCase().replace('.', '_')}`,
      conceptId: 'commodity.gold.price',
      assetType: 'etf',
      sourceId: sourceId!,
      nameZh: nameZh!,
      nameEn: `Gold ETF ${sourceId}`,
      proxyKind: 'approved_proxy',
      priority: 20 + index,
      noteZh: '人民币交易的黄金 ETF 代理，费用、跟踪误差和交易时段可能影响结果。',
      noteEn:
        'A CNY-traded gold ETF proxy whose fees, tracking error, and trading hours may affect results.',
    }),
  ),
];

const silverInstrumentBindings: ResearchConceptBindingV1[] = [
  instrumentBinding({
    id: 'commodity.silver.price.future.ag_shf',
    conceptId: 'commodity.silver.price',
    assetType: 'future',
    sourceId: 'AG.SHF',
    nameZh: '沪银主力连续',
    nameEn: 'SHFE silver continuous future',
    proxyKind: 'canonical',
    priority: 10,
    noteZh: '人民币计价的连续期货代理，不等同于美元现货白银。',
    noteEn: 'A CNY continuous-future proxy; it is not USD spot silver.',
  }),
];

const nominalTreasuryBindings = [1 / 12, 2 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30].map(
  (termYears, index) =>
    yieldBinding({
      id: `rates.us_treasury.nominal.par.${tenorId(termYears)}`,
      conceptId: 'rates.us_treasury.nominal',
      curveCode: 'us_treasury_nominal',
      termYears,
      nameZh: `美国国债名义收益率 ${tenorLabel(termYears)}`,
      nameEn: `US Treasury nominal yield ${tenorLabel(termYears)}`,
      priority: index + 1,
    }),
);

const realTreasuryBindings = [5, 7, 10, 20, 30].map((termYears, index) =>
  yieldBinding({
    id: `rates.us_treasury.real.par.${tenorId(termYears)}`,
    conceptId: 'rates.us_treasury.real',
    curveCode: 'us_treasury_real',
    termYears,
    nameZh: `美国国债实际收益率 ${tenorLabel(termYears)}`,
    nameEn: `US Treasury real yield ${tenorLabel(termYears)}`,
    priority: index + 1,
  }),
);

const macroBindings: ResearchConceptBindingV1[] = [
  {
    id: 'macro.inflation.cn.cpi_yoy',
    version: 1,
    conceptId: 'macro.inflation.cn',
    nameZh: '中国 CPI 同比',
    nameEn: 'China CPI year over year',
    source: { kind: 'macro', seriesKey: 'cn_cpi_yoy' },
    measure: 'macro.observation',
    measureVersion: 1,
    proxyKind: 'canonical',
    priority: 10,
    contract: chinaMacroContract,
    selectionNoteZh: '居民消费价格同比序列，不代表美国通胀。',
    selectionNoteEn:
      'The consumer-price year-over-year series; it does not represent US inflation.',
  },
];

const bindings: ResearchConceptBindingV1[] = [
  ...goldInstrumentBindings,
  ...silverInstrumentBindings,
  ...nominalTreasuryBindings,
  ...realTreasuryBindings,
  ...macroBindings,
];

export const researchConceptBindingRegistry = {
  version: 1 as const,
  bindings,
};

export function researchConceptBindings(conceptId: ResearchConceptId): ResearchConceptBindingV1[] {
  return researchConceptBindingRegistry.bindings
    .filter((binding) => binding.conceptId === conceptId)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function instrumentBinding(input: {
  id: string;
  conceptId: ResearchConceptId;
  assetType: 'etf' | 'future';
  sourceId: string;
  nameZh: string;
  nameEn: string;
  proxyKind: ResearchConceptBindingV1['proxyKind'];
  priority: number;
  noteZh: string;
  noteEn: string;
}): ResearchConceptBindingV1 {
  return {
    id: input.id,
    version: 1,
    conceptId: input.conceptId,
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    source: { kind: 'instrument', assetType: input.assetType, id: input.sourceId },
    measure: 'market.adjusted_close',
    measureVersion: 1,
    proxyKind: input.proxyKind,
    priority: input.priority,
    contract: chinaMarketPriceContract,
    selectionNoteZh: input.noteZh,
    selectionNoteEn: input.noteEn,
  };
}

function yieldBinding(input: {
  id: string;
  conceptId: 'rates.us_treasury.nominal' | 'rates.us_treasury.real';
  curveCode: string;
  termYears: number;
  nameZh: string;
  nameEn: string;
  priority: number;
}): ResearchConceptBindingV1 {
  return {
    id: input.id,
    version: 1,
    conceptId: input.conceptId,
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    source: {
      kind: 'yield_curve',
      curveCode: input.curveCode,
      curveType: 'par',
      termYears: input.termYears,
    },
    measure: 'rates.yield_pct',
    measureVersion: 1,
    proxyKind: 'canonical',
    priority: input.priority,
    contract: usYieldContract,
    selectionNoteZh: '必须明确期限；名义收益率与实际收益率不能互换。',
    selectionNoteEn: 'Tenor must be explicit; nominal and real yields are not interchangeable.',
  };
}

function tenorId(termYears: number): string {
  return termYears < 1 ? `${Math.round(termYears * 12)}m` : `${termYears}y`;
}

function tenorLabel(termYears: number): string {
  return termYears < 1 ? `${Math.round(termYears * 12)}M` : `${termYears}Y`;
}
