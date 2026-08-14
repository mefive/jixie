export const RESEARCH_CONCEPT_IDS = [
  'commodity.gold.price',
  'commodity.silver.price',
  'rates.us_treasury.nominal',
  'rates.us_treasury.real',
  'fx.usd_strength.dxy',
  'macro.inflation.us',
  'macro.inflation.cn',
  'risk.market_stress.vix',
  'flows.central_bank.gold_reserves',
] as const;

export type ResearchConceptId = (typeof RESEARCH_CONCEPT_IDS)[number];
export type ResearchCatalogSourceKind = 'instrument' | 'macro' | 'yield_curve' | 'fx';
export type ResearchCatalogAssetType = 'stock' | 'etf' | 'index' | 'future';

export interface ResearchConceptDefinitionV1 {
  id: ResearchConceptId;
  version: 1;
  family: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  aliases: string[];
  doNotSubstitute?: ResearchConceptId[];
}

const concepts: Record<ResearchConceptId, ResearchConceptDefinitionV1> = {
  'commodity.gold.price': {
    id: 'commodity.gold.price',
    version: 1,
    family: 'commodity.gold.price',
    nameZh: '黄金价格',
    nameEn: 'Gold price',
    descriptionZh: '黄金价格代理，包括现货、连续期货或黄金 ETF；币种和产品类型必须显式区分。',
    descriptionEn:
      'Gold-price proxies such as spot, continuous futures, or gold ETFs; currency and product type must remain explicit.',
    aliases: ['黄金', '沪金', 'gold', 'gold price', 'gold future', 'xau', 'comex gold'],
  },
  'commodity.silver.price': {
    id: 'commodity.silver.price',
    version: 1,
    family: 'commodity.silver.price',
    nameZh: '白银价格',
    nameEn: 'Silver price',
    descriptionZh: '白银价格代理，包括现货、连续期货或白银 ETF。',
    descriptionEn: 'Silver-price proxies such as spot, continuous futures, or silver ETFs.',
    aliases: ['白银', '沪银', 'silver', 'silver price', 'xag'],
  },
  'rates.us_treasury.nominal': {
    id: 'rates.us_treasury.nominal',
    version: 1,
    family: 'rates.us_treasury.yield',
    nameZh: '美国国债名义收益率',
    nameEn: 'US Treasury nominal yield',
    descriptionZh: '按期限区分的美国国债名义收益率曲线。',
    descriptionEn: 'US Treasury nominal-yield curve distinguished by tenor.',
    aliases: [
      '美国国债收益率',
      '美债收益率',
      '美国名义利率',
      'us treasury yield',
      'treasury yield',
      'nominal treasury yield',
    ],
  },
  'rates.us_treasury.real': {
    id: 'rates.us_treasury.real',
    version: 1,
    family: 'rates.us_treasury.yield',
    nameZh: '美国国债实际收益率',
    nameEn: 'US Treasury real yield',
    descriptionZh: '按期限区分的美国通胀保值债券实际收益率曲线。',
    descriptionEn: 'US inflation-protected Treasury real-yield curve distinguished by tenor.',
    aliases: [
      '美国实际利率',
      '美国实际收益率',
      '美债实际利率',
      '美债实际收益率',
      '实际美国国债收益率',
      'real treasury yield',
      'treasury real yield',
      'treasury yield real',
      'us real yield',
      'tips yield',
    ],
  },
  'fx.usd_strength.dxy': {
    id: 'fx.usd_strength.dxy',
    version: 1,
    family: 'fx.usd_strength',
    nameZh: '美元指数 DXY',
    nameEn: 'US Dollar Index (DXY)',
    descriptionZh: '美元相对一篮子主要货币的指数，不等同于任一双边美元汇率。',
    descriptionEn:
      'The US dollar against a basket of major currencies, not a substitute for any bilateral USD pair.',
    aliases: ['美元指数', '美元强弱', 'dxy', 'dollar index', 'usd index', 'us dollar index'],
  },
  'macro.inflation.us': {
    id: 'macro.inflation.us',
    version: 1,
    family: 'macro.inflation.us',
    nameZh: '美国通胀',
    nameEn: 'US inflation',
    descriptionZh: '美国消费者价格或其他显式登记的美国通胀序列。',
    descriptionEn: 'US consumer-price or another explicitly registered US inflation series.',
    aliases: ['美国通胀', '美国cpi', 'us inflation', 'us cpi', 'american inflation'],
    doNotSubstitute: ['macro.inflation.cn'],
  },
  'macro.inflation.cn': {
    id: 'macro.inflation.cn',
    version: 1,
    family: 'macro.inflation.cn',
    nameZh: '中国通胀',
    nameEn: 'China inflation',
    descriptionZh: '中国消费者价格或其他显式登记的中国通胀序列。',
    descriptionEn: 'China consumer-price or another explicitly registered China inflation series.',
    aliases: ['中国通胀', '中国cpi', '居民消费价格', 'china inflation', 'china cpi', 'cn cpi'],
    doNotSubstitute: ['macro.inflation.us'],
  },
  'risk.market_stress.vix': {
    id: 'risk.market_stress.vix',
    version: 1,
    family: 'risk.market_stress',
    nameZh: 'VIX 市场压力',
    nameEn: 'VIX market stress',
    descriptionZh: '以 VIX 为代表的期权隐含市场压力指标。',
    descriptionEn: 'Option-implied market stress represented by the VIX index.',
    aliases: ['市场压力', '恐慌指数', '避险情绪', 'vix', 'market stress', 'risk aversion'],
  },
  'flows.central_bank.gold_reserves': {
    id: 'flows.central_bank.gold_reserves',
    version: 1,
    family: 'flows.central_bank.gold_reserves',
    nameZh: '央行黄金储备',
    nameEn: 'Central-bank gold reserves',
    descriptionZh: '央行黄金储备存量或变动序列。',
    descriptionEn: 'Central-bank gold-reserve levels or changes.',
    aliases: [
      '央行购金',
      '央行黄金储备',
      '官方黄金储备',
      'central bank gold buying',
      'central bank gold reserves',
    ],
  },
};

export const researchConceptRegistry = {
  version: 1 as const,
  concepts: RESEARCH_CONCEPT_IDS.map((id) => concepts[id]),
};

export const researchConceptById: ReadonlyMap<ResearchConceptId, ResearchConceptDefinitionV1> =
  new Map(researchConceptRegistry.concepts.map((concept) => [concept.id, concept]));

export function inferResearchConceptIds(text: string): ResearchConceptId[] {
  const normalizedText = normalizeConceptText(text);
  const matches = researchConceptRegistry.concepts
    .map((concept) => ({
      concept,
      score: concept.aliases.reduce((best, alias) => {
        const normalizedAlias = normalizeConceptText(alias);
        return normalizedText.includes(normalizedAlias)
          ? Math.max(best, normalizedAlias.length)
          : best;
      }, 0),
    }))
    .filter((match) => match.score > 0);
  const bestByFamily = new Map<string, (typeof matches)[number]>();

  for (const match of matches) {
    const current = bestByFamily.get(match.concept.family);
    if (!current || match.score > current.score) {
      bestByFamily.set(match.concept.family, match);
    }
  }

  return [...bestByFamily.values()].map((match) => match.concept.id);
}

function normalizeConceptText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}._/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
