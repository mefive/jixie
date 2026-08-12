import type {
  FactorMacroRegimeAssetStateReportV1,
  FactorMacroRegimeReportV1,
  FactorMacroRegimeStateKeyV1,
  MacroRegimeFactorResearchSpecV1,
} from '@jixie/shared';
import { mean, median, quantile, std } from '../lib/stats.js';
import { neweyWestMeanInference } from '../lib/inference.js';
import type {
  MacroRegimeEvaluationData,
  MacroRegimeEvaluationObservation,
  MacroRegimeEvaluationPeriod,
} from './macro-regime-observations.js';

const STATE_KEYS: readonly FactorMacroRegimeStateKeyV1[] = [
  'growth_strong_inflation_high',
  'growth_strong_inflation_low',
  'growth_weak_inflation_high',
  'growth_weak_inflation_low',
];
const MINIMUM_PERIODS = 12;
const MINIMUM_ASSET_OBSERVATIONS = 3;

interface StateEpisodeSummary {
  transitions: number;
  durations: Map<FactorMacroRegimeStateKeyV1, number[]>;
}

export class MacroRegimeEvaluator {
  public readonly analysisKind = 'macro_regime' as const;

  public evaluate(
    researchSpec: MacroRegimeFactorResearchSpecV1,
    data: MacroRegimeEvaluationData,
  ): FactorMacroRegimeReportV1 {
    const validated = validateEvaluationData(researchSpec, data);
    const episodes = summarizeEpisodes(validated.periods);
    const previousStateByDate = previousConsecutiveState(validated.periods);
    const neweyWestLag = overlappingTargetLag(researchSpec);
    const periodReports = validated.periods.map(({ score, targetDate }) => ({
      asOfDate: score.asOfDate,
      featureAvailableDate: score.featureAvailableDate,
      latestVintageDate: score.latestVintageDate,
      targetDate,
      state: score.state,
      growthScore: score.growth.score,
      inflationScore: score.inflation.score,
      eligibleAssets: validated.observations.filter(
        (observation) => observation.asOfDate === score.asOfDate,
      ).length,
    }));

    return {
      targetAssets: researchSpec.targetAssets.slice(),
      periods: validated.periods.length,
      observations: validated.observations.length,
      skippedPeriods: validated.skippedMacroDates.length + validated.skippedTargetDates.length,
      revisionPolicy: researchSpec.dataPolicy.revisionPolicy,
      pointInTimeEligible: validated.periods.every(
        (period) => period.score.disclosure.pointInTimeEligible,
      ),
      latestValueBackfillRows: maximumDisclosure(validated.periods, 'latestValueBackfillRows'),
      futureVintageRows: maximumDisclosure(validated.periods, 'futureVintageRows'),
      stateTransitions: episodes.transitions,
      states: STATE_KEYS.map((state) => {
        const statePeriods = validated.periods.filter((period) => period.score.state === state);
        const durations = episodes.durations.get(state) ?? [];
        return {
          key: state,
          periods: statePeriods.length,
          frequency: statePeriods.length / validated.periods.length,
          episodes: durations.length,
          averageDurationPeriods: durations.length ? mean(durations) : null,
          maximumDurationPeriods: durations.length ? Math.max(...durations) : 0,
          byAsset: researchSpec.targetAssets.map((assetId) =>
            summarizeAssetState(
              assetId,
              state,
              validated.observations,
              previousStateByDate,
              neweyWestLag,
            ),
          ),
        };
      }),
      periodReports,
    };
  }
}

function validateEvaluationData(
  researchSpec: MacroRegimeFactorResearchSpecV1,
  data: MacroRegimeEvaluationData,
): MacroRegimeEvaluationData {
  if (
    researchSpec.observationFrequency !== 'monthly' ||
    researchSpec.target.horizonUnit !== 'trade_day' ||
    researchSpec.stateModel.kind !== 'threshold' ||
    researchSpec.stateModel.states !== 4 ||
    researchSpec.targetAssets.length === 0 ||
    new Set(researchSpec.targetAssets).size !== researchSpec.targetAssets.length
  ) {
    throw new Error('Macro regime evaluator requires the frozen V1 research protocol.');
  }
  const periods = data.periods
    .map((period) => ({ ...period, score: { ...period.score } }))
    .sort((left, right) => left.score.asOfDate.localeCompare(right.score.asOfDate));
  if (periods.length < MINIMUM_PERIODS) {
    throw new Error(`Macro regime evaluation requires at least ${MINIMUM_PERIODS} scored periods.`);
  }
  const periodByDate = new Map<string, MacroRegimeEvaluationPeriod>();
  for (const period of periods) {
    const { score, targetDate } = period;
    if (periodByDate.has(score.asOfDate)) {
      throw new Error(`Duplicate macro regime period ${score.asOfDate}.`);
    }
    if (
      !/^\d{8}$/.test(score.asOfDate) ||
      !/^\d{8}$/.test(score.featureAvailableDate) ||
      !/^\d{8}$/.test(score.latestVintageDate) ||
      !/^\d{8}$/.test(targetDate) ||
      !STATE_KEYS.includes(score.state) ||
      score.asOfDate < researchSpec.start ||
      score.asOfDate > researchSpec.end ||
      score.featureAvailableDate > score.asOfDate ||
      targetDate <= score.asOfDate ||
      (researchSpec.dataPolicy.dataCutoff && targetDate > researchSpec.dataPolicy.dataCutoff)
    ) {
      throw new Error(`Macro regime period ${score.asOfDate} violates the frozen time policy.`);
    }
    if (
      score.revisionPolicy !== researchSpec.dataPolicy.revisionPolicy ||
      (score.revisionPolicy === 'as_available' && score.latestVintageDate > score.asOfDate)
    ) {
      throw new Error(`Macro regime period ${score.asOfDate} violates the revision policy.`);
    }
    const expectedPointInTimeEligibility =
      score.revisionPolicy === 'as_available' && score.disclosure.futureVintageRows === 0;
    if (score.disclosure.pointInTimeEligible !== expectedPointInTimeEligibility) {
      throw new Error(`Macro regime period ${score.asOfDate} has inconsistent PIT disclosure.`);
    }
    periodByDate.set(score.asOfDate, period);
  }

  const declaredAssets = new Set(researchSpec.targetAssets);
  const seen = new Set<string>();
  const observations = data.observations
    .map((observation) => ({ ...observation }))
    .sort(
      (left, right) =>
        left.asOfDate.localeCompare(right.asOfDate) || left.assetId.localeCompare(right.assetId),
    );
  for (const observation of observations) {
    const period = periodByDate.get(observation.asOfDate);
    if (!declaredAssets.has(observation.assetId) || !period) {
      throw new Error(`Macro regime observation uses an undeclared asset or period.`);
    }
    if (
      !Number.isFinite(observation.forwardReturn) ||
      observation.forwardReturn <= -1 ||
      observation.featureAvailableDate !== period.score.featureAvailableDate ||
      observation.latestVintageDate !== period.score.latestVintageDate ||
      observation.targetDate !== period.targetDate ||
      observation.state !== period.score.state ||
      observation.growthScore !== period.score.growth.score ||
      observation.inflationScore !== period.score.inflation.score
    ) {
      throw new Error(
        `Macro regime observation ${observation.assetId}:${observation.asOfDate} is inconsistent.`,
      );
    }
    const identity = `${observation.assetId}:${observation.asOfDate}`;
    if (seen.has(identity)) {
      throw new Error(`Duplicate macro regime observation ${identity}.`);
    }
    seen.add(identity);
  }
  for (const assetId of researchSpec.targetAssets) {
    const count = observations.filter((observation) => observation.assetId === assetId).length;
    if (count < MINIMUM_ASSET_OBSERVATIONS) {
      throw new Error(
        `Macro regime asset ${assetId} requires at least ${MINIMUM_ASSET_OBSERVATIONS} observations.`,
      );
    }
  }

  const skippedMacroDates = uniqueDates(data.skippedMacroDates);
  const skippedTargetDates = uniqueDates(data.skippedTargetDates);
  const evaluatedDates = new Set(periods.map((period) => period.score.asOfDate));
  if (skippedMacroDates.some((date) => evaluatedDates.has(date))) {
    throw new Error('Macro regime period cannot be both evaluated and skipped.');
  }
  const accountedDates = new Set([...evaluatedDates, ...skippedMacroDates]);
  if (skippedTargetDates.some((date) => accountedDates.has(date))) {
    throw new Error('Macro regime period cannot be both evaluated and skipped.');
  }

  return {
    periods,
    observations,
    skippedMacroDates,
    skippedTargetDates,
  };
}

function summarizeAssetState(
  assetId: string,
  state: FactorMacroRegimeStateKeyV1,
  observations: MacroRegimeEvaluationObservation[],
  previousStateByDate: Map<string, FactorMacroRegimeStateKeyV1>,
  neweyWestLag: number,
): FactorMacroRegimeAssetStateReportV1 {
  const returns = observations
    .filter((observation) => observation.assetId === assetId && observation.state === state)
    .map((observation) => observation.forwardReturn);
  const laggedReturns = observations
    .filter(
      (observation) =>
        observation.assetId === assetId && previousStateByDate.get(observation.asOfDate) === state,
    )
    .map((observation) => observation.forwardReturn);

  return {
    assetId,
    observations: returns.length,
    meanForwardReturn: returns.length ? mean(returns) : null,
    medianForwardReturn: returns.length ? median(returns) : null,
    forwardReturnVolatility: returns.length > 1 ? std(returns) : null,
    positiveRate: returns.length
      ? returns.filter((forwardReturn) => forwardReturn > 0).length / returns.length
      : null,
    tenthPercentileReturn: returns.length ? quantile(returns, 0.1) : null,
    ninetiethPercentileReturn: returns.length ? quantile(returns, 0.9) : null,
    neweyWestMeanTStat:
      returns.length >= MINIMUM_ASSET_OBSERVATIONS
        ? (neweyWestMeanInference(returns, neweyWestLag)?.tStatistic ?? 0)
        : null,
    onePeriodLagObservations: laggedReturns.length,
    onePeriodLagMeanForwardReturn: laggedReturns.length ? mean(laggedReturns) : null,
  };
}

function summarizeEpisodes(periods: MacroRegimeEvaluationPeriod[]): StateEpisodeSummary {
  const durations = new Map<FactorMacroRegimeStateKeyV1, number[]>();
  let currentState: FactorMacroRegimeStateKeyV1 | null = null;
  let currentDuration = 0;
  let previousDate: string | null = null;
  let transitions = 0;

  const finishEpisode = () => {
    if (!currentState || currentDuration === 0) {
      return;
    }
    const stateDurations = durations.get(currentState) ?? [];
    stateDurations.push(currentDuration);
    durations.set(currentState, stateDurations);
  };
  for (const period of periods) {
    const state = period.score.state;
    const consecutive =
      previousDate != null && isFollowingMonth(previousDate, period.score.asOfDate);
    if (currentState === state && consecutive) {
      currentDuration++;
    } else {
      finishEpisode();
      if (currentState != null && consecutive && currentState !== state) {
        transitions++;
      }
      currentState = state;
      currentDuration = 1;
    }
    previousDate = period.score.asOfDate;
  }
  finishEpisode();
  return { transitions, durations };
}

function previousConsecutiveState(
  periods: MacroRegimeEvaluationPeriod[],
): Map<string, FactorMacroRegimeStateKeyV1> {
  const result = new Map<string, FactorMacroRegimeStateKeyV1>();
  for (let index = 1; index < periods.length; index++) {
    const previous = periods[index - 1];
    const current = periods[index];
    if (isFollowingMonth(previous.score.asOfDate, current.score.asOfDate)) {
      result.set(current.score.asOfDate, previous.score.state);
    }
  }
  return result;
}

function isFollowingMonth(previousDate: string, currentDate: string): boolean {
  const previousMonth = Number(previousDate.slice(0, 4)) * 12 + Number(previousDate.slice(4, 6));
  const currentMonth = Number(currentDate.slice(0, 4)) * 12 + Number(currentDate.slice(4, 6));
  return currentMonth === previousMonth + 1;
}

function overlappingTargetLag(researchSpec: MacroRegimeFactorResearchSpecV1): number {
  return Math.max(0, Math.ceil(researchSpec.target.horizon / 21) - 1);
}

function maximumDisclosure(
  periods: MacroRegimeEvaluationPeriod[],
  key: 'latestValueBackfillRows' | 'futureVintageRows',
): number {
  return Math.max(...periods.map((period) => period.score.disclosure[key]));
}

function uniqueDates(dates: string[]): string[] {
  const unique = [...new Set(dates)].sort();
  if (unique.some((date) => !/^\d{8}$/.test(date))) {
    throw new Error('Macro regime skipped dates must use YYYYMMDD.');
  }
  return unique;
}
