import {
  researchConceptById,
  type ResearchConceptId,
  type ResearchConceptDefinitionV1,
} from './concepts.js';

export const RESEARCH_PLAYBOOK_IDS = ['gold_price_drivers'] as const;
export type ResearchPlaybookId = (typeof RESEARCH_PLAYBOOK_IDS)[number];

export interface ResearchPlaybookConceptV1 {
  conceptId: ResearchConceptId;
  role: 'outcome' | 'driver' | 'context';
  commonHypothesisDirection?: 'positive' | 'negative' | 'two_sided';
  commonTransform?: 'level' | 'difference' | 'simple_return' | 'percent_change' | 'year_over_year';
  rationale: string;
}

export interface ResearchPlaybookDefinitionV1 {
  id: ResearchPlaybookId;
  version: 1;
  name: string;
  description: string;
  triggers: string[];
  concepts: ResearchPlaybookConceptV1[];
  workflow: string[];
  rules: string[];
  suggestedProtocolIds: string[];
}

const playbooks: Record<ResearchPlaybookId, ResearchPlaybookDefinitionV1> = {
  gold_price_drivers: {
    id: 'gold_price_drivers',
    version: 1,
    name: 'Gold price drivers',
    description:
      'Turns a broad question about gold-price movements into explicit outcome proxies, candidate drivers, non-substitution rules, and testable time-series questions.',
    triggers: [
      'why gold rose or fell',
      'gold price logic',
      'gold-price drivers',
      '黄金为什么涨跌',
      '黄金的涨跌逻辑',
    ],
    concepts: [
      {
        conceptId: 'commodity.gold.price',
        role: 'outcome',
        commonTransform: 'simple_return',
        rationale:
          'The user must choose among materially different spot, continuous-future, and ETF proxies and currencies.',
      },
      {
        conceptId: 'rates.us_treasury.real',
        role: 'driver',
        commonHypothesisDirection: 'negative',
        commonTransform: 'difference',
        rationale: 'Real yield is a common opportunity-cost hypothesis for a non-yielding asset.',
      },
      {
        conceptId: 'rates.us_treasury.nominal',
        role: 'driver',
        commonHypothesisDirection: 'negative',
        commonTransform: 'difference',
        rationale:
          'Nominal yield is a distinct opportunity-cost proxy and must not be confused with real yield.',
      },
      {
        conceptId: 'fx.usd_strength.dxy',
        role: 'driver',
        commonHypothesisDirection: 'negative',
        commonTransform: 'simple_return',
        rationale: 'DXY represents broad USD strength rather than one bilateral exchange rate.',
      },
      {
        conceptId: 'macro.inflation.us.cpi.headline',
        role: 'driver',
        commonHypothesisDirection: 'positive',
        commonTransform: 'year_over_year',
        rationale:
          'US headline CPI is a concrete monetary-value hypothesis; it must remain distinct from core CPI and China CPI.',
      },
      {
        conceptId: 'risk.market_stress.vix',
        role: 'driver',
        commonHypothesisDirection: 'positive',
        commonTransform: 'difference',
        rationale: 'Market stress is a candidate safe-haven-demand hypothesis.',
      },
      {
        conceptId: 'flows.central_bank.gold_reserves',
        role: 'driver',
        commonHypothesisDirection: 'positive',
        commonTransform: 'percent_change',
        rationale: 'Official-sector gold demand is a separate flow hypothesis.',
      },
    ],
    workflow: [
      'Resolve all listed concept ids through searchResearchCatalog in one structured request.',
      'Separate registered matches from exact-series gaps; never infer that a protocol is missing merely because one series is absent.',
      'Ask the user to choose an outcome proxy, one or more drivers, a sample window, alignment frequency, transform, lag, hypothesis direction, and—when using multiple drivers—which single driver is focal.',
      'For one driver, run one prespecified time_series_relationship. For two or more jointly requested drivers, use multivariate_time_series_relationship with exactly one focal driver and all remaining drivers as prespecified controls; do not add or remove controls after inspecting significance.',
      'Do not describe contemporaneous correlation or a partial regression coefficient as causal or predictive.',
    ],
    rules: [
      'Do not replace DXY with USD/CNH or another bilateral USD pair.',
      'Do not replace US inflation with China CPI.',
      'Do not replace USD-denominated spot gold with a CNY gold ETF or continuous future without explicit user approval.',
      'Do not replace a continuous future with a single delivery-month contract.',
      'Prefer returns or changes for relationship tests unless a level relationship is explicitly justified.',
      'For a gold-yield relationship, use simple_return for the gold outcome and difference for the yield driver. rates.yield_pct does not register simple_return.',
    ],
    suggestedProtocolIds: ['time_series_relationship', 'multivariate_time_series_relationship'],
  },
};

export const researchPlaybookRegistry = {
  version: 1 as const,
  playbooks: RESEARCH_PLAYBOOK_IDS.map((id) => playbooks[id]),
};

export const researchPlaybookById: ReadonlyMap<ResearchPlaybookId, ResearchPlaybookDefinitionV1> =
  new Map(researchPlaybookRegistry.playbooks.map((playbook) => [playbook.id, playbook]));

export function playbookConceptDefinitions(
  playbook: ResearchPlaybookDefinitionV1,
): ResearchConceptDefinitionV1[] {
  return playbook.concepts.map(({ conceptId }) => researchConceptById.get(conceptId)!);
}

export function researchPlaybookIndex(): Array<
  Pick<ResearchPlaybookDefinitionV1, 'id' | 'version' | 'name' | 'description' | 'triggers'>
> {
  return researchPlaybookRegistry.playbooks.map(({ id, version, name, description, triggers }) => ({
    id,
    version,
    name,
    description,
    triggers,
  }));
}
