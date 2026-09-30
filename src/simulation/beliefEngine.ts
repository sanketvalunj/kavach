import type { ChangeLevel, CoverageStatus, ScanRecommendation, SchedulerState } from '../types';

export const BELIEF_WEIGHTS = {
  activityProbability: 0.28,
  uncertainty: 0.22,
  predictedActivityBoost: 0.2,
  stalenessFactor: 0.15,
  changeLevelBoost: 0.15,
  scanCost: 0.12,
} as const;

const BAND_COUNT = 32;
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
  const widthGHz = (maxGHz - minGHz) / BAND_COUNT;
  return Array.from({ length: BAND_COUNT }, (_, index) => {
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
  const ranked = [...updated].sort((left, right) => right.observationValue - left.observationValue);
  const next = (feasible.sort((left, right) => right.observationValue - left.observationValue)[0]
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
  const averageInterArrivalMs = calculateAverageInterval(stableHitTimes);
  const predictedWindow = averageInterArrivalMs !== null && stableHitTimes.length >= 2
    ? stableHitTimes[stableHitTimes.length - 1] + averageInterArrivalMs
    : null;
  const predictedActivityBoost = predictedWindow !== null && averageInterArrivalMs !== null && Math.abs(predictedWindow - nowMs) <= Math.max(PREDICTION_WINDOW_MS, averageInterArrivalMs * 0.3)
    ? Math.min(1 - activityProbability, 0.35)
    : 0;
  const predictedActivity = Math.min(1, activityProbability + predictedActivityBoost);
  const uncertainty = result ? Math.min(1, 0.12 + changeLevelBoost * 0.35) : Math.min(1, timeSinceLastScanMs / 12_000 + changeLevelBoost * 0.25);
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

function calculateAverageInterval(hitTimesMs: number[]): number | null {
  if (hitTimesMs.length < 2) return null;
  const intervals = hitTimesMs.slice(1).map((time, index) => time - hitTimesMs[index]);
  return intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}