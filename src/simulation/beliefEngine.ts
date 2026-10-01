import type { ChangeLevel, CoverageStatus, ScanRecommendation, SchedulerState } from '../types';

export const BELIEF_WEIGHTS = {
  activityProbability: 0.28,
  uncertainty: 0.22,
  predictedActivityBoost: 0.2,
  stalenessFactor: 0.15,
  changeLevelBoost: 0.15,
  scanCost: 0.12,
} as const;

const HISTORY_LENGTH = 20;
const TIMING_HISTORY_LENGTH = 8;
const STALE_AFTER_MS = 8_000;
const VERY_STALE_AFTER_MS = 18_000;
const PREDICTION_WINDOW_MS = 1_500;

export interface BeliefObservation {
  bandId: string;
  result: 'HIT' | 'MISS';
}

export interface BeliefUpdateResult {
  bands: SchedulerState[];
  recommendation: ScanRecommendation;
}

export function createInitialBeliefs(minGHz: number, maxGHz: number): SchedulerState[] {
  // Keep scheduler bins no wider than the receiver's instantaneous passband,
  // so a deterministic band-center tune cannot leave blind gaps between bins.
  const bandCount = Math.max(1, Math.ceil((maxGHz - minGHz) / 0.24));
  const widthGHz = (maxGHz - minGHz) / bandCount;
  return Array.from({ length: bandCount }, (_, index) => {
    const start = minGHz + index * widthGHz;
    return createBand(index, start, Math.min(maxGHz, start + widthGHz));
  });
}

function createBand(index: number, start: number, end: number): SchedulerState {
  return {
    bandId: `rf-${String(index + 1).padStart(2, '0')}`,
    rank: index + 1,
    band: `${bandName(start)} / ${index + 1}`,
    frequencyStartGHz: Number(start.toFixed(3)),
    frequencyEndGHz: Number(end.toFixed(3)),
    activityPercent: 0,
    uncertaintyPercent: 100,
    observationValue: 0,
    dwellMs: Math.round(180 + (index % 5) * 35),
    queueStatus: index === 0 ? 'NEXT' : 'QUEUED',
    activityProbability: 0.05,
    uncertainty: 1,
    predictedActivity: 0.05,
    predictedActivityBoost: 0,
    stalenessFactor: 1,
    changeLevelBoost: 0,
    scanCost: 0,
    timeSinceLastScanMs: 0,
    recentHits: 0,
    recentMisses: 0,
    lastObservedAtMs: null,
    lastHitTimeMs: null,
    averageInterArrivalMs: null,
    changeLevel: 'NONE',
    changeLevelUntilMs: 0,
    coverageStatus: 'FRESH',
    observationHistory: [],
    hitTimesMs: [],
  };
}

function bandName(start: number): string {
  if (start < 4) return 'L/S-BAND';
  if (start < 8) return 'C-BAND';
  if (start < 12) return 'X-BAND';
  if (start < 18) return 'KU-BAND';
  return 'K-BAND';
}

export function updateBeliefs(
  previous: SchedulerState[],
  nowMs: number,
  receiverFrequencyGHz: number,
  currentBandId: string,
  retunesInWindow: number,
  retuneBudget: number,
  observation?: BeliefObservation,
  customOrder?: string[],
  sortMode?: 'OBSERVATION_VALUE' | 'ACTIVITY' | 'UNCERTAINTY' | 'FREQUENCY' | 'DWELL' | 'MANUAL',
): BeliefUpdateResult {
  const observedId = observation?.bandId;
  const updated = previous.map((band) => updateBand(
    band,
    nowMs,
    receiverFrequencyGHz,
    band.bandId === observedId ? observation?.result : undefined,
  ));
  const budgetExhausted = retunesInWindow >= retuneBudget;
  const feasible = budgetExhausted
    ? []
    : updated.filter((band) => band.bandId !== currentBandId);

  let ranked = [...updated];
  if (sortMode === 'ACTIVITY') {
    ranked.sort((a, b) => b.activityPercent - a.activityPercent);
  } else if (sortMode === 'UNCERTAINTY') {
    ranked.sort((a, b) => b.uncertaintyPercent - a.uncertaintyPercent);
  } else if (sortMode === 'FREQUENCY') {
    ranked.sort((a, b) => a.frequencyStartGHz - b.frequencyStartGHz);
  } else if (sortMode === 'DWELL') {
    ranked.sort((a, b) => a.dwellMs - b.dwellMs);
  } else if (sortMode === 'MANUAL' && customOrder && customOrder.length > 0) {
    ranked.sort((a, b) => {
      const idxA = customOrder.indexOf(a.bandId);
      const idxB = customOrder.indexOf(b.bandId);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return b.observationValue - a.observationValue;
    });
  } else {
    ranked.sort((left, right) => right.observationValue - left.observationValue);
  }

  const next = (feasible.sort((left, right) => {
    return ranked.findIndex(r => r.bandId === left.bandId) - ranked.findIndex(r => r.bandId === right.bandId);
  })[0]
    ?? updated.find((band) => band.bandId === currentBandId)
    ?? ranked[0]);

  const bands = ranked.map((band, rank) => ({
    ...band,
    rank: rank + 1,
    queueStatus: (band.bandId === next.bandId ? 'NEXT' : 'QUEUED') as 'NEXT' | 'QUEUED',
  }));
  return { bands, recommendation: makeRecommendation(next, ranked, budgetExhausted) };
}

function updateBand(
  band: SchedulerState,
  nowMs: number,
  receiverFrequencyGHz: number,
  result?: 'HIT' | 'MISS',
): SchedulerState {
  const timeSinceLastScanMs = band.lastObservedAtMs === null ? nowMs : Math.max(0, nowMs - band.lastObservedAtMs);
  const observationHistory = result ? [...band.observationHistory, result].slice(-HISTORY_LENGTH) : band.observationHistory;
  const hitTimesMs = result === 'HIT' ? [...band.hitTimesMs, nowMs].slice(-TIMING_HISTORY_LENGTH) : band.hitTimesMs;
  const recentHits = observationHistory.filter((entry) => entry === 'HIT').length;
  const recentMisses = observationHistory.length - recentHits;
  const activityProbability = result === 'HIT'
    ? band.activityProbability * 0.82 + 0.18
    : result === 'MISS'
      ? band.activityProbability * 0.94
      : band.activityProbability * 0.9995;
  const rates = compareWindows(observationHistory);
  const changeMagnitude = Math.abs(rates.recent - rates.previous);
  const changeLevel: ChangeLevel = changeMagnitude >= 0.55 ? 'HIGH' : changeMagnitude >= 0.3 ? 'MEDIUM' : nowMs < band.changeLevelUntilMs ? band.changeLevel : 'NONE';
  const changeLevelUntilMs = changeMagnitude >= 0.55 ? nowMs + 6_000 : changeMagnitude >= 0.3 ? nowMs + 3_500 : band.changeLevelUntilMs;
  const changeLevelBoost = changeLevel === 'HIGH' ? 1 : changeLevel === 'MEDIUM' ? 0.55 : 0;
  const resetTiming = changeMagnitude >= 0.3;
  const stableHitTimes = resetTiming ? (result === 'HIT' ? [nowMs] : []) : hitTimesMs;
  const intervalStats = calculateIntervalStats(stableHitTimes);
  const averageInterArrivalMs = intervalStats ? intervalStats.mean : null;
  const timingJitterCv = intervalStats ? intervalStats.cv : 0;
  const predictedWindow = averageInterArrivalMs !== null && stableHitTimes.length >= 2
    ? stableHitTimes[stableHitTimes.length - 1] + averageInterArrivalMs
    : null;
  // Directional/spatial scanning introduces cycle jitter, lowering prediction confidence compared to pure periodic transmitters
  const jitterPenalty = timingJitterCv > 0.03 ? Math.max(0.35, 1 - timingJitterCv * 3.0) : 1.0;
  const inWindow = predictedWindow !== null && averageInterArrivalMs !== null && Math.abs(predictedWindow - nowMs) <= Math.max(PREDICTION_WINDOW_MS, averageInterArrivalMs * 0.3);
  const predictedActivityBoost = inWindow
    ? Math.min(1 - activityProbability, 0.35 * jitterPenalty)
    : 0;
  const predictedActivity = Math.min(1, activityProbability + predictedActivityBoost);
  // An unobserved region remains maximally uncertain until the receiver has
  // actually dwelled there. Scanning-beam jitter also keeps residual uncertainty higher.
  const jitterUncertainty = timingJitterCv > 0.03 ? Math.min(0.22, timingJitterCv * 1.1) : 0;
  const uncertainty = result
    ? Math.min(1, 0.12 + changeLevelBoost * 0.35 + jitterUncertainty)
    : band.lastObservedAtMs === null
      ? 1
      : Math.min(1, timeSinceLastScanMs / 12_000 + changeLevelBoost * 0.25 + jitterUncertainty);
  const stalenessFactor = Math.min(1, timeSinceLastScanMs / 12_000);
  const coverageStatus: CoverageStatus = timeSinceLastScanMs >= VERY_STALE_AFTER_MS ? 'VERY_STALE' : timeSinceLastScanMs >= STALE_AFTER_MS ? 'STALE' : 'FRESH';
  const scanCost = Math.min(1, Math.abs((band.frequencyStartGHz + band.frequencyEndGHz) / 2 - receiverFrequencyGHz) / 8);
  const observationValue = clamp01(
    BELIEF_WEIGHTS.activityProbability * activityProbability
    + BELIEF_WEIGHTS.uncertainty * uncertainty
    + BELIEF_WEIGHTS.predictedActivityBoost * predictedActivityBoost
    + BELIEF_WEIGHTS.stalenessFactor * stalenessFactor
    + BELIEF_WEIGHTS.changeLevelBoost * changeLevelBoost
    - BELIEF_WEIGHTS.scanCost * scanCost,
  );
  return {
    ...band,
    activityProbability,
    uncertainty,
    predictedActivity,
    predictedActivityBoost,
    stalenessFactor,
    changeLevelBoost,
    scanCost,
    observationValue: Math.round(observationValue * 100),
    activityPercent: Math.round(activityProbability * 100),
    uncertaintyPercent: Math.round(uncertainty * 100),
    timeSinceLastScanMs: result ? 0 : timeSinceLastScanMs,
    recentHits,
    recentMisses,
    lastObservedAtMs: result ? nowMs : band.lastObservedAtMs,
    lastHitTimeMs: result === 'HIT' ? nowMs : band.lastHitTimeMs,
    averageInterArrivalMs,
    changeLevel,
    changeLevelUntilMs,
    coverageStatus,
    observationHistory,
    hitTimesMs: stableHitTimes,
  };
}

function compareWindows(history: Array<'HIT' | 'MISS'>): { recent: number; previous: number } {
  if (history.length < 8) return { recent: 0, previous: 0 };
  const split = Math.floor(history.length / 2);
  const previous = history.slice(0, split);
  const recent = history.slice(split);
  return {
    recent: recent.filter((entry) => entry === 'HIT').length / recent.length,
    previous: previous.filter((entry) => entry === 'HIT').length / previous.length,
  };
}

function calculateIntervalStats(hitTimesMs: number[]): { mean: number; cv: number } | null {
  if (hitTimesMs.length < 2) return null;
  const intervals = hitTimesMs.slice(1).map((time, index) => time - hitTimesMs[index]);
  const mean = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  if (intervals.length < 2) return { mean, cv: 0 };
  const variance = intervals.reduce((sum, interval) => sum + (interval - mean) ** 2, 0) / intervals.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return { mean, cv };
}

function calculateAverageInterval(hitTimesMs: number[]): number | null {
  const stats = calculateIntervalStats(hitTimesMs);
  return stats ? stats.mean : null;
}

function makeRecommendation(band: SchedulerState, ranked: SchedulerState[], budgetExhausted: boolean): ScanRecommendation {
  const factors = [
    ['predictedActivityBoost', band.predictedActivityBoost, 'timing', 'A recurring hit interval puts its next active window close'],
    ['stalenessFactor', band.stalenessFactor, 'stale', 'this region has become stale'],
    ['uncertainty', band.uncertainty, 'uncertainty', 'uncertainty is rising after a long gap in coverage'],
    ['changeLevelBoost', band.changeLevelBoost, 'change', `${band.changeLevel} change detection is still in recovery`],
    ['activityProbability', band.activityProbability, 'activity', 'recent observations keep activity probability elevated'],
  ] as const;
  const dominant = [...factors].sort((left, right) => right[1] - left[1])[0];
  const neighbor = ranked.find((candidate) => candidate.bandId !== band.bandId);
  const explanation = budgetExhausted
    ? `Scan budget is constrained; ${band.band} remains the highest-value recovery target.`
    : `${dominant[3]} in ${band.band}.`;
  const title = budgetExhausted ? 'Hold current observation'
    : dominant[2] === 'timing' ? 'Follow predicted activity window'
    : dominant[2] === 'stale' ? 'Refresh stale coverage'
      : dominant[2] === 'change' ? 'Investigate behavior change'
        : dominant[2] === 'uncertainty' ? 'Reduce uncertainty'
          : 'Prioritize active region';
  return {
    bandId: band.bandId,
    title,
    frequencyStartGHz: band.frequencyStartGHz,
    frequencyEndGHz: band.frequencyEndGHz,
    likelihood: band.predictedActivity,
    expectedYieldPercent: band.observationValue,
    dwellMs: band.dwellMs,
    basis: neighbor ? `${band.coverageStatus} · ${band.changeLevel} change · ${band.recentHits}H/${band.recentMisses}M` : 'Scheduler belief',
    explanation,
  };
}

/** Shared belief-only explanation used by recommendation and comparison UI. */
export function explainBandState(band: SchedulerState): string {
  return makeRecommendation(band, [band], false).explanation;
}

export function decomposeBandScore(band: SchedulerState) {
  const activityWeight = BELIEF_WEIGHTS.activityProbability;
  const timingWeight = BELIEF_WEIGHTS.predictedActivityBoost;
  const uncertaintyWeight = BELIEF_WEIGHTS.uncertainty;
  const stalenessWeight = BELIEF_WEIGHTS.stalenessFactor;
  const changeWeight = BELIEF_WEIGHTS.changeLevelBoost;
  const costWeight = BELIEF_WEIGHTS.scanCost;

  const activityTerm = Math.round(activityWeight * band.activityProbability * 100);
  const timingTerm = Math.round(timingWeight * band.predictedActivityBoost * 100);
  const uncertaintyTerm = Math.round(uncertaintyWeight * band.uncertainty * 100);
  const stalenessTerm = Math.round(stalenessWeight * band.stalenessFactor * 100);
  const changeTerm = Math.round(changeWeight * band.changeLevelBoost * 100);
  const costTerm = Math.round(costWeight * band.scanCost * 100);

  const factors = [
    { key: 'timing', label: 'Periodic / Scan Timing', score: timingTerm, weightPct: Math.round(timingWeight * 100), raw: band.predictedActivityBoost, desc: 'Temporal window alignment with emitter duty / directional scan cycle' },
    { key: 'activity', label: 'Threat Activity', score: activityTerm, weightPct: Math.round(activityWeight * 100), raw: band.activityProbability, desc: 'Recent observed emitter pulse train energy' },
    { key: 'change', label: 'Change Recovery', score: changeTerm, weightPct: Math.round(changeWeight * 100), raw: band.changeLevelBoost, desc: `${band.changeLevel} agile frequency shift or new emitter emergence` },
    { key: 'staleness', label: 'Staleness Refresh', score: stalenessTerm, weightPct: Math.round(stalenessWeight * 100), raw: band.stalenessFactor, desc: 'Elapsed time since receiver last monitored this band' },
    { key: 'uncertainty', label: 'Uncertainty Reduction', score: uncertaintyTerm, weightPct: Math.round(uncertaintyWeight * 100), raw: band.uncertainty, desc: 'Reconnaissance value of uncharacterized RF space' },
  ].sort((a, b) => b.score - a.score);

  return {
    activityTerm,
    timingTerm,
    uncertaintyTerm,
    stalenessTerm,
    changeTerm,
    costTerm,
    totalObservationValue: band.observationValue,
    factors,
    dominantFactor: factors[0],
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
