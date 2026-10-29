import type { ResearchFrequencyV1 } from '@jixie/shared';

export type ResearchMarketV1 = 'CN' | 'HK' | 'US';
export type ResearchAssetClassV1 = 'equity' | 'bond' | 'commodity' | 'macro';
export type ResearchDataContractStatusV1 = 'integrated' | 'planned';
export type ResearchSourceDecisionStatusV1 = 'integrated' | 'candidate';

/**
 * 将概念绑定投影为数据契约语义，供一致性校验。
 *
 * Project a concept binding into data-contract semantics for consistency checks.
 */
export interface ResearchBindingDataContractProjectionV1 {
  id: string;
  version: 1;
  frequency: ResearchFrequencyV1;
  unit: string;
  currency: string | null;
  sourceTimeZone: string;
  availabilityPolicy: string;
  revisionPolicy: string;
}

/**
 * 冻结跨市场身份、时钟、币种与 PIT 限制，供研究目录准入。
 *
 * Define cross-market identity, clock, currency and PIT limits for catalog admission.
 */
export interface CrossMarketResearchDataContractV1 {
  id: string;
  version: 1;
  status: ResearchDataContractStatusV1;
  nameZh: string;
  nameEn: string;
  keywords: string[];
  market: ResearchMarketV1;
  assetClass: ResearchAssetClassV1;
  instrumentType: string;
  sourceDecisionId: string;
  identity: {
    canonicalIdPolicy: string;
    lifecyclePolicy: string;
    codeChangePolicy: string;
  };
  calendar: {
    calendarId: string;
    timeZone: string;
    observesDaylightSavingTime: boolean;
    sessionDatePolicy: string;
    crossMarketAvailabilityPolicy: string;
  };
  currency: {
    tradingCurrency: string | null;
    quoteCurrency: string | null;
    localReturnPolicy: string;
    baseCurrencyReturnPolicy: string;
    fxSourceDecisionId: string | null;
  };
  corporateActions: {
    applicability: 'required' | 'not_applicable';
    adjustedPricePolicy: string;
    totalReturnPolicy: string;
  };
  pointInTime: {
    financialAnnouncementPolicy: string;
    macroVintagePolicy: string;
    revisionPolicy: string;
    availableDatePolicy: string;
  };
  binding: ResearchBindingDataContractProjectionV1;
}

/**
 * 记录研究概念的来源选择与缺口，供数据源矩阵。
 *
 * Describe concept source decisions and gaps in the research source matrix.
 */
export interface ResearchSourceDecisionMatrixEntryV1 {
  id: string;
  version: 1;
  status: ResearchSourceDecisionStatusV1;
  provider: string;
  dataset: string;
  nameZh: string;
  nameEn: string;
  keywords: string[];
  markets: ResearchMarketV1[];
  assetClasses: ResearchAssetClassV1[];
  exactInterfaces: string[];
  reviewedAt: string;
  decision: string;
  license: {
    access: 'token_points' | 'separate_paid_permission' | 'public_endpoint';
    localResearchUse: 'operational' | 'requires_permission_probe';
    redistribution: 'not_reviewed' | 'prohibited_without_separate_authorization';
    note: string;
  };
  coverage: {
    historyDepth: string;
    delistedCoverage: 'included' | 'partial' | 'not_applicable';
    pointInTime: 'strong' | 'partial' | 'none';
  };
  rateLimit: string;
  cost: string;
  auditability: 'strong' | 'moderate';
  knownLimits: string[];
  evidence: Array<{
    kind: 'official_capability' | 'official_access' | 'implementation';
    url: string;
    finding: string;
  }>;
}

/**
 * 提供跨市场契约校验样例，约束未建模市场假设。
 *
 * Supply contract fixtures constraining unmodeled cross-market assumptions.
 */
export interface CrossMarketContractFixtureV1 {
  id: string;
  contractId: string;
  canonicalId: string;
  providerId: string;
  expected: {
    market: ResearchMarketV1;
    assetClass: ResearchAssetClassV1;
    timeZone: string;
    observesDaylightSavingTime: boolean;
    quoteCurrency: string | null;
  };
}
const TUSHARE_PERSONAL_USE_EVIDENCE = {
  kind: 'official_access' as const,
  url: 'https://tushare.pro/document/1?doc_id=405',
  finding:
    'The current data-service agreement grants a personal, non-transferable, non-commercial, revocable, time-limited license for personal viewing only.',
};

const sourceDecisions: ResearchSourceDecisionMatrixEntryV1[] = [
  {
    id: 'tushare.cn_equity',
    version: 1,
    status: 'integrated',
    provider: 'Tushare Pro',
    dataset: 'China A-share reference, daily bars, adjustment factors, and corporate actions',
    nameZh: 'Tushare A 股研究数据',
    nameEn: 'Tushare China A-share research data',
    keywords: ['A股', '中国股票', 'stock_basic', 'tushare.cn_equity'],
    markets: ['CN'],
    assetClasses: ['equity'],
    exactInterfaces: [
      'stock_basic',
      'stock_company',
      'stock_names',
      'daily',
      'adj_factor',
      'dividend',
      'disclosure_date',
      'trade_cal',
    ],
    reviewedAt: '2026-08-15',
    decision:
      'Keep as the integrated private-research source. Canonical aliases, delisted securities, announcement dates, and adjustment factors remain explicit local records.',
    license: {
      access: 'token_points',
      localResearchUse: 'operational',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'The current account is operational only for personal non-commercial research. Commercial use or redistribution requires separate written authorization.',
    },
    coverage: {
      historyDepth:
        'Provider catalog describes full daily history; local coverage is measured separately.',
      delistedCoverage: 'included',
      pointInTime: 'partial',
    },
    rateLimit: 'Point-tier dependent; maintenance uses bounded, resumable requests.',
    cost: 'Existing Tushare account and point tier.',
    auditability: 'strong',
    knownLimits: [
      'Adjustment-factor changes update current data and invalidate cached research sessions.',
      'Not every reference field has historical vintages; absent PIT fields cannot be backfilled with current state.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_access',
        url: 'https://tushare.pro/document/1?doc_id=108',
        finding:
          'The official permission catalog documents history, update cadence, and point tiers.',
      },
      {
        kind: 'implementation',
        url: 'apps/api/prisma/schema.prisma',
        finding:
          'Local StockBasic, StockCodeChange, StockNameHistory, Daily, and AdjFactor tables preserve the implemented contract.',
      },
    ],
  },
  {
    id: 'tushare.cn_etf',
    version: 1,
    status: 'integrated',
    provider: 'Tushare Pro',
    dataset:
      'China ETF directory, listed-code prices and adjustments, and administrator-only latest size',
    nameZh: 'Tushare 中国 ETF 数据',
    nameEn: 'Tushare China ETF data',
    keywords: ['中国 ETF', '黄金 ETF', 'fund_basic', 'fund_daily', 'fund_adj', 'etf_share_size'],
    markets: ['CN'],
    assetClasses: ['equity', 'commodity'],
    exactInterfaces: ['fund_basic', 'fund_daily', 'fund_adj', 'etf_share_size', 'trade_cal'],
    reviewedAt: '2026-08-25',
    decision: 'Keep as the integrated source for explicitly identified exchange-traded funds.',
    license: {
      access: 'token_points',
      localResearchUse: 'operational',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'The current point tier is operational only for personal non-commercial research. Commercial use or redistribution requires separate authorization.',
    },
    coverage: {
      historyDepth:
        'Official catalog describes full fund daily history; local coverage is audited.',
      delistedCoverage: 'included',
      pointInTime: 'partial',
    },
    rateLimit: 'Point-tier dependent.',
    cost: 'Existing Tushare account and point tier.',
    auditability: 'strong',
    knownLimits: [
      'ETF adjusted returns include fund tracking, fees, and trading frictions; they are not the underlying spot return.',
      'Adjustment-factor revisions invalidate cached research sessions.',
      'Latest fund size can be missing, including delayed QDII publications; missing size is not derived and no historical size or NAV research interface is exposed.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_access',
        url: 'https://tushare.pro/document/1?doc_id=108',
        finding:
          'The official catalog documents full fund daily history and adjustment-factor access.',
      },
      {
        kind: 'official_access',
        url: 'https://tushare.pro/document/2?doc_id=408',
        finding:
          'The official ETF share-size interface documents daily fund units, size, NAV, close, and exchange fields.',
      },
      {
        kind: 'implementation',
        url: 'apps/api/src/market/etfs/sync-partition.ts',
        finding:
          'Local synchronization keeps ETF price and adjustment history; latest size snapshots are only used for administrator download selection.',
      },
    ],
  },
];

const contracts: CrossMarketResearchDataContractV1[] = [
  equityContract({
    id: 'cn.equity.adjusted_close.daily',
    status: 'integrated',
    market: 'CN',
    nameZh: '中国内地股票复权日线',
    nameEn: 'China equity adjusted daily close',
    keywords: ['A股', '中国股票', 'adjusted close', '复权收盘价'],
    sourceDecisionId: 'tushare.cn_equity',
    calendarId: 'SSE_SZSE',
    timeZone: 'Asia/Shanghai',
    observesDaylightSavingTime: false,
    currency: 'CNY',
    canonicalIdPolicy:
      'Use the exchange-qualified Tushare code as the storage identity and resolve historical aliases through StockCodeChange.',
    lifecyclePolicy:
      'Retain listed, suspended-listing, approved, and delisted rows with listDate, delistDate, and historical name spells.',
    codeChangePolicy:
      'Map provider-confirmed predecessors to the canonical successor with an effective-date boundary; never join by bare symbol.',
    financialAnnouncementPolicy:
      'Financial values are usable only from their announcement or actual disclosure date; current-state fields cannot fill historical PIT gaps.',
  }),
  {
    id: 'cn.etf.adjusted_close.daily',
    version: 1,
    status: 'integrated',
    nameZh: '中国 ETF 复权日线',
    nameEn: 'China ETF adjusted daily close',
    keywords: ['中国 ETF', '黄金 ETF', 'fund_adj'],
    market: 'CN',
    assetClass: 'commodity',
    instrumentType: 'exchange_traded_fund',
    sourceDecisionId: 'tushare.cn_etf',
    identity: {
      canonicalIdPolicy:
        'Use the exchange-qualified fund code and retain listed and delisted funds.',
      lifecyclePolicy:
        'Store setup, listing, and delisting dates; do not construct historical samples from active funds only.',
      codeChangePolicy: 'Require an explicit alias spell for any fund-code change.',
    },
    calendar: chinaCalendar(
      'Available after the registered China-market close; cross-market use waits for the selected study clock.',
    ),
    currency: localCurrency('CNY'),
    corporateActions: {
      applicability: 'required',
      adjustedPricePolicy:
        'Adjusted close equals raw fund close multiplied by the stored factor; factor revisions invalidate cached research sessions.',
      totalReturnPolicy:
        'Treat adjusted return as the fund return proxy only; disclose fees, tracking error, and that it is not spot commodity total return.',
    },
    pointInTime: {
      financialAnnouncementPolicy: 'Not used as a corporate financial-statement series.',
      macroVintagePolicy: 'Not applicable.',
      revisionPolicy: 'Raw closes are append-only; adjustment factors may be refreshed.',
      availableDatePolicy:
        'The local trade date is available after the registered China-market close.',
    },
    binding: bindingContract(
      'cn.etf.adjusted_close.daily',
      'daily',
      'quote_currency',
      'CNY',
      'Asia/Shanghai',
      'available after the registered China-market close',
      'raw close is not revised; adjustment-factor revisions invalidate cached research sessions',
    ),
  },
];

const fixtures: CrossMarketContractFixtureV1[] = [
  fixture('cn-etf-csi300-price', 'cn.etf.adjusted_close.daily', 'CN:SSE:510300.SH', '510300.SH'),
  fixture(
    'cn-stock-000001-sz',
    'cn.equity.adjusted_close.daily',
    'CN:SSE_SZSE:000001.SZ',
    '000001.SZ',
  ),
];

export const crossMarketDataContractRegistry = {
  version: 1 as const,
  sourceMatrixVersion: 1 as const,
  contracts,
  sourceDecisions,
  fixtures,
};

export const researchDataContractById = new Map(
  crossMarketDataContractRegistry.contracts.map((contract) => [contract.id, contract]),
);

export const researchSourceDecisionById = new Map(
  crossMarketDataContractRegistry.sourceDecisions.map((decision) => [decision.id, decision]),
);

export function researchBindingDataContract(id: string): ResearchBindingDataContractProjectionV1 {
  const contract = researchDataContractById.get(id);
  if (!contract) {
    throw new Error(`Unknown research data contract ${id}`);
  }
  return contract.binding;
}

/**
 * 压缩跨市场契约清单，供 Agent 获取已治理的语义边界。
 *
 * Produce a compact cross-market contract manifest for governed research semantics.
 */
export function compactCrossMarketDataContractRegistry() {
  return {
    version: crossMarketDataContractRegistry.version,
    sourceMatrixVersion: crossMarketDataContractRegistry.sourceMatrixVersion,
    contracts: crossMarketDataContractRegistry.contracts.map((contract) => ({
      id: contract.id,
      version: contract.version,
      status: contract.status,
      market: contract.market,
      assetClass: contract.assetClass,
      instrumentType: contract.instrumentType,
      sourceDecisionId: contract.sourceDecisionId,
      timeZone: contract.calendar.timeZone,
      observesDaylightSavingTime: contract.calendar.observesDaylightSavingTime,
      quoteCurrency: contract.currency.quoteCurrency,
    })),
    sourceDecisions: crossMarketDataContractRegistry.sourceDecisions.map((decision) => ({
      id: decision.id,
      version: decision.version,
      status: decision.status,
      provider: decision.provider,
      dataset: decision.dataset,
      exactInterfaces: decision.exactInterfaces,
      reviewedAt: decision.reviewedAt,
      decision: decision.decision,
      license: decision.license,
      coverage: decision.coverage,
      knownLimits: decision.knownLimits,
      evidence: decision.evidence,
    })),
  };
}

/**
 * 校验跨市场契约、绑定和来源决策的一致性，防止未治理数据进入目录。
 *
 * Validate consistency among cross-market contracts, bindings and source decisions.
 */
export function validateCrossMarketDataContractRegistry(): void {
  assertUniqueIds(contracts, 'data contract');
  assertUniqueIds(sourceDecisions, 'source decision');
  assertUniqueIds(fixtures, 'contract fixture');

  for (const contract of contracts) {
    const sourceDecision = researchSourceDecisionById.get(contract.sourceDecisionId);
    if (!sourceDecision) {
      throw new Error(
        `Research data contract ${contract.id} references unknown source decision ${contract.sourceDecisionId}`,
      );
    }
    if (contract.status === 'integrated' && sourceDecision.status !== 'integrated') {
      throw new Error(
        `Integrated research data contract ${contract.id} cannot reference candidate source ${sourceDecision.id}`,
      );
    }
    if (
      contract.currency.fxSourceDecisionId &&
      !researchSourceDecisionById.has(contract.currency.fxSourceDecisionId)
    ) {
      throw new Error(
        `Research data contract ${contract.id} references unknown FX source decision ${contract.currency.fxSourceDecisionId}`,
      );
    }
    if (contract.binding.id !== contract.id || contract.binding.version !== contract.version) {
      throw new Error(`Research data contract ${contract.id} has a mismatched binding projection`);
    }
  }

  for (const decision of sourceDecisions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(decision.reviewedAt) || decision.evidence.length === 0) {
      throw new Error(`Research source decision ${decision.id} lacks dated evidence`);
    }
    if (
      decision.provider.startsWith('Tushare') &&
      (decision.license.redistribution !== 'prohibited_without_separate_authorization' ||
        !decision.evidence.some((evidence) => evidence.url === TUSHARE_PERSONAL_USE_EVIDENCE.url))
    ) {
      throw new Error(
        `Tushare source decision ${decision.id} must preserve the personal-use license boundary`,
      );
    }
  }

  for (const fixtureItem of fixtures) {
    const contract = researchDataContractById.get(fixtureItem.contractId);
    if (!contract) {
      throw new Error(
        `Cross-market fixture ${fixtureItem.id} references unknown contract ${fixtureItem.contractId}`,
      );
    }
    const actual = {
      market: contract.market,
      assetClass: contract.assetClass,
      timeZone: contract.calendar.timeZone,
      observesDaylightSavingTime: contract.calendar.observesDaylightSavingTime,
      quoteCurrency: contract.currency.quoteCurrency,
    };
    if (JSON.stringify(actual) !== JSON.stringify(fixtureItem.expected)) {
      throw new Error(`Cross-market fixture ${fixtureItem.id} does not match contract fields`);
    }
  }
}

/**
 * 为股票研究建立明确证券身份、交易和可得性口径的契约。
 *
 * Construct an equity research contract with identity, trading and availability conventions.
 */
function equityContract(input: {
  id: string;
  status: ResearchDataContractStatusV1;
  market: ResearchMarketV1;
  nameZh: string;
  nameEn: string;
  keywords: string[];
  sourceDecisionId: string;
  calendarId: string;
  timeZone: string;
  observesDaylightSavingTime: boolean;
  currency: string;
  canonicalIdPolicy: string;
  lifecyclePolicy: string;
  codeChangePolicy: string;
  financialAnnouncementPolicy: string;
}): CrossMarketResearchDataContractV1 {
  const availabilityPolicy = `available after the registered ${input.market} primary-market close; cross-market studies use the selected study clock and never same-calendar-day guessing`;
  return {
    id: input.id,
    version: 1,
    status: input.status,
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    keywords: input.keywords,
    market: input.market,
    assetClass: 'equity',
    instrumentType: 'stock',
    sourceDecisionId: input.sourceDecisionId,
    identity: {
      canonicalIdPolicy: input.canonicalIdPolicy,
      lifecyclePolicy: input.lifecyclePolicy,
      codeChangePolicy: input.codeChangePolicy,
    },
    calendar: {
      calendarId: input.calendarId,
      timeZone: input.timeZone,
      observesDaylightSavingTime: input.observesDaylightSavingTime,
      sessionDatePolicy: 'Assign a daily bar to the exchange-local regular-session trade date.',
      crossMarketAvailabilityPolicy: availabilityPolicy,
    },
    currency: localCurrency(input.currency),
    corporateActions: {
      applicability: 'required',
      adjustedPricePolicy:
        'Store raw OHLC and a separate adjustment factor; an adjusted close is not a raw traded price.',
      totalReturnPolicy:
        'Use a declared reinvestment convention and disclose taxes and fees; never label raw close return as total return.',
    },
    pointInTime: {
      financialAnnouncementPolicy: input.financialAnnouncementPolicy,
      macroVintagePolicy:
        'Not applicable to the price series; macro joins retain their own vintage contract.',
      revisionPolicy:
        'Raw closes are append-only after validation; corporate-action factors and reference histories may revise and invalidate cached research sessions.',
      availableDatePolicy: availabilityPolicy,
    },
    binding: bindingContract(
      input.id,
      'daily',
      'quote_currency',
      input.currency,
      input.timeZone,
      availabilityPolicy,
      'raw close is not revised; corporate-action or reference-history revisions invalidate cached research sessions',
    ),
  };
}

function chinaCalendar(crossMarketAvailabilityPolicy: string) {
  return {
    calendarId: 'SSE',
    timeZone: 'Asia/Shanghai',
    observesDaylightSavingTime: false,
    sessionDatePolicy: 'Assign observations to the exchange-local trade date.',
    crossMarketAvailabilityPolicy,
  };
}

function localCurrency(currency: string) {
  return {
    tradingCurrency: currency,
    quoteCurrency: currency,
    localReturnPolicy: `Compute the native return in ${currency} before any conversion.`,
    baseCurrencyReturnPolicy:
      'Only local CNY returns are supported; cross-market FX conversion is unavailable.',
    fxSourceDecisionId: null,
  };
}

function bindingContract(
  id: string,
  frequency: ResearchFrequencyV1,
  unit: string,
  currency: string | null,
  sourceTimeZone: string,
  availabilityPolicy: string,
  revisionPolicy: string,
): ResearchBindingDataContractProjectionV1 {
  return {
    id,
    version: 1,
    frequency,
    unit,
    currency,
    sourceTimeZone,
    availabilityPolicy,
    revisionPolicy,
  };
}

function fixture(
  id: string,
  contractId: string,
  canonicalId: string,
  providerId: string,
): CrossMarketContractFixtureV1 {
  const contract = contracts.find((candidate) => candidate.id === contractId);
  if (!contract) {
    throw new Error(`Cannot build cross-market fixture ${id} for unknown contract ${contractId}`);
  }
  return {
    id,
    contractId,
    canonicalId,
    providerId,
    expected: {
      market: contract.market,
      assetClass: contract.assetClass,
      timeZone: contract.calendar.timeZone,
      observesDaylightSavingTime: contract.calendar.observesDaylightSavingTime,
      quoteCurrency: contract.currency.quoteCurrency,
    },
  };
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Cross-market ${label} ids must be unique`);
  }
}

validateCrossMarketDataContractRegistry();
