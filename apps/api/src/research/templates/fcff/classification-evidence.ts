// Issuer-note transcriptions belong to editable Research evidence, not the financial kernel.
export interface FcffClassificationEvidence {
  identifier: string;
  period: string;
  availableDate: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceUnit: 'CNY' | 'CNY_thousand';
  pages: number[];
  scopeGaps: string;
  items: { item: string; current: number; previous: number; pages: number[] }[];
}

export const FCFF_CLASSIFICATION_EVIDENCE: readonly FcffClassificationEvidence[] = [
  {
    identifier: '000858.SZ',
    period: '2024-12-31',
    availableDate: '20250428',
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/2025-04-26/1223311527.PDF',
    sourceSha256: 'b737191a758994a35e9442d46847de771fe48b758feb9a7f35601def922435e7',
    sourceUnit: 'CNY',
    pages: [112, 115, 117],
    scopeGaps:
      'Partial classification only; associate earnings and assets, tax allocation, restricted-cash recovery, dividends payable, other claims and lease-funded reinvestment remain unaudited. 2025 regulated merchandise liabilities and restricted other current assets remain in the operating proxy; no claim of normalized economics.',
    items: [
      {
        item: 'interest_income',
        current: 2875863410.11,
        previous: 2487953643.33,
        pages: [117],
      },
      {
        item: 'noncurrent_lease',
        current: 393922062.84,
        previous: 115722608.68,
        pages: [115],
      },
      {
        item: 'restricted_cash_minimum',
        current: 126847002.57,
        previous: 200977259.48,
        pages: [112],
      },
    ],
  },
  {
    identifier: '000858.SZ',
    period: '2025-12-31',
    availableDate: '20260506',
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/2026-04-30/1225273091.PDF',
    sourceSha256: '09133e1f44b3bb4b2cebe211529ad68f5b04b6be10b43870f2a78c947d5910a4',
    sourceUnit: 'CNY',
    pages: [107, 110, 113],
    scopeGaps:
      'Partial classification only; associate earnings and assets, tax allocation, restricted-cash recovery, dividends payable, other claims and lease-funded reinvestment remain unaudited. 2025 regulated merchandise liabilities and restricted other current assets remain in the operating proxy; no claim of normalized economics.',
    items: [
      {
        item: 'interest_income',
        current: 2693164763.58,
        previous: 2875863410.11,
        pages: [113],
      },
      {
        item: 'noncurrent_lease',
        current: 44381182.44,
        previous: 393922062.84,
        pages: [110],
      },
      {
        item: 'restricted_cash_minimum',
        current: 334485788.13,
        previous: 126847002.57,
        pages: [107],
      },
    ],
  },
  {
    identifier: '000333.SZ',
    period: '2024-12-31',
    availableDate: '20250331',
    sourceUrl:
      'https://www.midea.com.cn/content/dam/mideacn-aem/%E6%8A%95%E8%B5%84%E8%80%85%E5%85%B3%E7%B3%BB/%E6%8A%95%E8%B5%84%E8%80%85%E5%85%B3%E7%B3%BB%E6%96%87%E4%BB%B6%E6%80%BB%E8%A7%88/2024%E6%96%87%E4%BB%B6/%E7%BE%8E%E7%9A%84%E9%9B%86%E5%9B%A2-2024%E5%B9%B4%E5%B9%B4%E5%BA%A6%E6%8A%A5%E5%91%8A.PDF.coredownload.inline.pdf',
    sourceSha256: 'bc82a1be9e09101ed2c2772844a44b8a356c87a4dbdc0fa44a55eeeabaf94455',
    sourceUnit: 'CNY_thousand',
    pages: [205, 220, 221, 222, 231, 239, 249, 251],
    scopeGaps:
      'Partial classification only; associate earnings and assets, tax allocation, restricted-cash recovery, dividends payable, other claims and lease-funded reinvestment remain unaudited. Financial subsidiary loans/deposits and earnings are not separated; statutory reserve is only a known minimum of restricted cash; derivatives remain paired with operating hedges. Entire pooled impairment reserve is conservatively charged to added assets, allocation unknown.',
    items: [
      {
        item: 'fixed_short',
        current: 20652188,
        previous: 53858011,
        pages: [220],
      },
      {
        item: 'fixed_maturing',
        current: 48582069,
        previous: 5417561,
        pages: [220, 231],
      },
      {
        item: 'fixed_long_including_maturing',
        current: 146264889,
        previous: 84538948,
        pages: [231],
      },
      {
        item: 'cd_current',
        current: 6525002,
        previous: 4664429,
        pages: [220, 221],
      },
      {
        item: 'cd_total',
        current: 6525002,
        previous: 10983476,
        pages: [221],
      },
      {
        item: 'noncurrent_equity',
        current: 4399137,
        previous: 5687591,
        pages: [222],
      },
      {
        item: 'interest_income',
        current: 7200991,
        previous: 6951446,
        pages: [249],
      },
      {
        item: 'trading_disposal_income',
        current: 382895,
        previous: 67383,
        pages: [251],
      },
      {
        item: 'trading_holding_income',
        current: 16780,
        previous: 213095,
        pages: [251],
      },
      {
        item: 'equity_fair_value_income',
        current: 1416460,
        previous: -58735,
        pages: [251],
      },
      {
        item: 'product_fair_value_income',
        current: 26527,
        previous: -6300,
        pages: [251],
      },
      {
        item: 'noncurrent_lease',
        current: 1825258,
        previous: 2047319,
        pages: [239],
      },
      {
        item: 'restricted_cash_minimum',
        current: 2460330,
        previous: 415070,
        pages: [205],
      },
    ],
  },
  {
    identifier: '000333.SZ',
    period: '2025-12-31',
    availableDate: '20260401',
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/2026-03-31/1225065145.PDF',
    sourceSha256: '16f95f70527db59dcf2736f276a9479cf7ee917e5f71e4f6cbbe83acbad9f4b6',
    sourceUnit: 'CNY_thousand',
    pages: [132, 185, 199, 200, 209, 217, 227, 229],
    scopeGaps:
      'Partial classification only; associate earnings and assets, tax allocation, restricted-cash recovery, dividends payable, other claims and lease-funded reinvestment remain unaudited. Financial subsidiary loans/deposits and earnings are not separated; statutory reserve is only a known minimum of restricted cash; derivatives remain paired with operating hedges. Entire pooled impairment reserve is conservatively charged to added assets, allocation unknown.',
    items: [
      {
        item: 'fixed_short',
        current: 1427134,
        previous: 20652188,
        pages: [199],
      },
      {
        item: 'fixed_maturing',
        current: 155362528,
        previous: 48582069,
        pages: [199, 209],
      },
      {
        item: 'fixed_long_including_maturing',
        current: 209650953,
        previous: 146264889,
        pages: [209],
      },
      {
        item: 'cd_current',
        current: 0,
        previous: 6525002,
        pages: [199],
      },
      {
        item: 'cd_total',
        current: 0,
        previous: 6525002,
        pages: [132, 199],
      },
      {
        item: 'noncurrent_equity',
        current: 4437255,
        previous: 4399137,
        pages: [200],
      },
      {
        item: 'pooled_impairment_reserve',
        current: 12331,
        previous: 0,
        pages: [209],
      },
      {
        item: 'interest_income',
        current: 8444301,
        previous: 7200991,
        pages: [227],
      },
      {
        item: 'trading_disposal_income',
        current: 1277335,
        previous: 382895,
        pages: [229],
      },
      {
        item: 'trading_holding_income',
        current: 75210,
        previous: 16780,
        pages: [229],
      },
      {
        item: 'equity_fair_value_income',
        current: -691414,
        previous: 1416460,
        pages: [229],
      },
      {
        item: 'product_fair_value_income',
        current: -25016,
        previous: 26527,
        pages: [229],
      },
      {
        item: 'noncurrent_lease',
        current: 1901053,
        previous: 1825258,
        pages: [217],
      },
      {
        item: 'restricted_cash_minimum',
        current: 751376,
        previous: 2460330,
        pages: [185],
      },
    ],
  },
  {
    identifier: '300750.SZ',
    period: '2024-12-31',
    availableDate: '20250317',
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/2025-03-15/1222806982.PDF',
    sourceSha256: 'b4f1713d7b821eb076c102711d177fe942ccc2bc8dd171ae5d7a95799a65b0ad',
    sourceUnit: 'CNY_thousand',
    pages: [178, 187, 193, 198],
    scopeGaps:
      'Partial classification only; associate earnings and assets, tax allocation, restricted-cash recovery, dividends payable, other claims and lease-funded reinvestment remain unaudited. Strategic equity/OCI holdings, supplier financing and provisions remain in the original proxy; trading deposits already excluded by the kernel are never added twice.',
    items: [
      {
        item: 'noncurrent_equity',
        current: 3135658,
        previous: 2816190,
        pages: [178],
      },
      {
        item: 'interest_income',
        current: 9502997,
        previous: 8321802,
        pages: [198],
      },
      {
        item: 'product_fair_value_income',
        current: 192135,
        previous: 387,
        pages: [198],
      },
      {
        item: 'equity_fair_value_income',
        current: 472089,
        previous: 45883,
        pages: [198],
      },
      {
        item: 'trading_disposal_income',
        current: 179608,
        previous: 26759,
        pages: [198],
      },
      {
        item: 'noncurrent_lease',
        current: 662814,
        previous: 283296,
        pages: [193],
      },
      {
        item: 'restricted_cash_minimum',
        current: 23339555,
        previous: 22475346,
        pages: [187],
      },
    ],
  },
  {
    identifier: '300750.SZ',
    period: '2025-12-31',
    availableDate: '20260311',
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/2026-03-10/1225002214.PDF',
    sourceSha256: 'c15272977147dee7e6935a38ea0e4fd6855370aabb106f54cfe20f7cf6048ec9',
    sourceUnit: 'CNY_thousand',
    pages: [164, 177, 185, 191, 196, 197],
    scopeGaps:
      'Partial classification only; associate earnings and assets, tax allocation, restricted-cash recovery, dividends payable, other claims and lease-funded reinvestment remain unaudited. Strategic equity/OCI holdings, supplier financing and provisions remain in the original proxy; trading deposits already excluded by the kernel are never added twice.',
    items: [
      {
        item: 'noncurrent_equity',
        current: 2882264,
        previous: 3135658,
        pages: [177],
      },
      {
        item: 'interest_income',
        current: 10594657,
        previous: 9502997,
        pages: [196],
      },
      {
        item: 'product_fair_value_income',
        current: 441408,
        previous: 192135,
        pages: [197],
      },
      {
        item: 'equity_fair_value_income',
        current: 535385,
        previous: 472089,
        pages: [197],
      },
      {
        item: 'trading_disposal_income',
        current: 388409,
        previous: 179608,
        pages: [197],
      },
      {
        item: 'noncurrent_lease',
        current: 2805081,
        previous: 662814,
        pages: [191],
      },
      {
        item: 'restricted_cash_minimum',
        current: 18890218,
        previous: 23339555,
        pages: [164, 185],
      },
    ],
  },
];

export function equityFcffClassificationSource(identifier: string): string {
  return `classification_notes = ${JSON.stringify(
    FCFF_CLASSIFICATION_EVIDENCE.filter((item) => item.identifier === identifier),
    null,
    2,
  )}\nclassification_evidence = pd.DataFrame([{key: value for key, value in note.items() if key != "items"} for note in classification_notes])\nclassification_evidence`;
}
