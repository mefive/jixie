import type { ResearchSeriesSourceV1 } from '@jixie/shared';
import type { ResearchConceptId } from './concepts.js';
import {
  researchBindingDataContract,
  type ResearchBindingDataContractProjectionV1,
} from './cross-market-data-contracts.js';

export type ResearchBindingDataContractV1 = ResearchBindingDataContractProjectionV1;

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

const chinaEtfPriceContract = researchBindingDataContract('cn.etf.adjusted_close.daily');
const chinaCommodityFutureContract = researchBindingDataContract(
  'cn.commodity_future.continuous.daily',
);
const usYieldContract = researchBindingDataContract('us.sovereign_yield.daily');
const chinaMacroContract = researchBindingDataContract('cn.macro.monthly.pit');
const usBlsMacroContract = researchBindingDataContract('us.macro.cpi.monthly.pit');
const cnBenchmarkContract = researchBindingDataContract('cn.equity_benchmark.price.daily');
const hkBenchmarkContract = researchBindingDataContract('hk.equity_benchmark.price.daily');
const usBenchmarkContract = researchBindingDataContract('us.equity_benchmark.price.daily');

const marketBenchmarkBindings: ResearchConceptBindingV1[] = [
  benchmarkBinding({
    id: 'equity.market.cn.csi300.price',
    conceptId: 'equity.market.cn.benchmark',
    sourceId: 'equity.cn.csi300.price',
    nameZh: '沪深 300 价格指数',
    nameEn: 'CSI 300 Price Index',
    contract: cnBenchmarkContract,
    noteZh: '中国本币价格指数，不含股息再投资；可交易代理为 510300.SH。',
    noteEn:
      'A local-currency China price index without dividend reinvestment; its tradable proxy is 510300.SH.',
  }),
  benchmarkBinding({
    id: 'equity.market.hk.hsi.price',
    conceptId: 'equity.market.hk.benchmark',
    sourceId: 'equity.hk.hsi.price',
    nameZh: '恒生价格指数',
    nameEn: 'Hang Seng Price Index',
    contract: hkBenchmarkContract,
    noteZh:
      '港币价格指数，不含股息再投资；中国收盘研究使用下一上交所交易日，可交易代理为 159920.SZ。',
    noteEn:
      'An HKD price index without dividend reinvestment, available on the next SSE session for China-close studies; its tradable proxy is 159920.SZ.',
  }),
  benchmarkBinding({
    id: 'equity.market.us.spx.price',
    conceptId: 'equity.market.us.benchmark',
    sourceId: 'equity.us.spx.price',
    nameZh: '标普 500 价格指数',
    nameEn: 'S&P 500 Price Index',
    contract: usBenchmarkContract,
    noteZh:
      '美元价格指数，不含股息再投资；中国收盘研究使用下一上交所交易日，可交易代理为 513500.SH。',
    noteEn:
      'A USD price index without dividend reinvestment, available on the next SSE session for China-close studies; its tradable proxy is 513500.SH.',
  }),
];

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
    id: 'macro.inflation.us.cpi_u_all_items_nsa',
    version: 1,
    conceptId: 'macro.inflation.us.cpi.headline',
    nameZh: '美国 CPI-U 全部项目（未经季调）',
    nameEn: 'US CPI-U All Items, Not Seasonally Adjusted',
    source: { kind: 'macro', seriesKey: 'us_cpi_u_all_items_nsa' },
    measure: 'macro.observation',
    measureVersion: 1,
    proxyKind: 'canonical',
    priority: 10,
    contract: usBlsMacroContract,
    selectionNoteZh: '原始 CPI 指数；同比由研究协议计算，不代表核心 CPI 或季调月环比。',
    selectionNoteEn:
      'Raw CPI index; the research protocol computes year-over-year inflation. It is not core CPI or a seasonally adjusted monthly rate.',
  },
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
  ...marketBenchmarkBindings,
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
  const contract =
    input.assetType === 'future' ? chinaCommodityFutureContract : chinaEtfPriceContract;
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
    contract,
    selectionNoteZh: input.noteZh,
    selectionNoteEn: input.noteEn,
  };
}

function benchmarkBinding(input: {
  id: string;
  conceptId:
    | 'equity.market.cn.benchmark'
    | 'equity.market.hk.benchmark'
    | 'equity.market.us.benchmark';
  sourceId: string;
  nameZh: string;
  nameEn: string;
  contract: ResearchBindingDataContractV1;
  noteZh: string;
  noteEn: string;
}): ResearchConceptBindingV1 {
  return {
    id: input.id,
    version: 1,
    conceptId: input.conceptId,
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    source: { kind: 'instrument', assetType: 'index', id: input.sourceId },
    measure: 'market.adjusted_close',
    measureVersion: 1,
    proxyKind: 'canonical',
    priority: 10,
    contract: input.contract,
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
