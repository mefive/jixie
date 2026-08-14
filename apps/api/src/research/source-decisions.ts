import type { ResearchConceptId } from './concepts.js';

export type ResearchSourceDecisionStatus = 'blocked_external_license';

export interface ResearchSourceEvidenceV1 {
  kind: 'official_product' | 'usage_rights' | 'provider_catalog';
  url: string;
  finding: string;
}

/** A reviewed source decision explains why an exact Concept does not yet have a local Binding. */
export interface ResearchConceptSourceDecisionV1 {
  id: string;
  version: 1;
  conceptId: ResearchConceptId;
  status: ResearchSourceDecisionStatus;
  exactSeries: string;
  reviewedAt: string;
  summary: string;
  nextAction: string;
  evidence: ResearchSourceEvidenceV1[];
}

const decisions: ResearchConceptSourceDecisionV1[] = [
  {
    id: 'fx.usd_strength.dxy.ice_license_review',
    version: 1,
    conceptId: 'fx.usd_strength.dxy',
    status: 'blocked_external_license',
    exactSeries: 'ICE U.S. Dollar Index (DXY)',
    reviewedAt: '2026-08-14',
    summary:
      'The exact DXY values and methodology are ICE property and cannot be ingested into the product without express written permission. The current Tushare global-index catalog does not list DXY.',
    nextAction:
      'Obtain an ICE-authorized data license, then implement and audit an exact DXY connector before registering a Binding.',
    evidence: [
      {
        kind: 'official_product',
        url: 'https://www.ice.com/publicdocs/ICE_USDX_Brochure.pdf',
        finding: 'ICE identifies the U.S. Dollar Index as its proprietary index.',
      },
      {
        kind: 'usage_rights',
        url: 'https://www.ice.com/publicdocs/ICE_USDX_Brochure.pdf',
        finding: 'ICE requires express written consent for use of index values or methodology.',
      },
      {
        kind: 'provider_catalog',
        url: 'https://tushare.pro/document/2?doc_id=211',
        finding: 'The current Tushare international main-index code list does not include DXY.',
      },
    ],
  },
  {
    id: 'risk.market_stress.vix.cboe_license_review',
    version: 1,
    conceptId: 'risk.market_stress.vix',
    status: 'blocked_external_license',
    exactSeries: 'Cboe Volatility Index (VIX) daily close',
    reviewedAt: '2026-08-14',
    summary:
      'Cboe publishes exact historical VIX closes, but its content terms require advance approval or a license for use of Cboe data in a product. FRED republishes VIX with permission and retains the underlying third-party restriction.',
    nextAction:
      'Obtain Cboe permission or a licensed redistribution source, then implement and audit the exact VIX series before registering a Binding.',
    evidence: [
      {
        kind: 'official_product',
        url: 'https://www.cboe.com/tradable-products/vix/vix-historical-data',
        finding: 'Cboe publishes the exact VIX daily-close history.',
      },
      {
        kind: 'usage_rights',
        url: 'https://www.cboe.com/use-of-content',
        finding: 'Cboe requires advance approval and a license for use of Cboe data or content.',
      },
      {
        kind: 'usage_rights',
        url: 'https://fred.stlouisfed.org/docs/api/terms_of_use.html',
        finding: 'FRED does not remove third-party copyright or permission requirements.',
      },
      {
        kind: 'provider_catalog',
        url: 'https://tushare.pro/document/2?doc_id=211',
        finding: 'The current Tushare international main-index code list does not include VIX.',
      },
    ],
  },
];

export const researchSourceDecisionRegistry = {
  version: 1 as const,
  decisions,
};

export function researchSourceDecisions(
  conceptId: ResearchConceptId,
): ResearchConceptSourceDecisionV1[] {
  return researchSourceDecisionRegistry.decisions.filter(
    (decision) => decision.conceptId === conceptId,
  );
}
