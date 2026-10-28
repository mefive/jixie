import type { ResearchSeriesSourceV1 } from '@jixie/shared';
import type { ResearchConceptDimensionsV1, ResearchConceptId } from './concepts.js';
import {
  researchBindingDataContract,
  type ResearchBindingDataContractProjectionV1,
} from '../datasets/cross-market-data-contracts.js';

export type ResearchBindingDataContractV1 = ResearchBindingDataContractProjectionV1;

/**
 * 表示一个经审计的概念到本地可执行序列的白名单映射。
 *
 * An audited allow-list entry from one semantic concept to one executable local series.
 */
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
  dimensions: ResearchConceptDimensionsV1;
  contract: ResearchBindingDataContractV1;
  selectionNoteZh: string;
  selectionNoteEn: string;
}

const chinaEtfPriceContract = researchBindingDataContract('cn.etf.adjusted_close.daily');

const goldInstrumentBindings: ResearchConceptBindingV1[] = [
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

const bindings: ResearchConceptBindingV1[] = [...goldInstrumentBindings];

export const researchConceptBindingRegistry = {
  version: 1 as const,
  bindings,
};

export function researchConceptBindings(conceptId: ResearchConceptId): ResearchConceptBindingV1[] {
  return researchConceptBindingRegistry.bindings
    .filter((binding) => binding.conceptId === conceptId)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

/**
 * 保留绑定对应的精确公开 SDK 方法及参数。
 *
 * Describe the exact public SDK method and arguments for a binding.
 */
export type ResearchConceptBindingSdkCallV1 = {
  method: 'data.series';
  assetType: 'stock' | 'etf' | 'index';
  identifier: string;
  measure: string;
};

/**
 * 返回绑定对应的精确公开 SDK 调用，尚未公开时返回 null。
 *
 * Return the exact public Research SDK call for a binding, or null when it is not exposed yet.
 */
export function researchConceptBindingSdkCall(
  binding: ResearchConceptBindingV1,
): ResearchConceptBindingSdkCallV1 | null {
  if (binding.source.kind === 'instrument') {
    return {
      method: 'data.series',
      assetType: binding.source.assetType,
      identifier: binding.source.id,
      measure: binding.measure,
    };
  }
  return null;
}

/**
 * 构造带明确证券身份的概念绑定，供受控研究目录。
 *
 * Construct an instrument-identified concept binding for the governed catalog.
 */
function instrumentBinding(input: {
  id: string;
  conceptId: ResearchConceptId;
  assetType: 'etf';
  sourceId: string;
  nameZh: string;
  nameEn: string;
  proxyKind: ResearchConceptBindingV1['proxyKind'];
  priority: number;
  noteZh: string;
  noteEn: string;
}): ResearchConceptBindingV1 {
  const contract = chinaEtfPriceContract;
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
    dimensions: {
      instrumentForm: 'etf',
      quoteCurrency: 'CNY',
      market: 'CN',
    },
    contract,
    selectionNoteZh: input.noteZh,
    selectionNoteEn: input.noteEn,
  };
}
