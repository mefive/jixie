import type { ResearchFrequencyV1 } from '@jixie/shared';

export type ResearchMarketV1 = 'CN' | 'HK' | 'US';
export type ResearchAssetClassV1 = 'equity' | 'bond' | 'commodity' | 'macro';
export type ResearchDataContractStatusV1 = 'integrated' | 'planned';
export type ResearchSourceDecisionStatusV1 = 'integrated' | 'candidate';

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

const FX_SOURCE_DECISION_ID = 'tushare.fxcm_daily';
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
      'Adjustment factors may be refreshed and must participate in data fingerprints.',
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
    id: 'tushare.hk_equity',
    version: 1,
    status: 'candidate',
    provider: 'Tushare Pro',
    dataset: 'Hong Kong equity reference, calendar, adjusted daily bars, and adjustment factors',
    nameZh: 'Tushare 港股候选数据源',
    nameEn: 'Tushare Hong Kong equity candidate source',
    keywords: ['港股', '香港股票', 'hk_basic', 'hk_tradecal', 'hk_daily_adj', 'hk_adjfactor'],
    markets: ['HK'],
    assetClasses: ['equity'],
    exactInterfaces: ['hk_basic', 'hk_tradecal', 'hk_daily_adj', 'hk_adjfactor'],
    reviewedAt: '2026-08-15',
    decision:
      'Use as the first connector candidate only after a permission probe and a separate audit of delisted coverage, code changes, corporate actions, and announcement-date PIT fields.',
    license: {
      access: 'separate_paid_permission',
      localResearchUse: 'requires_permission_probe',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'Trial and paid access remain personal non-commercial permissions unless a separate agreement authorizes commercial use or redistribution.',
    },
    coverage: {
      historyDepth: 'Official catalog states full history for hk_basic and hk_daily.',
      delistedCoverage: 'partial',
      pointInTime: 'none',
    },
    rateLimit: 'hk_daily_adj returns at most 6,000 rows per request and supports pagination.',
    cost: 'Separate formal permission; current official catalog lists paid Hong Kong daily access.',
    auditability: 'moderate',
    knownLimits: [
      'The adjusted-price factor may be refreshed by the provider.',
      'The reviewed interfaces do not by themselves prove historical membership or financial announcement PIT completeness.',
      'No local Hong Kong equity tables or quality audit exist yet.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_capability',
        url: 'https://tushare.pro/document/2?doc_id=339',
        finding:
          'The official adjusted-daily interface documents HK codes, fields, paging, and refreshable adjustment factors.',
      },
      {
        kind: 'official_capability',
        url: 'https://tushare.pro/document/2?doc_id=250',
        finding: 'The official Hong Kong trading calendar exposes open days and prior sessions.',
      },
      {
        kind: 'official_access',
        url: 'https://tushare.pro/document/1?doc_id=108',
        finding:
          'The permission catalog lists full history and separate paid access for Hong Kong daily data.',
      },
    ],
  },
  {
    id: 'tushare.us_equity',
    version: 1,
    status: 'candidate',
    provider: 'Tushare Pro',
    dataset: 'US equity reference, calendar, adjusted daily bars, and adjustment factors',
    nameZh: 'Tushare 美股候选数据源',
    nameEn: 'Tushare US equity candidate source',
    keywords: ['美股', '美国股票', 'us_basic', 'us_tradecal', 'us_daily_adj', 'us_adjfactor'],
    markets: ['US'],
    assetClasses: ['equity'],
    exactInterfaces: ['us_basic', 'us_tradecal', 'us_daily_adj', 'us_adjfactor'],
    reviewedAt: '2026-08-15',
    decision:
      'Use as the first connector candidate only after a permission probe and audits for exchange-qualified identity, symbol reuse, delisted coverage, corporate actions, and announcement-date PIT fields.',
    license: {
      access: 'separate_paid_permission',
      localResearchUse: 'requires_permission_probe',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'Trial and paid access remain personal non-commercial permissions unless a separate agreement authorizes commercial use or redistribution.',
    },
    coverage: {
      historyDepth:
        'The reviewed adjusted-daily interface supports date ranges and full-market pagination.',
      delistedCoverage: 'partial',
      pointInTime: 'none',
    },
    rateLimit: 'us_daily_adj returns at most 8,000 rows per request and supports pagination.',
    cost: 'Formal permission is separate from the documented trial access.',
    auditability: 'moderate',
    knownLimits: [
      'Bare US tickers are not globally stable and require exchange plus lifecycle identity locally.',
      'The adjusted-price factor may be refreshed by the provider.',
      'No local US equity tables or quality audit exist yet.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_capability',
        url: 'https://tushare.pro/document/2?doc_id=252',
        finding:
          'The official US basic interface exposes listing and delisting dates and supports delisted status queries.',
      },
      {
        kind: 'official_capability',
        url: 'https://tushare.pro/document/2?doc_id=338',
        finding:
          'The official adjusted-daily interface documents AAPL, exchange codes, fields, paging, and factor revisions.',
      },
    ],
  },
  {
    id: 'chinabond.cn_yield_curves',
    version: 1,
    status: 'integrated',
    provider: 'ChinaBond',
    dataset: 'Public ChinaBond government and credit yield curves',
    nameZh: '中债公开收益率曲线',
    nameEn: 'ChinaBond public yield curves',
    keywords: ['中债', '中国国债收益率', 'chinabond_cgb_ytm', 'ChinaBond yield'],
    markets: ['CN'],
    assetClasses: ['bond'],
    exactInterfaces: ['cbweb-pbc-web/pbc/historyDown'],
    reviewedAt: '2026-08-15',
    decision:
      'Keep the official public workbook as the integrated curve source, with strict parsing, bounded retries, retrieved timestamps, and next-session availability.',
    license: {
      access: 'public_endpoint',
      localResearchUse: 'operational',
      redistribution: 'not_reviewed',
      note: 'Public download availability supports local research ingestion; it does not imply unrestricted redistribution.',
    },
    coverage: {
      historyDepth: 'Measured from downloaded workbooks and audited locally rather than assumed.',
      delistedCoverage: 'not_applicable',
      pointInTime: 'strong',
    },
    rateLimit: 'No published quota is assumed; requests are annual slices with bounded retries.',
    cost: 'Public endpoint; infrastructure cost only.',
    auditability: 'strong',
    knownLimits: [
      'The endpoint can fail transiently and is retried only for network and retryable HTTP failures.',
      'Curve observations are not treated as tradable bond total returns.',
    ],
    evidence: [
      {
        kind: 'official_capability',
        url: 'https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyDown',
        finding:
          'The official ChinaBond host provides the curve-history workbook used by the connector.',
      },
      {
        kind: 'implementation',
        url: 'apps/api/src/rates/chinabond-credit-curves.ts',
        finding:
          'The connector validates workbook identity, terms, date bounds, duplicates, and availability dates.',
      },
    ],
  },
  {
    id: 'tushare.cn_futures',
    version: 1,
    status: 'integrated',
    provider: 'Tushare Pro',
    dataset: 'China commodity futures reference, daily settlement, and continuous mapping',
    nameZh: 'Tushare 中国商品期货数据',
    nameEn: 'Tushare China commodity futures data',
    keywords: ['商品期货', '沪金', 'AU.SHF', 'fut_basic', 'fut_daily', 'fut_mapping'],
    markets: ['CN'],
    assetClasses: ['commodity'],
    exactInterfaces: ['fut_basic', 'fut_daily', 'fut_mapping', 'trade_cal'],
    reviewedAt: '2026-08-15',
    decision:
      'Keep as the integrated private-research source. Actual-contract settlement, lifecycle, and mapping remain separate from continuous-return calculations.',
    license: {
      access: 'token_points',
      localResearchUse: 'operational',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'The current point tier is operational only for personal non-commercial research. Commercial use or redistribution requires separate authorization.',
    },
    coverage: {
      historyDepth: 'Official permission catalog states futures daily history from 1996.',
      delistedCoverage: 'included',
      pointInTime: 'strong',
    },
    rateLimit: 'Point-tier dependent; requests are sliced by exchange and date.',
    cost: 'Existing Tushare account and point tier.',
    auditability: 'strong',
    knownLimits: [
      'A continuous code is a mapping, not a legal instrument or directly tradable price series.',
      'Night-session observations must retain the exchange trading-date assignment.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_access',
        url: 'https://tushare.pro/document/1?doc_id=108',
        finding:
          'The official catalog documents futures history, daily cadence, and permission tiers.',
      },
      {
        kind: 'implementation',
        url: 'apps/api/src/commodity/commodity-continuous-returns.ts',
        finding:
          'Local continuous returns preserve mapped-contract changes separately from roll gaps.',
      },
    ],
  },
  {
    id: 'tushare.cn_etf',
    version: 1,
    status: 'integrated',
    provider: 'Tushare Pro',
    dataset: 'China exchange-traded fund reference, daily bars, and adjustment factors',
    nameZh: 'Tushare 中国 ETF 数据',
    nameEn: 'Tushare China ETF data',
    keywords: ['中国 ETF', '黄金 ETF', 'fund_basic', 'fund_daily', 'fund_adj'],
    markets: ['CN'],
    assetClasses: ['equity', 'commodity'],
    exactInterfaces: ['fund_basic', 'fund_daily', 'fund_adj', 'trade_cal'],
    reviewedAt: '2026-08-15',
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
      'Adjustment-factor changes must participate in data fingerprints.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_access',
        url: 'https://tushare.pro/document/1?doc_id=108',
        finding:
          'The official catalog documents full fund daily history and adjustment-factor access.',
      },
    ],
  },
  {
    id: 'tushare.us_treasury_curves',
    version: 1,
    status: 'integrated',
    provider: 'Tushare Pro',
    dataset: 'US nominal and real Treasury par-yield curves',
    nameZh: 'Tushare 美国国债收益率曲线',
    nameEn: 'Tushare US Treasury yield curves',
    keywords: ['美国国债', '美债收益率', 'us_tycr', 'us_trycr'],
    markets: ['US'],
    assetClasses: ['bond'],
    exactInterfaces: ['us_tycr', 'us_trycr'],
    reviewedAt: '2026-08-15',
    decision:
      'Keep as the integrated normalized par-yield source; never represent yield changes as bond total returns.',
    license: {
      access: 'token_points',
      localResearchUse: 'operational',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'The current account is operational only for personal non-commercial research. Commercial use or redistribution requires separate authorization.',
    },
    coverage: {
      historyDepth: 'Measured and audited from local curve observations.',
      delistedCoverage: 'not_applicable',
      pointInTime: 'strong',
    },
    rateLimit: 'Token-tier dependent.',
    cost: 'Existing Tushare account and point tier.',
    auditability: 'strong',
    knownLimits: [
      'Source-market dates are gated to the first strictly later SSE session for China-close research.',
      'Nominal and real curves and their tenors are distinct contracts.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_capability',
        url: 'https://tushare.pro/document/2?doc_id=219',
        finding: 'The provider documents the US Treasury curve interface and term fields.',
      },
      {
        kind: 'implementation',
        url: 'apps/api/src/rates/external-market-drivers.ts',
        finding:
          'Local normalization stores explicit curve type, tenor, source date, and available date.',
      },
    ],
  },
  {
    id: 'tushare.cn_macro',
    version: 1,
    status: 'integrated',
    provider: 'Tushare Pro',
    dataset: 'China macroeconomic releases and release calendar',
    nameZh: 'Tushare 中国宏观数据',
    nameEn: 'Tushare China macroeconomic data',
    keywords: ['中国宏观', 'cn_cpi', 'cn_pmi', 'cn_schedule', '宏观 vintage'],
    markets: ['CN'],
    assetClasses: ['macro'],
    exactInterfaces: ['cn_cpi', 'cn_pmi', 'cn_ppi', 'cn_m', 'sf_month', 'cn_schedule'],
    reviewedAt: '2026-08-15',
    decision:
      'Keep as the integrated normalized source with explicit release-date quality and captured vintages.',
    license: {
      access: 'token_points',
      localResearchUse: 'operational',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'The current account is operational only for personal non-commercial research. Commercial use or redistribution requires separate authorization.',
    },
    coverage: {
      historyDepth: 'Varies by series and is measured by local observations.',
      delistedCoverage: 'not_applicable',
      pointInTime: 'partial',
    },
    rateLimit: 'Token-tier dependent.',
    cost: 'Existing Tushare account and point tier.',
    auditability: 'strong',
    knownLimits: [
      'Historical imports without original vintages are labeled latest_value_backfill.',
      'Missing official release dates use a documented conservative lag rather than a guessed exact timestamp.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'implementation',
        url: 'apps/api/src/macro/china-macro.ts',
        finding:
          'Local ingestion stores series identity, release and available dates, availability quality, and vintage kind.',
      },
    ],
  },
  {
    id: 'official.us_headline_cpi',
    version: 1,
    status: 'integrated',
    provider: 'BLS with OECD and FRED official fallbacks',
    dataset: 'US CPI-U All Items, not seasonally adjusted',
    nameZh: '美国 CPI-U 官方同序列来源链',
    nameEn: 'Official US CPI-U equivalent-source chain',
    keywords: ['美国 CPI', 'CUUR0000SA0', 'CPIAUCNS', 'OECD CPI'],
    markets: ['US'],
    assetClasses: ['macro'],
    exactInterfaces: [
      'BLS CUUR0000SA0 API/bulk',
      'OECD USA.M.N.CPI.IX._T.N._Z',
      'FRED CPIAUCNS graph CSV',
    ],
    reviewedAt: '2026-08-15',
    decision:
      'Keep the exact BLS series as the semantic identity and fail closed unless an official fallback can be validated and restored to the same index basis.',
    license: {
      access: 'public_endpoint',
      localResearchUse: 'operational',
      redistribution: 'not_reviewed',
      note: 'Official public access is used for local research; third-party or redistribution terms remain separate.',
    },
    coverage: {
      historyDepth: 'Local bootstrap begins in 2005 and is audited for continuity and freshness.',
      delistedCoverage: 'not_applicable',
      pointInTime: 'partial',
    },
    rateLimit:
      'BLS public requests are bounded to ten inclusive years; fallbacks use one cached file.',
    cost: 'Public endpoints; infrastructure cost only.',
    auditability: 'strong',
    knownLimits: [
      'Historical values are latest-value backfills unless a vintage was captured after local ingestion began.',
      'Original release timestamps are unavailable in the series payload and use a documented conservative lag.',
    ],
    evidence: [
      {
        kind: 'official_capability',
        url: 'https://download.bls.gov/pub/time.series/cu/cu.series',
        finding: 'BLS defines CUUR0000SA0 as CPI-U All Items, not seasonally adjusted.',
      },
      {
        kind: 'implementation',
        url: 'apps/api/src/macro/us-headline-cpi.ts',
        finding:
          'The connector validates exact series identity, dimensions, basis conversion, continuity, and freshness.',
      },
    ],
  },
  {
    id: 'tushare.market_benchmarks',
    version: 1,
    status: 'integrated',
    provider: 'Tushare Pro',
    dataset: 'China and international representative price-index daily bars',
    nameZh: 'Tushare 跨市场价格指数基准',
    nameEn: 'Tushare cross-market price-index benchmarks',
    keywords: ['沪深300', '恒生指数', '标普500', 'index_daily', 'index_global'],
    markets: ['CN', 'HK', 'US'],
    assetClasses: ['equity'],
    exactInterfaces: ['index_daily', 'index_global', 'trade_cal'],
    reviewedAt: '2026-08-16',
    decision:
      'Integrate only the fixed CSI 300, Hang Seng, and S&P 500 price-index sample. Keep each source-market close, currency, and China-study-clock availableDate explicit, and never present the index as a tradable or total-return series.',
    license: {
      access: 'token_points',
      localResearchUse: 'operational',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'The current account is operational only for personal non-commercial research. Index-provider rights, commercial use, and redistribution require separate authorization.',
    },
    coverage: {
      historyDepth:
        'The international interface returns at most 4,000 rows per request; local history is synchronized in bounded five-year slices and measured separately.',
      delistedCoverage: 'not_applicable',
      pointInTime: 'strong',
    },
    rateLimit: 'At least 6,000 points for index_global; requests are bounded to five-year slices.',
    cost: 'Existing Tushare account and point tier.',
    auditability: 'strong',
    knownLimits: [
      'The integrated series are price indices and exclude dividend reinvestment.',
      'HSI and SPX closes are unavailable at the same Shanghai close and are gated to the first strictly later SSE session.',
      'Tradable China-listed ETF proxies have independent fees, tracking error, NAV timing, and trading calendars.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_capability',
        url: 'https://tushare.pro/document/2?doc_id=211',
        finding:
          'The official index_global interface documents HSI and SPX codes, daily price-index fields, a 4,000-row response cap, and 6,000-point access.',
      },
      {
        kind: 'implementation',
        url: 'apps/api/src/market/cross-market-benchmarks.ts',
        finding:
          'The local connector validates identities and bars, persists source and available dates, and binds each benchmark to a separate tradable proxy.',
      },
    ],
  },
  {
    id: FX_SOURCE_DECISION_ID,
    version: 1,
    status: 'integrated',
    provider: 'Tushare Pro / FXCM',
    dataset: 'Daily foreign-exchange bid and ask bars',
    nameZh: 'Tushare FXCM 外汇日线',
    nameEn: 'Tushare FXCM daily foreign exchange',
    keywords: ['汇率', 'FX', 'USDCNH', 'fx_daily'],
    markets: ['CN', 'HK', 'US'],
    assetClasses: ['equity', 'bond', 'commodity'],
    exactInterfaces: ['fx_daily'],
    reviewedAt: '2026-08-16',
    decision:
      'Use USDCNH and USDHKD midpoint closes on the first strictly later SSE session. Convert USD assets directly with USDCNH and derive HKD/CNH as USDCNH divided by USDHKD; never claim a direct HKDCNH quote.',
    license: {
      access: 'token_points',
      localResearchUse: 'operational',
      redistribution: 'prohibited_without_separate_authorization',
      note: 'The current account is operational only for personal non-commercial research. FXCM rights, commercial use, and redistribution require separate review and authorization.',
    },
    coverage: {
      historyDepth:
        'Official catalog states full daily history; local coverage is measured separately.',
      delistedCoverage: 'not_applicable',
      pointInTime: 'strong',
    },
    rateLimit: 'At least 2,000 points; request frequency depends on point tier.',
    cost: 'Existing Tushare account and point tier.',
    auditability: 'strong',
    knownLimits: [
      'Provider dates are GMT and are gated to a later SSE session for China-close research.',
      'Bid/ask midpoint is not a guaranteed executable conversion price.',
      'The probed HKDCNH code returned no rows, so the Hong Kong conversion retains both USD cross-rate legs explicitly.',
    ],
    evidence: [
      TUSHARE_PERSONAL_USE_EVIDENCE,
      {
        kind: 'official_capability',
        url: 'https://tushare.pro/document/2?doc_id=179',
        finding:
          'The official interface documents GMT dates, FXCM, bid/ask fields, and point-tier access.',
      },
      {
        kind: 'implementation',
        url: 'apps/api/src/market/cross-market-benchmarks.ts',
        finding:
          'A bounded live probe confirmed USDHKD rows and no HKDCNH rows; local conversion therefore preserves the USDCNH/USDHKD cross-rate formula.',
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
  equityContract({
    id: 'hk.equity.adjusted_close.daily',
    status: 'planned',
    market: 'HK',
    nameZh: '香港股票复权日线',
    nameEn: 'Hong Kong equity adjusted daily close',
    keywords: ['港股', '香港股票', '00001.HK'],
    sourceDecisionId: 'tushare.hk_equity',
    calendarId: 'HKEX',
    timeZone: 'Asia/Hong_Kong',
    observesDaylightSavingTime: false,
    currency: 'HKD',
    canonicalIdPolicy:
      'Use an exchange-qualified, lifecycle-scoped platform identity; provider codes such as 00001.HK are aliases, not the permanent identity by themselves.',
    lifecyclePolicy:
      'Require listing and delisting dates and keep delisted securities before admitting historical universes.',
    codeChangePolicy:
      'Require explicit code-change spells before merging predecessor and successor histories.',
    financialAnnouncementPolicy:
      'Require the original Hong Kong announcement timestamp or a conservative availableDate before financial PIT research.',
  }),
  equityContract({
    id: 'us.equity.adjusted_close.daily',
    status: 'planned',
    market: 'US',
    nameZh: '美国股票复权日线',
    nameEn: 'US equity adjusted daily close',
    keywords: ['美股', '美国股票', 'AAPL'],
    sourceDecisionId: 'tushare.us_equity',
    calendarId: 'US_PRIMARY_EXCHANGE',
    timeZone: 'America/New_York',
    observesDaylightSavingTime: true,
    currency: 'USD',
    canonicalIdPolicy:
      'Use a platform security identity scoped by exchange and lifecycle; a reusable bare ticker such as AAPL is only a provider alias.',
    lifecyclePolicy:
      'Require listing and delisting dates and preserve delisted issues before admitting historical universes.',
    codeChangePolicy:
      'Require symbol-change and exchange-transfer spells; never concatenate same-ticker histories without evidence.',
    financialAnnouncementPolicy:
      'Use the filing or public announcement timestamp converted to the study clock; period end is never the availability date.',
  }),
  equityBenchmarkContract({
    id: 'cn.equity_benchmark.price.daily',
    market: 'CN',
    nameZh: '沪深 300 价格指数日线',
    nameEn: 'CSI 300 daily price index',
    keywords: ['沪深300', 'CSI 300', 'equity.cn.csi300.price'],
    calendarId: 'SSE_SZSE',
    timeZone: 'Asia/Shanghai',
    observesDaylightSavingTime: false,
    currency: 'CNY',
    availabilityPolicy: 'available on the local SSE/SZSE trade date after the China close',
    baseCurrencyReturnPolicy:
      'CNY is both the local and base currency, so the local and CNY returns are identical.',
  }),
  equityBenchmarkContract({
    id: 'hk.equity_benchmark.price.daily',
    market: 'HK',
    nameZh: '恒生价格指数日线',
    nameEn: 'Hang Seng daily price index',
    keywords: ['恒生指数', 'HSI', 'equity.hk.hsi.price'],
    calendarId: 'HKEX',
    timeZone: 'Asia/Hong_Kong',
    observesDaylightSavingTime: false,
    currency: 'HKD',
    availabilityPolicy:
      'for China-close research, first SSE session strictly later than the Hong Kong source-market trade date',
    baseCurrencyReturnPolicy:
      'As of each benchmark availability date, derive HKD/CNH as USDCNH divided by USDHKD using the latest observable bars no more than seven calendar days old, then compute CNY index returns without hiding either FX leg.',
  }),
  equityBenchmarkContract({
    id: 'us.equity_benchmark.price.daily',
    market: 'US',
    nameZh: '标普 500 价格指数日线',
    nameEn: 'S&P 500 daily price index',
    keywords: ['标普500', 'S&P 500', 'SPX', 'equity.us.spx.price'],
    calendarId: 'NYSE_NASDAQ',
    timeZone: 'America/New_York',
    observesDaylightSavingTime: true,
    currency: 'USD',
    availabilityPolicy:
      'for China-close research, first SSE session strictly later than the US source-market trade date',
    baseCurrencyReturnPolicy:
      'As of each benchmark availability date, multiply the USD price-index level by the latest observable USDCNH midpoint no more than seven calendar days old and keep the FX return separately researchable.',
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
    currency: localCurrency('CNY', FX_SOURCE_DECISION_ID),
    corporateActions: {
      applicability: 'required',
      adjustedPricePolicy:
        'Adjusted close equals raw fund close multiplied by the stored factor; factor revisions change the data fingerprint.',
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
      'raw close is not revised; adjustment-factor revisions change the research data fingerprint',
    ),
  },
  {
    id: 'cn.commodity_future.continuous.daily',
    version: 1,
    status: 'integrated',
    nameZh: '中国商品期货连续日线',
    nameEn: 'China commodity futures continuous daily series',
    keywords: ['商品期货', '连续合约', 'AU.SHF', '沪金'],
    market: 'CN',
    assetClass: 'commodity',
    instrumentType: 'continuous_futures_mapping',
    sourceDecisionId: 'tushare.cn_futures',
    identity: {
      canonicalIdPolicy:
        'The continuous code identifies a versioned mapping rule; each observation also retains the actual mapped contract.',
      lifecyclePolicy:
        'Actual contracts retain listing, last-trade, delivery, and delisting fields; expired contracts remain in history.',
      codeChangePolicy:
        'A mapping switch is a roll event, not a code rename; preserve both contract identities and the roll gap.',
    },
    calendar: {
      calendarId: 'CN_FUTURES_EXCHANGE',
      timeZone: 'Asia/Shanghai',
      observesDaylightSavingTime: false,
      sessionDatePolicy:
        'Use the exchange-assigned trading date, including night sessions that begin on the prior civil date.',
      crossMarketAvailabilityPolicy:
        'Settlement and mapping are usable only after the complete exchange trading session is published.',
    },
    currency: localCurrency('CNY', FX_SOURCE_DECISION_ID),
    corporateActions: {
      applicability: 'not_applicable',
      adjustedPricePolicy:
        'Do not apply equity adjustment factors; continuous returns use the mapped actual contract at both interval endpoints.',
      totalReturnPolicy:
        'A futures price return excludes collateral yield and must keep variation margin and roll attribution explicit.',
    },
    pointInTime: {
      financialAnnouncementPolicy: 'Not applicable.',
      macroVintagePolicy: 'Not applicable.',
      revisionPolicy:
        'Daily settlements and mappings are fingerprinted; later mapping changes are data revisions.',
      availableDatePolicy:
        'Use the exchange trading date only after settlement and mapping publication.',
    },
    binding: bindingContract(
      'cn.commodity_future.continuous.daily',
      'daily',
      'quote_currency',
      'CNY',
      'Asia/Shanghai',
      'available after the complete exchange trading session, settlement, and mapping are published',
      'settlement or mapping revisions change the research data fingerprint',
    ),
  },
  {
    id: 'cn.sovereign_yield.daily',
    version: 1,
    status: 'integrated',
    nameZh: '中国国债到期收益率曲线',
    nameEn: 'China government-bond yield curve',
    keywords: ['中债', '中国国债收益率', 'chinabond_cgb_ytm'],
    market: 'CN',
    assetClass: 'bond',
    instrumentType: 'sovereign_yield_curve',
    sourceDecisionId: 'chinabond.cn_yield_curves',
    identity: {
      canonicalIdPolicy:
        'Identify every observation by source, curve code, curve type, source date, and numeric tenor in years.',
      lifecyclePolicy:
        'Curve methodology versions require a new contract version; individual bonds are outside this curve identity.',
      codeChangePolicy:
        'Never merge renamed or methodologically changed curves without an explicit mapping review.',
    },
    calendar: chinaCalendar(
      'ChinaBond curves published after the China close are gated to the first strictly later SSE session.',
    ),
    currency: {
      tradingCurrency: null,
      quoteCurrency: null,
      localReturnPolicy: 'Yield levels and changes are percentages, not currency returns.',
      baseCurrencyReturnPolicy:
        'Not applicable until a priced bond or total-return proxy is selected.',
      fxSourceDecisionId: null,
    },
    corporateActions: {
      applicability: 'not_applicable',
      adjustedPricePolicy: 'Not applicable to a yield curve.',
      totalReturnPolicy:
        'Do not infer a bond total return from the yield level without duration, carry, and price conventions.',
    },
    pointInTime: {
      financialAnnouncementPolicy: 'Not applicable.',
      macroVintagePolicy: 'Not applicable.',
      revisionPolicy:
        'Downloaded curve points are fingerprinted with retrieval time; source corrections create a data revision.',
      availableDatePolicy: 'First SSE session strictly later than the ChinaBond source date.',
    },
    binding: bindingContract(
      'cn.sovereign_yield.daily',
      'daily',
      'percent',
      null,
      'Asia/Shanghai',
      'first SSE session strictly later than the ChinaBond source date',
      'source corrections change the research data fingerprint',
    ),
  },
  {
    id: 'us.sovereign_yield.daily',
    version: 1,
    status: 'integrated',
    nameZh: '美国国债到期收益率曲线',
    nameEn: 'US Treasury yield curve',
    keywords: ['美国国债', '美债收益率', 'us_treasury_nominal', 'us_treasury_real'],
    market: 'US',
    assetClass: 'bond',
    instrumentType: 'sovereign_yield_curve',
    sourceDecisionId: 'tushare.us_treasury_curves',
    identity: {
      canonicalIdPolicy:
        'Identify every observation by source, nominal or real curve code, curve type, source date, and numeric tenor.',
      lifecyclePolicy: 'Curve methodology versions require a new contract version.',
      codeChangePolicy:
        'Nominal and real curves and distinct tenors are never substituted or merged.',
    },
    calendar: {
      calendarId: 'US_TREASURY_PUBLICATION',
      timeZone: 'America/New_York',
      observesDaylightSavingTime: true,
      sessionDatePolicy: 'Retain the source-market publication date in America/New_York.',
      crossMarketAvailabilityPolicy:
        'For China-close research, use the first SSE session strictly later than the source-market date.',
    },
    currency: {
      tradingCurrency: null,
      quoteCurrency: null,
      localReturnPolicy: 'Yield levels and changes are percentages, not currency returns.',
      baseCurrencyReturnPolicy:
        'Not applicable until a priced bond or total-return proxy is selected.',
      fxSourceDecisionId: null,
    },
    corporateActions: {
      applicability: 'not_applicable',
      adjustedPricePolicy: 'Not applicable to a yield curve.',
      totalReturnPolicy: 'Do not infer a bond total return from the yield level.',
    },
    pointInTime: {
      financialAnnouncementPolicy: 'Not applicable.',
      macroVintagePolicy: 'Not applicable.',
      revisionPolicy: 'Source corrections change the research data fingerprint.',
      availableDatePolicy:
        'First SSE session strictly later than the source-market date for China-close studies.',
    },
    binding: bindingContract(
      'us.sovereign_yield.daily',
      'daily',
      'percent',
      null,
      'America/New_York',
      'first SSE session strictly later than the source-market date',
      'source corrections change the research data fingerprint',
    ),
  },
  macroContract({
    id: 'cn.macro.monthly.pit',
    market: 'CN',
    nameZh: '中国月度宏观 PIT 序列',
    nameEn: 'China monthly macro point-in-time series',
    keywords: ['中国宏观', '宏观 vintage', 'cn_cpi'],
    sourceDecisionId: 'tushare.cn_macro',
    timeZone: 'Asia/Shanghai',
    unit: 'percent',
    availabilityPolicy: 'official release date when known, otherwise a documented conservative lag',
    revisionPolicy:
      'captured vintages with latest_value_backfill disclosure for historical imports',
  }),
  macroContract({
    id: 'us.macro.cpi.monthly.pit',
    market: 'US',
    nameZh: '美国 CPI-U 月度 PIT 序列',
    nameEn: 'US CPI-U monthly point-in-time series',
    keywords: ['美国 CPI', 'CUUR0000SA0', 'CPIAUCNS'],
    sourceDecisionId: 'official.us_headline_cpi',
    timeZone: 'America/New_York',
    unit: 'index_1982_1984_100',
    availabilityPolicy:
      'official release date is not present in the series response; month-end plus 20 days and the first matching SSE session is used as a documented conservative lag',
    revisionPolicy:
      'latest-value historical backfill with subsequently captured value-change vintages',
  }),
];

const fixtures: CrossMarketContractFixtureV1[] = [
  fixture(
    'cn-stock-000001-sz',
    'cn.equity.adjusted_close.daily',
    'CN:SSE_SZSE:000001.SZ',
    '000001.SZ',
  ),
  fixture(
    'cn-benchmark-csi300-price',
    'cn.equity_benchmark.price.daily',
    'equity.cn.csi300.price',
    '000300.SH',
  ),
  fixture(
    'hk-benchmark-hsi-price',
    'hk.equity_benchmark.price.daily',
    'equity.hk.hsi.price',
    'HSI',
  ),
  fixture(
    'us-benchmark-spx-price',
    'us.equity_benchmark.price.daily',
    'equity.us.spx.price',
    'SPX',
  ),
  fixture('hk-stock-00001-hk', 'hk.equity.adjusted_close.daily', 'HK:HKEX:00001.HK', '00001.HK'),
  fixture('us-stock-aapl', 'us.equity.adjusted_close.daily', 'US:NASDAQ:AAPL:current', 'AAPL'),
  fixture(
    'cn-bond-10y-cgb',
    'cn.sovereign_yield.daily',
    'CN:YIELD:chinabond_cgb_ytm:10Y',
    'chinabond_cgb_ytm|10',
  ),
  fixture(
    'cn-commodity-au-continuous',
    'cn.commodity_future.continuous.daily',
    'CN:SHFE:AU:CONTINUOUS',
    'AU.SHF',
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

function equityBenchmarkContract(input: {
  id: string;
  market: ResearchMarketV1;
  nameZh: string;
  nameEn: string;
  keywords: string[];
  calendarId: string;
  timeZone: string;
  observesDaylightSavingTime: boolean;
  currency: string;
  availabilityPolicy: string;
  baseCurrencyReturnPolicy: string;
}): CrossMarketResearchDataContractV1 {
  return {
    id: input.id,
    version: 1,
    status: 'integrated',
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    keywords: input.keywords,
    market: input.market,
    assetClass: 'equity',
    instrumentType: 'price_index_benchmark',
    sourceDecisionId: 'tushare.market_benchmarks',
    identity: {
      canonicalIdPolicy:
        'Use the platform benchmark id as the stable research identity and retain the provider code as a versioned source alias.',
      lifecyclePolicy:
        'An index-provider methodology or return-semantics change requires a new benchmark or contract version.',
      codeChangePolicy:
        'Never concatenate provider codes or renamed methodologies without an explicit reviewed mapping.',
    },
    calendar: {
      calendarId: input.calendarId,
      timeZone: input.timeZone,
      observesDaylightSavingTime: input.observesDaylightSavingTime,
      sessionDatePolicy: 'Retain the source exchange local-session trade date.',
      crossMarketAvailabilityPolicy: input.availabilityPolicy,
    },
    currency: {
      tradingCurrency: null,
      quoteCurrency: input.currency,
      localReturnPolicy:
        'Compute the price-index return from consecutive local-currency closes on the audited availability clock.',
      baseCurrencyReturnPolicy: input.baseCurrencyReturnPolicy,
      fxSourceDecisionId: input.currency === 'CNY' ? null : FX_SOURCE_DECISION_ID,
    },
    corporateActions: {
      applicability: 'not_applicable',
      adjustedPricePolicy:
        'The provider price index already embodies its index methodology; do not apply security or ETF adjustment factors.',
      totalReturnPolicy:
        'This contract is price return only and excludes dividend reinvestment; never label it total return.',
    },
    pointInTime: {
      financialAnnouncementPolicy: 'Not applicable to the benchmark price series.',
      macroVintagePolicy: 'Not applicable.',
      revisionPolicy:
        'Provider history corrections change the data fingerprint and retrieval timestamp.',
      availableDatePolicy: input.availabilityPolicy,
    },
    binding: bindingContract(
      input.id,
      'daily',
      'price_index_points',
      input.currency,
      input.timeZone,
      input.availabilityPolicy,
      'provider history corrections change the research data fingerprint',
    ),
  };
}

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
    currency: localCurrency(input.currency, FX_SOURCE_DECISION_ID),
    corporateActions: {
      applicability: 'required',
      adjustedPricePolicy:
        'Store raw OHLC and a separately fingerprinted adjustment factor; an adjusted close is not a raw traded price.',
      totalReturnPolicy:
        'Use a declared reinvestment convention and disclose taxes and fees; never label raw close return as total return.',
    },
    pointInTime: {
      financialAnnouncementPolicy: input.financialAnnouncementPolicy,
      macroVintagePolicy:
        'Not applicable to the price series; macro joins retain their own vintage contract.',
      revisionPolicy:
        'Raw closes are append-only after validation; corporate-action factors and reference histories may revise and change the data fingerprint.',
      availableDatePolicy: availabilityPolicy,
    },
    binding: bindingContract(
      input.id,
      'daily',
      'quote_currency',
      input.currency,
      input.timeZone,
      availabilityPolicy,
      'raw close is not revised; corporate-action or reference-history revisions change the research data fingerprint',
    ),
  };
}

function macroContract(input: {
  id: string;
  market: ResearchMarketV1;
  nameZh: string;
  nameEn: string;
  keywords: string[];
  sourceDecisionId: string;
  timeZone: string;
  unit: string;
  availabilityPolicy: string;
  revisionPolicy: string;
}): CrossMarketResearchDataContractV1 {
  return {
    id: input.id,
    version: 1,
    status: 'integrated',
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    keywords: input.keywords,
    market: input.market,
    assetClass: 'macro',
    instrumentType: 'macro_observation',
    sourceDecisionId: input.sourceDecisionId,
    identity: {
      canonicalIdPolicy:
        'Identify every observation by canonical series key, period, and vintage date.',
      lifecyclePolicy:
        'A definition, seasonal-adjustment, unit, or base-period change requires a new series contract.',
      codeChangePolicy:
        'Never merge renamed or methodologically changed series without an explicit mapping review.',
    },
    calendar: {
      calendarId: `${input.market}_MACRO_RELEASE`,
      timeZone: input.timeZone,
      observesDaylightSavingTime: input.market === 'US',
      sessionDatePolicy:
        'Retain the statistical period separately from releaseDate and availableDate.',
      crossMarketAvailabilityPolicy: input.availabilityPolicy,
    },
    currency: {
      tradingCurrency: null,
      quoteCurrency: null,
      localReturnPolicy: 'Not applicable to a macro observation.',
      baseCurrencyReturnPolicy: 'Not applicable to a macro observation.',
      fxSourceDecisionId: null,
    },
    corporateActions: {
      applicability: 'not_applicable',
      adjustedPricePolicy: 'Not applicable.',
      totalReturnPolicy: 'Not applicable.',
    },
    pointInTime: {
      financialAnnouncementPolicy: 'Not applicable to a macro series.',
      macroVintagePolicy:
        'Store period, releaseDate when known, availableDate, vintageDate, availability quality, and vintage kind separately.',
      revisionPolicy: input.revisionPolicy,
      availableDatePolicy: input.availabilityPolicy,
    },
    binding: bindingContract(
      input.id,
      'monthly',
      input.unit,
      null,
      input.timeZone,
      input.availabilityPolicy,
      input.revisionPolicy,
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

function localCurrency(currency: string, fxSourceDecisionId: string) {
  return {
    tradingCurrency: currency,
    quoteCurrency: currency,
    localReturnPolicy: `Compute the native return in ${currency} before any conversion.`,
    baseCurrencyReturnPolicy:
      'Require an explicit base currency, FX pair direction, and conversion timestamp; preserve local asset return and FX contribution separately.',
    fxSourceDecisionId,
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
