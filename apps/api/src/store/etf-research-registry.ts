export const ETF_RESEARCH_REGISTRY_VERSION = 1 as const;
export const ETF_RESEARCH_SELECTION_AS_OF = '20260824' as const;

export const ETF_RESEARCH_ASSET_CLASSES = [
  'cn_equity',
  'cn_equity_sector',
  'overseas_equity',
  'fixed_income',
  'convertible_bond',
  'gold',
  'commodity',
] as const;

export type EtfResearchAssetClass = (typeof ETF_RESEARCH_ASSET_CLASSES)[number];
export type EtfResearchRegion = 'CN' | 'HK' | 'US' | 'JP' | 'EU' | 'APAC' | 'SA';
export type EtfResearchCurrencyExposure = 'CNY' | 'HKD' | 'USD' | 'JPY' | 'EUR' | 'MULTI';
export type EtfResearchRole = 'primary' | 'backup';

export interface EtfResearchRegistryEntry {
  registryVersion: typeof ETF_RESEARCH_REGISTRY_VERSION;
  exposureId: string;
  assetClass: EtfResearchAssetClass;
  region: EtfResearchRegion;
  marketExposure: string;
  currencyExposure: EtfResearchCurrencyExposure;
  subClass: string;
  benchmarkCode: string;
  primaryTsCode: string;
  backupTsCodes: readonly string[];
  selectionAsOf: typeof ETF_RESEARCH_SELECTION_AS_OF;
  selectionEvidence: string;
  knownLimitations: readonly string[];
}

export interface EtfResearchMembership {
  registryVersion: typeof ETF_RESEARCH_REGISTRY_VERSION;
  exposureId: string;
  assetClass: EtfResearchAssetClass;
  region: EtfResearchRegion;
  marketExposure: string;
  currencyExposure: EtfResearchCurrencyExposure;
  subClass: string;
  benchmarkCode: string;
  role: EtfResearchRole;
  selectionAsOf: typeof ETF_RESEARCH_SELECTION_AS_OF;
  knownLimitations: readonly string[];
}

interface RegistryEntryInput extends Omit<
  EtfResearchRegistryEntry,
  'registryVersion' | 'selectionAsOf' | 'selectionEvidence' | 'knownLimitations'
> {
  selectionEvidence?: string;
  knownLimitations?: readonly string[];
}

const COMMON_SELECTION_EVIDENCE =
  'Registry v1 review of benchmark identity, listing history, trailing turnover, latest fund size, fee, and local data coverage.';
const QDII_LIMITATIONS = [
  'China-listed CNY trading proxy; returns combine the underlying market, FX, fees, premium/discount, and market-close timing.',
  'The China close does not represent a synchronous close of the underlying market.',
] as const;
const FIXED_INCOME_LIMITATIONS = [
  'Fund duration and holdings can drift within the benchmark rules; ETF price return is not a constant-maturity yield series.',
] as const;
const SECTOR_LIMITATIONS = [
  'Sector concentration and benchmark methodology must be reviewed before interpreting the ETF as a diversified equity allocation.',
] as const;
const COMMODITY_LIMITATIONS = [
  'Futures-based ETF returns include contract selection, roll, collateral, fees, and tracking effects.',
] as const;

function entry(input: RegistryEntryInput): EtfResearchRegistryEntry {
  return {
    registryVersion: ETF_RESEARCH_REGISTRY_VERSION,
    selectionAsOf: ETF_RESEARCH_SELECTION_AS_OF,
    selectionEvidence: input.selectionEvidence ?? COMMON_SELECTION_EVIDENCE,
    knownLimitations: input.knownLimitations ?? [],
    ...input,
  };
}

function cnEquity(
  exposureId: string,
  subClass: string,
  benchmarkCode: string,
  primaryTsCode: string,
  backupTsCodes: readonly string[] = [],
): EtfResearchRegistryEntry {
  return entry({
    exposureId,
    assetClass: 'cn_equity',
    region: 'CN',
    marketExposure: 'CN_A_SHARE',
    currencyExposure: 'CNY',
    subClass,
    benchmarkCode,
    primaryTsCode,
    backupTsCodes,
  });
}

function cnSector(
  exposureId: string,
  subClass: string,
  benchmarkCode: string,
  primaryTsCode: string,
  backupTsCodes: readonly string[] = [],
): EtfResearchRegistryEntry {
  return entry({
    exposureId,
    assetClass: 'cn_equity_sector',
    region: 'CN',
    marketExposure: 'CN_A_SHARE',
    currencyExposure: 'CNY',
    subClass,
    benchmarkCode,
    primaryTsCode,
    backupTsCodes,
    knownLimitations: SECTOR_LIMITATIONS,
  });
}

function overseasEquity(
  exposureId: string,
  region: Exclude<EtfResearchRegion, 'CN'>,
  marketExposure: string,
  currencyExposure: Exclude<EtfResearchCurrencyExposure, 'CNY'>,
  subClass: string,
  benchmarkCode: string,
  primaryTsCode: string,
  backupTsCodes: readonly string[] = [],
): EtfResearchRegistryEntry {
  return entry({
    exposureId,
    assetClass: 'overseas_equity',
    region,
    marketExposure,
    currencyExposure,
    subClass,
    benchmarkCode,
    primaryTsCode,
    backupTsCodes,
    knownLimitations: QDII_LIMITATIONS,
  });
}

function fixedIncome(
  exposureId: string,
  subClass: string,
  benchmarkCode: string,
  primaryTsCode: string,
  backupTsCodes: readonly string[] = [],
): EtfResearchRegistryEntry {
  return entry({
    exposureId,
    assetClass: 'fixed_income',
    region: 'CN',
    marketExposure: 'CN_FIXED_INCOME',
    currencyExposure: 'CNY',
    subClass,
    benchmarkCode,
    primaryTsCode,
    backupTsCodes,
    knownLimitations: FIXED_INCOME_LIMITATIONS,
  });
}

/**
 * Versioned representatives for research coverage. Product identity remains in EtfBasic; this
 * registry owns only platform exposure classification and primary/backup selection.
 */
export const ETF_RESEARCH_REGISTRY = [
  cnEquity('cn.sse_50', 'broad_large', '000016.SH', '510050.SH', ['510100.SH']),
  cnEquity('cn.csi_300', 'broad_large', '000300.SH', '510300.SH', ['159919.SZ']),
  cnEquity('cn.csi_a500', 'broad_large', '000510.SH', '563360.SH', ['159338.SZ']),
  cnEquity('cn.sse_180', 'broad_large', '000010.SH', '510180.SH'),
  cnEquity('cn.szse_100', 'broad_large', '399330.SZ', '159901.SZ'),
  cnEquity('cn.csi_500', 'broad_mid', '000905.SH', '510500.SH'),
  cnEquity('cn.csi_1000', 'broad_small', '000852.SH', '512100.SH'),
  cnEquity('cn.csi_2000', 'broad_micro', '932000.CSI', '563300.SH'),
  cnEquity('cn.chinext', 'growth_board', '399006.SZ', '159915.SZ'),
  cnEquity('cn.chinext_50', 'growth_board_large', '399673.SZ', '159949.SZ'),
  cnEquity('cn.star_50', 'technology_board_large', '000688.SH', '588000.SH'),
  cnEquity('cn.star_100', 'technology_board_mid', '000698.SH', '588030.SH'),

  cnEquity('cn.sse_dividend', 'dividend', '000015.SH', '510880.SH'),
  cnEquity('cn.csi_dividend', 'dividend', '000922.CSI', '515180.SH', ['515080.SH']),
  cnEquity('cn.csi_dividend_low_vol', 'low_volatility', 'H30269.CSI', '512890.SH', ['563020.SH']),
  cnEquity('cn.csi_300_value', 'value', '000919.CSI', '562320.SH'),
  cnEquity('cn.csi_300_growth', 'growth', '000918.CSI', '562310.SH'),
  cnEquity('cn.msci_a_quality', 'quality', '707717.MI', '515910.SH'),
  cnEquity('cn.csi_500_quality_growth', 'quality_growth', '930939.CSI', '560500.SH'),
  cnEquity('cn.chinext_momentum_growth', 'momentum_growth', '399296.SZ', '159967.SZ'),
  cnEquity('cn.all_share_free_cash_flow', 'cash_flow', '932365.CSI', '159232.SZ', ['561080.SH']),
  cnEquity('cn.csi_800_value', 'value', 'H30356.CSI', '560030.SH'),
  cnEquity('cn.szse_dividend', 'dividend', '399324.SZ', '159905.SZ'),

  cnSector('cn.sector.bank', 'financials_bank', '399986.SZ', '512800.SH', ['512700.SH']),
  cnSector('cn.sector.securities', 'financials_securities', '399975.SZ', '512880.SH'),
  cnSector('cn.sector.consumer', 'consumer', '000932.SH', '159928.SZ'),
  cnSector('cn.sector.medical_services', 'healthcare_services', '399989.SZ', '512170.SH'),
  cnSector('cn.sector.medicine', 'healthcare', '000991.SH', '159938.SZ'),
  cnSector('cn.sector.semiconductor', 'technology_semiconductor', 'H30184.CSI', '512480.SH'),
  cnSector('cn.sector.chip', 'technology_chip', '980017.SZ', '159995.SZ'),
  cnSector('cn.sector.technology_leaders', 'technology', '931087.CSI', '515000.SH'),
  cnSector('cn.sector.new_energy', 'new_energy', '399808.SZ', '516160.SH', ['159875.SZ']),
  cnSector('cn.sector.new_energy_vehicle', 'new_energy_vehicle', '930997.CSI', '515700.SH'),
  cnSector('cn.sector.defense', 'defense', '399967.SZ', '512660.SH'),
  cnSector('cn.sector.nonferrous_metals', 'resources_nonferrous', '000819.SH', '512400.SH'),
  cnSector('cn.sector.coal', 'resources_coal', '399998.SZ', '515220.SH'),
  cnSector('cn.sector.chemical', 'materials_chemical', '000813.CSI', '516020.SH', ['159870.SZ']),
  cnSector('cn.sector.agriculture', 'agriculture', '000949.CSI', '159825.SZ'),
  cnSector('cn.sector.machinery', 'manufacturing_machinery', '000812.CSI', '516960.SH'),
  cnSector('cn.sector.food_beverage', 'consumer_food_beverage', '000815.CSI', '515170.SH'),

  overseasEquity('hk.hang_seng', 'HK', 'HK', 'HKD', 'hk_broad', 'HSI.HI', '159920.SZ'),
  overseasEquity('hk.h_share', 'HK', 'HK', 'HKD', 'hk_china_enterprise', 'HSCEI.HI', '510900.SH'),
  overseasEquity(
    'hk.hang_seng_technology',
    'HK',
    'HK',
    'HKD',
    'hk_technology',
    'HSTECH.HI',
    '513180.SH',
  ),
  overseasEquity('hk.internet', 'HK', 'HK', 'HKD', 'hk_internet', 'HSIII.HI', '513330.SH'),
  overseasEquity(
    'hk.china_internet',
    'HK',
    'HK_US',
    'MULTI',
    'china_internet',
    'H30533.CSI',
    '513050.SH',
  ),
  overseasEquity(
    'hk.biotechnology',
    'HK',
    'HK',
    'HKD',
    'hk_biotechnology',
    'HSBIO.HI',
    '159892.SZ',
  ),
  overseasEquity('us.sp_500', 'US', 'US', 'USD', 'us_broad', 'SPX.OTH', '513500.SH'),
  overseasEquity('us.nasdaq_100', 'US', 'US', 'USD', 'us_technology', 'NDX.NASDAQ', '513100.SH'),
  overseasEquity('us.msci_50', 'US', 'US', 'USD', 'us_large', '750108.MI', '513850.SH'),
  overseasEquity('us.dow_jones', 'US', 'US', 'USD', 'us_blue_chip', 'DJIA.UN', '513400.SH'),
  overseasEquity('jp.nikkei_225', 'JP', 'JP', 'JPY', 'japan_large', 'N225.JT', '513520.SH'),
  overseasEquity('jp.topix', 'JP', 'JP', 'JPY', 'japan_broad', 'TOPIX.OTH', '513800.SH'),
  overseasEquity('eu.dax', 'EU', 'DE', 'EUR', 'europe_germany', 'GDAXI.GY', '513030.SH'),
  overseasEquity('eu.cac_40', 'EU', 'FR', 'EUR', 'europe_france', 'FCHI.FP', '513080.SH'),
  overseasEquity(
    'apac.developed',
    'APAC',
    'APAC',
    'MULTI',
    'asia_pacific',
    'GPCSP006.OTH',
    '159687.SZ',
  ),
  overseasEquity(
    'sa.saudi_arabia',
    'SA',
    'SA',
    'USD',
    'emerging_saudi',
    'FISAULM.OTH',
    '159329.SZ',
  ),

  fixedIncome('cn.bond.government_5y', 'government_medium', 'H00140.CSI', '511010.SH'),
  fixedIncome('cn.bond.government_10y', 'government_long', 'H11077.CSI', '511260.SH'),
  fixedIncome('cn.bond.government_30y', 'government_ultra_long', 'CBA21801.OTH', '511090.SH'),
  fixedIncome('cn.bond.government_1_3y', 'government_short', '931552.CSI', '511160.SH'),
  fixedIncome(
    'cn.bond.government_policy_0_3y',
    'government_policy_short',
    '932200.CSI',
    '511580.SH',
  ),
  fixedIncome('cn.bond.policy_bank_0_3y', 'policy_bank_short', 'CBA11901.OTH', '159650.SZ', [
    '159651.SZ',
  ]),
  fixedIncome('cn.bond.policy_bank_7_10y', 'policy_bank_long', 'CBA08201.OTH', '511520.SH'),
  fixedIncome('cn.bond.short_financing', 'credit_short', 'H11014.CSI', '511360.SH'),
  fixedIncome('cn.bond.company', 'credit_company', '950245.CSI', '511070.SH'),
  fixedIncome('cn.bond.local_government_5y', 'local_government_medium', '950045.CSI', '511060.SH'),
  entry({
    exposureId: 'cn.bond.convertible',
    assetClass: 'convertible_bond',
    region: 'CN',
    marketExposure: 'CN_CONVERTIBLE_BOND',
    currencyExposure: 'CNY',
    subClass: 'broad_convertible',
    benchmarkCode: '931078.CSI',
    primaryTsCode: '511380.SH',
    backupTsCodes: [],
    knownLimitations: [
      'Convertible-bond returns combine rates, credit, equity optionality, calls, and constituent changes.',
    ],
  }),

  entry({
    exposureId: 'commodity.gold_spot',
    assetClass: 'gold',
    region: 'CN',
    marketExposure: 'SGE_GOLD',
    currencyExposure: 'CNY',
    subClass: 'physical_gold',
    benchmarkCode: 'Au99.99.SGE',
    primaryTsCode: '518880.SH',
    backupTsCodes: ['518800.SH'],
    knownLimitations: ['ETF return includes fund fees and tracking effects versus SGE spot gold.'],
  }),
  entry({
    exposureId: 'commodity.soybean_meal',
    assetClass: 'commodity',
    region: 'CN',
    marketExposure: 'CN_COMMODITY_FUTURES',
    currencyExposure: 'CNY',
    subClass: 'agriculture',
    benchmarkCode: 'DCPFSM01.DCE',
    primaryTsCode: '159985.SZ',
    backupTsCodes: [],
    knownLimitations: COMMODITY_LIMITATIONS,
  }),
  entry({
    exposureId: 'commodity.nonferrous_metals',
    assetClass: 'commodity',
    region: 'CN',
    marketExposure: 'CN_COMMODITY_FUTURES',
    currencyExposure: 'CNY',
    subClass: 'industrial_metals',
    benchmarkCode: 'SGIMCI.SHF',
    primaryTsCode: '159980.SZ',
    backupTsCodes: [],
    knownLimitations: COMMODITY_LIMITATIONS,
  }),
  entry({
    exposureId: 'commodity.energy_chemicals',
    assetClass: 'commodity',
    region: 'CN',
    marketExposure: 'CN_COMMODITY_FUTURES',
    currencyExposure: 'CNY',
    subClass: 'energy_chemicals',
    benchmarkCode: '000201.CZCE',
    primaryTsCode: '159981.SZ',
    backupTsCodes: [],
    knownLimitations: COMMODITY_LIMITATIONS,
  }),
] as const satisfies readonly EtfResearchRegistryEntry[];

export const ETF_RESEARCH_CODES = Object.freeze(
  ETF_RESEARCH_REGISTRY.flatMap((item) => [item.primaryTsCode, ...item.backupTsCodes]),
);
export const ETF_RESEARCH_CODE_SET = new Set<string>(ETF_RESEARCH_CODES);

const membershipByCode = new Map<string, EtfResearchMembership>();

export function validateEtfResearchRegistry(
  registry: readonly EtfResearchRegistryEntry[] = ETF_RESEARCH_REGISTRY,
): void {
  const exposureIds = new Set<string>();
  const productCodes = new Set<string>();
  const errors: string[] = [];

  for (const item of registry) {
    if (item.registryVersion !== ETF_RESEARCH_REGISTRY_VERSION) {
      errors.push(`${item.exposureId}: registryVersion must be ${ETF_RESEARCH_REGISTRY_VERSION}`);
    }
    if (item.selectionAsOf !== ETF_RESEARCH_SELECTION_AS_OF) {
      errors.push(`${item.exposureId}: selectionAsOf must be ${ETF_RESEARCH_SELECTION_AS_OF}`);
    }
    if (exposureIds.has(item.exposureId)) {
      errors.push(`${item.exposureId}: duplicate exposureId`);
    }
    exposureIds.add(item.exposureId);
    if (item.backupTsCodes.length > 1) {
      errors.push(`${item.exposureId}: at most one backup product is allowed in registry v1`);
    }

    for (const code of [item.primaryTsCode, ...item.backupTsCodes]) {
      if (!/^\d{6}\.(SH|SZ)$/.test(code)) {
        errors.push(`${item.exposureId}: invalid ETF code ${code}`);
      }
      if (productCodes.has(code)) {
        errors.push(`${item.exposureId}: product ${code} is assigned to more than one exposure`);
      }
      productCodes.add(code);
    }
    if (item.selectionEvidence.trim().length === 0) {
      errors.push(`${item.exposureId}: selectionEvidence is required`);
    }
    if (item.benchmarkCode.trim().length === 0) {
      errors.push(`${item.exposureId}: benchmarkCode is required`);
    }
  }

  if (registry === ETF_RESEARCH_REGISTRY && (productCodes.size < 60 || productCodes.size > 100)) {
    errors.push(`registry v1 must contain 60..100 products; received ${productCodes.size}`);
  }
  if (errors.length > 0) {
    throw new Error(`Invalid ETF research registry:\n${errors.join('\n')}`);
  }
}

export function etfResearchMembership(tsCode: string): EtfResearchMembership | null {
  return membershipByCode.get(tsCode) ?? null;
}

validateEtfResearchRegistry();
for (const item of ETF_RESEARCH_REGISTRY) {
  for (const [role, codes] of [
    ['primary', [item.primaryTsCode]],
    ['backup', item.backupTsCodes],
  ] as const) {
    for (const code of codes) {
      membershipByCode.set(code, {
        registryVersion: item.registryVersion,
        exposureId: item.exposureId,
        assetClass: item.assetClass,
        region: item.region,
        marketExposure: item.marketExposure,
        currencyExposure: item.currencyExposure,
        subClass: item.subClass,
        benchmarkCode: item.benchmarkCode,
        role,
        selectionAsOf: item.selectionAsOf,
        knownLimitations: item.knownLimitations,
      });
    }
  }
}
