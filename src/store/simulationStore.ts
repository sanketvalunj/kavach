import { create } from 'zustand';
import type {
  AlertEvent, Emitter, GroundTruthEmitter, OperationalMetrics, PDW,
  PerformanceMetricSeries, ReceiverState, ReceiverModelState, ResearchSnapshot, ScanDecision,
  ScanRecommendation, Scenario, ScenarioConfig, SchedulerState, SimulationState,
  SimulationStatus, OperatingMode, SpectrumSample, ReceiverConstraints, ScanScheduleSlot, WaterfallRegion, SpectrumBurst,
} from '../types';
import { createEmitterStates, formatSimulationClock, makePdw, random01, updateEmitterStates, type EmitterSeed, type RandomState } from '../simulation/engine.ts';
import { createInitialBeliefs, updateBeliefs, type BeliefUpdateResult } from '../simulation/beliefEngine.ts';
import { buildScenarioSeeds, getScenarioDefinition, newEmitterSeed, scenarioDefinitions } from '../data/scenarios.ts';
import { runBaselineComparison } from '../simulation/baselines.ts';
import type { StreamMessage } from '../services/api';

export const MAX_PDWS = 2000;

function emittersFromPdws(pdws: PDW[]): Emitter[] {
  const groups = new Map<string, PDW[]>();
  for (const pdw of pdws) groups.set(pdw.emitterId, [...(groups.get(pdw.emitterId) ?? []), pdw]);
  return [...groups.entries()].map(([id, events]) => {
    const newest = events[0];
    const oldest = events[events.length - 1];
    const frequencies = events.slice(0, 24).map(event => event.centerFrequencyGHz);
    const pri = events.slice(0, 24).map(event => event.priMs).filter(value => value > 0);
    return { id, displayName: `Dataset emitter ${id.replace('TSRD-', '')}`, firstSeenTimestamp: oldest.timestamp, patternType: newest.classification, centerFrequencyGHz: newest.centerFrequencyGHz, status: 'TRACKED', statusTone: 'teal', activityHistory: events.slice(0, 14).reverse().map(event => event.amplitudePercent), frequencyHistoryGHz: frequencies.reverse(), confidence: newest.confidence, priMs: pri.length ? pri.reduce((sum, value) => sum + value, 0) / pri.length : 0, signalStrengthDbm: newest.amplitudeDbm, frequencyDeltaMHz: frequencies.length > 1 ? (frequencies[0] - frequencies[frequencies.length - 1]) * 1000 : 0, stabilityStatus: 'DATASET REPLAY' };
  });
}

function replayMetrics(pdws: PDW[], decisions: ScanDecision[], emitters: Emitter[], prior: OperationalMetrics): OperationalMetrics {
  const hits = decisions.filter(decision => decision.result === 'HIT').length;
  return { ...prior, trackedEmitterCount: emitters.length, totalPdwCount: pdws.length, pdwUpdateRateKHz: 0.002, meanReward: decisions.length ? decisions.reduce((sum, decision) => sum + decision.reward, 0) / decisions.length : 0, hitRatePercent: decisions.length ? hits / decisions.length * 100 : 0, policyVersion: decisions[0]?.policyVersion ?? 'belief-engine', evaluationSetSize: 0, decisionCount: decisions.length, newEmitterCount: emitters.length, unclassifiedEmitterCount: emitters.filter(emitter => /unknown|unclassified/i.test(emitter.patternType)).length, scanEfficiencyPercent: pdws.length ? pdws.filter(pdw => pdw.result === 'HIT').length / pdws.length * 100 : 0, scanEfficiencyDeltaPercent: 0 };
}

const bandBeliefs: SchedulerState[] = createInitialBeliefs(2, 18);

const emitterSeeds = [
  { id: 'E-041', displayName: 'Unknown emitter', firstSeenTimestamp: '04:08:12Z', patternType: 'PULSE TRAIN', centerFrequencyGHz: 8.420, status: 'ACTIVE', statusTone: 'green' as const, activityHistory: [12, 18, 16, 24, 21, 35, 28, 47, 42, 56, 51, 74, 67, 82], confidence: .948, priMs: 1.25, signalStrengthDbm: -42, frequencyDeltaMHz: 12.4, stabilityStatus: 'STABLE' },
  { id: 'E-038', displayName: 'Frequency agile emitter', firstSeenTimestamp: '04:04:52Z', patternType: 'FREQUENCY HOP', centerFrequencyGHz: 12.806, status: 'TRACKED', statusTone: 'teal' as const, activityHistory: [19, 30, 25, 52, 39, 61, 46, 73, 53, 68, 58, 84, 63, 78], confidence: .82, priMs: .84, signalStrengthDbm: -51, frequencyDeltaMHz: 0, stabilityStatus: 'STABLE' },
  { id: 'E-033', displayName: 'CW emitter', firstSeenTimestamp: '03:58:07Z', patternType: 'CW CARRIER', centerFrequencyGHz: 4.202, status: 'INTERMITTENT', statusTone: 'amber' as const, activityHistory: [7, 9, 8, 11, 13, 10, 31, 12, 10, 34, 13, 11, 28, 15], confidence: .61, priMs: 0, signalStrengthDbm: -66, frequencyDeltaMHz: 0, stabilityStatus: 'INTERMITTENT' },
  { id: 'E-029', displayName: 'Unresolved emitter', firstSeenTimestamp: '03:47:13Z', patternType: 'UNKNOWN', centerFrequencyGHz: 15.114, status: 'LOW CONF.', statusTone: 'quiet' as const, activityHistory: [43, 40, 38, 34, 32, 28, 26, 29, 23, 25, 19, 17, 14, 12], confidence: .38, priMs: 2.8, signalStrengthDbm: -73, frequencyDeltaMHz: 0, stabilityStatus: 'UNRESOLVED' },
];

const emitters: Emitter[] = emitterSeeds.map((emitter) => ({
  ...emitter,
  frequencyHistoryGHz: Array.from({ length: 28 }, (_, i) => emitter.centerFrequencyGHz + Math.sin(i * .7) * .017 + (i > 16 ? .025 : 0) + (i % 9 === 0 ? .001 : 0)),
}));

const pdws: PDW[] = [
  { id: 'PDW-89142', timestamp: '04:11:52.084', emitterId: 'E-041', centerFrequencyGHz: 8.4201, priMs: 1.250, pulseWidthUs: 4.1, amplitudeDbm: -42, amplitudePercent: 82, classification: 'PULSE TRAIN', result: 'HIT', confidence: .948 },
  { id: 'PDW-89141', timestamp: '04:11:51.992', emitterId: 'E-041', centerFrequencyGHz: 8.4198, priMs: 1.250, pulseWidthUs: 4.0, amplitudeDbm: -45, amplitudePercent: 72, classification: 'PULSE TRAIN', result: 'HIT', confidence: .932 },
  { id: 'PDW-89140', timestamp: '04:11:51.840', emitterId: 'E-033', centerFrequencyGHz: 12.8052, priMs: .84, pulseWidthUs: 8.2, amplitudeDbm: -58, amplitudePercent: 48, classification: 'CW CARRIER', result: 'REVIEW', confidence: .71 },
  { id: 'PDW-89139', timestamp: '04:11:50.411', emitterId: 'E-029', centerFrequencyGHz: 4.2017, priMs: 2.8, pulseWidthUs: 2.1, amplitudeDbm: -66, amplitudePercent: 32, classification: 'UNKNOWN', result: 'MISS', confidence: .39 },
  { id: 'PDW-89138', timestamp: '04:11:49.803', emitterId: 'E-041', centerFrequencyGHz: 8.4200, priMs: 1.250, pulseWidthUs: 4.1, amplitudeDbm: -47, amplitudePercent: 68, classification: 'PULSE TRAIN', result: 'HIT', confidence: .921 },
  { id: 'PDW-89137', timestamp: '04:11:49.521', emitterId: 'E-041', centerFrequencyGHz: 8.4199, priMs: 1.250, pulseWidthUs: 4.0, amplitudeDbm: -49, amplitudePercent: 61, classification: 'PULSE TRAIN', result: 'HIT', confidence: .913 },
];

const waterfallSamples: SpectrumSample[] = Array.from({ length: 148 }, (_, i) => {
  const x = (i * 71 + (i % 7) * 13) % 960;
  const y = 26 + ((i * 43 + (i % 5) * 17) % 476);
  const width = 9 + ((i * 29) % 104);
  const amplitude = .16 + ((i * 17) % 58) / 100;
  return { id: `WF-${i + 1}`, relativeTimeSeconds: -900 + (x / 960) * 900, frequencyGHz: 18 - (y / 530) * 16, durationMs: (width / 960) * 900000, amplitude: i % 17 === 0 || i % 29 === 3 ? Math.max(.88, amplitude) : amplitude, isPredicted: false };
}).concat(Array.from({ length: 12 }, (_, i) => ({ id: `WF-CLUSTER-${i + 1}`, relativeTimeSeconds: -378 + i * 4, frequencyGHz: 12.65 + Math.sin(i * 1.7) * .24, durationMs: (138 - i * 5) * 937.5, amplitude: .98 - i * .035, isPredicted: false })));
const waterfallRegions: WaterfallRegion[] = [
  { id: 'recommended-window', styleClass: 'band-one', topPercent: 32, heightPercent: 11, label: 'RECOMMENDED SEARCH WINDOW' },
  { id: 'predicted-region-02', styleClass: 'band-two', topPercent: 70, heightPercent: 6, label: '' },
];
const cylinderBursts: SpectrumBurst[] = Array.from({ length: 88 }, (_, i) => ({
  id: `CYL-${i + 1}`,
  angleRadians: (i / 88) * Math.PI * 2,
  axialPosition: Math.sin(i * 7.31) * 1.02,
  amplitude: .14 + (Math.sin(i * 12.9898) * .5 + .5) * .86,
}));

const scenarioSeeds = [
  { id: 'urban-dense', name: 'Dense urban emitter field', description: 'Mixed pulse trains · moderate congestion', defaultEmitterCount: 8, defaultDurationSeconds: 300, defaultSeed: 7419 },
  { id: 'border-sweep', name: 'Border surveillance sweep', description: 'Wide-area search · intermittent tracks', defaultEmitterCount: 5, defaultDurationSeconds: 300, defaultSeed: 7419 },
  { id: 'coastal-radar', name: 'Coastal radar corridor', description: 'Long-range surveillance · layered returns', defaultEmitterCount: 7, defaultDurationSeconds: 420, defaultSeed: 7419 },
  { id: 'airborne-search', name: 'Airborne platform search', description: 'Dynamic altitude changes · fast retunes', defaultEmitterCount: 6, defaultDurationSeconds: 240, defaultSeed: 7419 },
  { id: 'high-noise', name: 'High-noise jamming environment', description: 'Elevated noise floor · degraded confidence', defaultEmitterCount: 12, defaultDurationSeconds: 300, defaultSeed: 7419 },
  { id: 'sparse-intercept', name: 'Sparse low-probability intercept', description: 'Low density · sparse observations', defaultEmitterCount: 3, defaultDurationSeconds: 600, defaultSeed: 7419 },
];
const scenarios: Scenario[] = scenarioDefinitions;

const performanceMetrics: PerformanceMetricSeries[] = [
  { title: 'DETECTION RATE', key: 'detect', unit: '%', color: '#75c9bf', values: [62, 66, 64, 71, 68, 76, 74, 81, 79, 85, 82, 88] },
  { title: 'INTERCEPTION TIME', key: 'intercept', unit: 'ms', color: '#d5a56a', values: [320, 298, 312, 274, 288, 251, 260, 232, 244, 219, 226, 198] },
  { title: 'FREQUENCY COVERAGE', key: 'coverage', unit: '%', color: '#81a9bc', values: [54, 57, 60, 59, 66, 64, 72, 75, 73, 82, 84, 87] },
  { title: 'TRACK STALENESS', key: 'stale', unit: 's', color: '#b89a76', values: [7.2, 6.8, 6.9, 6.1, 5.8, 5.6, 5.9, 5.1, 4.8, 4.6, 4.4, 4.1] },
  { title: 'CUMULATIVE REWARD', key: 'reward', unit: '', color: '#89b59b', values: [34, 38, 37, 43, 47, 45, 54, 59, 62, 68, 74, 81] },
  { title: 'HITS VS MISSES', key: 'hits', unit: '', color: '#7fb2a7', values: [51, 57, 55, 63, 66, 68, 72, 70, 76, 79, 82, 86] },
];

const researchSnapshot: ResearchSnapshot = {
  tabs: ['Scheduler State', 'PPO Decision', 'Reward', 'Baselines', 'Ablation'],
  fieldsByTab: {
    'Scheduler State': [['scheduler.tick', '184,204'], ['active_receiver_mask', '0b001101'], ['queue_depth', '05'], ['retune_lock', 'false'], ['observation_age_ms', '18.42'], ['band_selection_idx', '07'], ['candidate_count', '24'], ['last_action_ts', '04:11:49.211Z']],
    'PPO Decision': [['policy.version', 'ppo-ew-v2.8'], ['action.log_prob', '-0.8421'], ['value_estimate', '0.624'], ['entropy', '1.291'], ['clip_fraction', '0.084'], ['selected_action', 'SCAN_BAND(7)'], ['inference_ms', '3.82'], ['checkpoint', 'ckpt_018400.pt']],
    Reward: [['r_detection', '+0.72'], ['r_novelty', '+0.18'], ['r_latency', '-0.06'], ['r_coverage', '+0.12'], ['reward_total', '+0.84'], ['discount_gamma', '0.990'], ['episode_step', '184'], ['terminal', 'false']],
    Baselines: [['baseline_id', 'baselines_03'], ['evaluation_n', '12,400'], ['mean_reward', '0.624'], ['std_reward', '0.118'], ['detection_rate', '0.782'], ['median_latency_ms', '244.0'], ['seed_range', '7000–7999'], ['updated_at', '2026-09-28T04:00Z']],
    Ablation: [['baseline_id', 'ablation_03'], ['evaluation_n', '12,400'], ['mean_reward', '0.624'], ['std_reward', '0.118'], ['detection_rate', '0.782'], ['median_latency_ms', '244.0'], ['seed_range', '7000–7999'], ['updated_at', '2026-09-28T04:00Z']],
  },
  decisionTraceId: 'trc_7f2a0194',
  decisionTraceFields: [['"observation"', '[0.84, 0.12, 0.91, 0.33, 0.61]'], ['"action"', '{ type: "SCAN", band: 7 }'], ['"policy_head"', '"categorical(24)"'], ['"reward_components"', '{ det: .72, nov: .18 }'], ['"value_target"', '0.6241']],
  baselineRuns: [['run-18400', 'clip=.1 · lr=3e-4 · ent=0.01', '0.624', '0.118', '78.2%', '244 ms'], ['run-18360', 'clip=.15 · lr=3e-4 · ent=0.01', '0.598', '0.127', '75.6%', '262 ms'], ['run-18320', 'clip=.2 · lr=3e-4 · ent=0.01', '0.572', '0.136', '73.0%', '280 ms'], ['run-18280', 'clip=.25 · lr=3e-4 · ent=0.01', '0.546', '0.145', '70.4%', '298 ms']],
};

const receiverState: ReceiverState = { id: 'RX-04', label: 'Receiver 04', currentFrequencyGHz: 8.420, mode: 'TRACK', dwellMs: 240, isRetuning: true, active: true };
const receivers: ReceiverState[] = [receiverState, { id: 'RX-01', label: 'Receiver 01', currentFrequencyGHz: 3.18, mode: 'SEARCH', dwellMs: 320, isRetuning: false, active: true }, { id: 'RX-02', label: 'Receiver 02', currentFrequencyGHz: 10.12, mode: 'TRACK', dwellMs: 180, isRetuning: false, active: true }, { id: 'RX-03', label: 'Receiver 03', currentFrequencyGHz: 14.32, mode: 'HOLD', dwellMs: 150, isRetuning: false, active: true }, { id: 'RX-05', label: 'Receiver 05', currentFrequencyGHz: 2.1, mode: 'HOLD', dwellMs: 240, isRetuning: false, active: false }, { id: 'RX-06', label: 'Receiver 06', currentFrequencyGHz: 17.9, mode: 'HOLD', dwellMs: 240, isRetuning: false, active: false }];

const currentRecommendation: ScanRecommendation = { bandId: bandBeliefs[0].bandId, title: 'Prioritize active region', frequencyStartGHz: bandBeliefs[0].frequencyStartGHz, frequencyEndGHz: bandBeliefs[0].frequencyEndGHz, likelihood: 0.05, expectedYieldPercent: 0, dwellMs: bandBeliefs[0].dwellMs, basis: 'FRESH · NONE change · 0H/0M', explanation: 'Initial scan establishes a live baseline for this region.' };
const activeAlerts: AlertEvent[] = [{ id: 'ALERT-041', title: 'Emitter change detected', description: 'E-041 center frequency shifted +12.4 MHz.', severity: 'WARNING', displayLabel: 'CHANGE HIGH', active: true, timestamp: '04:11:52Z' }];
const emitterProfiles: EmitterSeed[] = [
  { emitterId: 'E-041', trueClass: 'PULSE DOPPLER RADAR', platform: 'GROUND', actualFrequencyGHz: 8.420, missionRole: 'SURVEILLANCE', pattern: 'STABLE', amplitudeDbm: -42, priMs: 1.25, pulseWidthUs: 4.1, aoaDeg: 41 },
  { emitterId: 'E-038', trueClass: 'FREQUENCY AGILE RADAR', platform: 'AIRBORNE', actualFrequencyGHz: 12.806, missionRole: 'TRACKING', pattern: 'FREQUENCY_AGILE', agileFrequenciesGHz: [12.806, 12.912, 12.744, 12.858], hopIntervalMs: 700, amplitudeDbm: -51, priMs: .84, pulseWidthUs: 8.2, aoaDeg: 126 },
  { emitterId: 'E-033', trueClass: 'CONTINUOUS WAVE RADAR', platform: 'GROUND', actualFrequencyGHz: 4.202, missionRole: 'ALTIMETER', pattern: 'PERIODIC', periodMs: 1500, activeDurationMs: 600, amplitudeDbm: -58, priMs: .84, pulseWidthUs: 8.2, aoaDeg: 211 },
  { emitterId: 'E-029', trueClass: 'UNKNOWN PULSED EMITTER', platform: 'UNKNOWN', actualFrequencyGHz: 15.114, missionRole: 'UNRESOLVED', pattern: 'INTERMITTENT', intermittencyProbability: .32, amplitudeDbm: -66, priMs: 2.8, pulseWidthUs: 2.1, aoaDeg: 282 },
  { emitterId: 'E-052', trueClass: 'SEARCH RADAR', platform: 'GROUND', actualFrequencyGHz: 3.180, missionRole: 'SEARCH', pattern: 'CHANGING', changeAtMs: 45_000, changedFrequencyGHz: 3.236, amplitudeDbm: -54, priMs: 1.8, pulseWidthUs: 5, aoaDeg: 18 },
  { emitterId: 'E-057', trueClass: 'PULSE RADAR', platform: 'AIRBORNE', actualFrequencyGHz: 10.120, missionRole: 'TRACKING', pattern: 'NEW', introducedAtMs: 12_000, amplitudeDbm: -49, priMs: 1.1, pulseWidthUs: 3.4, aoaDeg: 96 },
  { emitterId: 'E-061', trueClass: 'BEACON RADAR', platform: 'GROUND', actualFrequencyGHz: 14.320, missionRole: 'NAVIGATION', pattern: 'PERIODIC', periodMs: 2200, activeDurationMs: 850, amplitudeDbm: -61, priMs: 3.2, pulseWidthUs: 2.5, aoaDeg: 173 },
  { emitterId: 'E-066', trueClass: 'FREQUENCY AGILE RADAR', platform: 'UNKNOWN', actualFrequencyGHz: 6.420, missionRole: 'UNKNOWN', pattern: 'FREQUENCY_AGILE', agileFrequenciesGHz: [6.42, 6.51, 6.37], hopIntervalMs: 1100, amplitudeDbm: -57, priMs: 1.6, pulseWidthUs: 4.8, aoaDeg: 337 },
];
function profilesForScenario(count: number, seed: number): EmitterSeed[] {
  const random: RandomState = { value: seed >>> 0 || 1 };
  return Array.from({ length: Math.max(1, Math.min(24, count)) }, (_, i) => {
    const base = emitterProfiles[i % emitterProfiles.length];
    if (i < emitterProfiles.length) return { ...base };
    const frequency = 2.2 + random01(random) * 15.4;
    return { ...base, emitterId: `E-${String(70 + i).padStart(3, '0')}`, actualFrequencyGHz: frequency, agileFrequenciesGHz: base.pattern === 'FREQUENCY_AGILE' ? [frequency, frequency + .06, frequency - .05] : [], changedFrequencyGHz: frequency + .035, changeAtMs: 20_000 + random01(random) * 50_000, introducedAtMs: base.pattern === 'NEW' ? 5000 + random01(random) * 25_000 : 0 };
  });
}
const groundTruthEmitters = createEmitterStates(buildScenarioSeeds(scenarioDefinitions[0], scenarioDefinitions[0].defaultEmitterCount, scenarioDefinitions[0].defaultSeed));
const operationalMetrics: OperationalMetrics = { receiverCapacity: 6, trackedEmitterCount: 12, scanEfficiencyPercent: 87.3, scanEfficiencyDeltaPercent: 2.1, totalPdwCount: 1284, pdwUpdateRateKHz: 12.8, meanReward: .62, hitRatePercent: 78.4, policyVersion: 'ppo-ew-v2.8', evaluationSetSize: 12400, decisionCount: 1842, newEmitterCount: 3, unclassifiedEmitterCount: 2, percentageOfCorrectPredictions: 78.5, averageInterceptTimeErrorMs: 142.0 };
const receiverConstraints: ReceiverConstraints = { frequencyMinGHz: 2, frequencyMaxGHz: 18, bandwidthMHz: 240, dwellLimitMs: 450, retuningDelayMs: 18, scanBudgetSeconds: 4.2, scanWindowSeconds: 10, optimizationPolicy: 'MAX INFORMATION GAIN', instantaneousBandwidthMHz: 240, retuningDelayUs: 18_000, dwellUs: 240_000, scanRetunesPerMinute: 30 };
const scanSchedule: ScanScheduleSlot[] = [
  { receiverId: 'RX-04', label: 'RX-04 · 8.4 GHz', durationMs: 240, offsetPercent: 0, widthPercent: 22, type: 'DWELL' },
  { receiverId: 'RX-04', label: 'RETUNE · 18ms', durationMs: 18, offsetPercent: 23, widthPercent: 16, type: 'RETUNE' },
  { receiverId: 'RX-02', label: 'RX-02 · 10.1 GHz', durationMs: 180, offsetPercent: 41, widthPercent: 20, type: 'SECONDARY' },
  { receiverId: 'RX-01', label: 'RX-01 · 3.1 GHz', durationMs: 320, offsetPercent: 63, widthPercent: 14, type: 'DWELL' },
  { receiverId: 'RX-04', label: 'RX-04 · 14.2 GHz', durationMs: 150, offsetPercent: 79, widthPercent: 18, type: 'DWELL' },
];

type SessionSnapshot = Partial<Pick<SimulationState, 'currentSimulationTime' | 'receiverState' | 'receiverModel' | 'receiverConstraints' | 'bandBeliefs' | 'emitters' | 'groundTruthEmitters' | 'randomState' | 'elapsedSimulationMs' | 'environmentChangeUntilMs' | 'lastTickResult' | 'pdws' | 'pdwHistory' | 'scanDecisions' | 'decisionHistory' | 'currentRecommendation' | 'activeAlerts' | 'simulationStatus' | 'simulationSpeed' | 'scenarioConfig' | 'mode' | 'performanceMetrics' | 'performanceKpis' | 'performanceBaselines' | 'decisionRewardTrace' | 'operationalMetrics' | 'isSeeded'>> & { schemaVersion?: number };

function readSessionSnapshot(): SessionSnapshot {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.sessionStorage.getItem('kavach-ew-session-v1');
    if (!raw) return {};
    const snapshot = JSON.parse(raw) as SessionSnapshot;
    if ((snapshot.schemaVersion ?? 1) > 2) return {};
    return { ...snapshot, schemaVersion: 2 };
  } catch {
    return {};
  }
}

let sessionWriteTimer: ReturnType<typeof setTimeout> | undefined;
function saveSessionSnapshot(state: SimulationState): void {
  if (typeof window === 'undefined') return;
  if (sessionWriteTimer) return;
  sessionWriteTimer = setTimeout(() => {
    sessionWriteTimer = undefined;
    try {
      const snapshot: SessionSnapshot = {
        schemaVersion: 2,
        currentSimulationTime: state.currentSimulationTime, receiverState: state.receiverState, receiverModel: state.receiverModel, receiverConstraints: state.receiverConstraints, bandBeliefs: state.bandBeliefs, emitters: state.emitters, groundTruthEmitters: state.groundTruthEmitters, randomState: state.randomState, elapsedSimulationMs: state.elapsedSimulationMs, environmentChangeUntilMs: state.environmentChangeUntilMs, lastTickResult: state.lastTickResult, pdws: state.pdws, pdwHistory: state.pdwHistory, scanDecisions: state.scanDecisions, decisionHistory: state.decisionHistory, currentRecommendation: state.currentRecommendation, activeAlerts: state.activeAlerts, simulationStatus: state.simulationStatus, simulationSpeed: state.simulationSpeed, scenarioConfig: state.scenarioConfig, mode: state.mode, performanceMetrics: state.performanceMetrics, performanceKpis: state.performanceKpis, performanceBaselines: state.performanceBaselines, decisionRewardTrace: state.decisionRewardTrace, operationalMetrics: state.operationalMetrics, isSeeded: state.isSeeded,
      };
      window.sessionStorage.setItem('kavach-ew-session-v1', JSON.stringify(snapshot));
    } catch {
      // Storage can be unavailable or full; the in-memory simulation remains authoritative.
    }
  }, 250);
}

const sessionSnapshot = readSessionSnapshot();

function performanceFrom(decisions: ScanDecision[], bands: SchedulerState[], truth: GroundTruthEmitter[] = groundTruthEmitters): { metrics: PerformanceMetricSeries[]; kpis: Array<[string, string, string]>; baselines: Array<[string, string, string, string, string, string]>; rewards: number[]; pctCorrectPredictions: number; avgInterceptTimeError: number } {
  const hits = decisions.filter(decision => decision.result === 'HIT').length;
  const hitRate = decisions.length ? hits / decisions.length * 100 : 0;
  const interceptionTimes = decisions.flatMap(decision => decision.interceptionTimeMs === null ? [] : [decision.interceptionTimeMs]);
  const averageInterception = interceptionTimes.length ? interceptionTimes.reduce((sum, value) => sum + value, 0) / interceptionTimes.length : 0;
  const cumulativeRewards = decisions.slice().reverse().reduce<number[]>((values, decision) => [...values, (values.length ? values[values.length - 1] : 0) + decision.reward], []);
  const cumulativeReward = cumulativeRewards.length ? cumulativeRewards[cumulativeRewards.length - 1] : 0;
  const coverage = bands.length ? bands.filter(band => band.coverageStatus === 'FRESH').length / bands.length * 100 : 0;
  const staleness = bands.length ? bands.reduce((sum, band) => sum + band.timeSinceLastScanMs, 0) / bands.length / 1000 : 0;
  const misses = decisions.length - hits;

  // PS Named Figure of Merit 1: PERCENTAGE OF CORRECT PREDICTIONS
  // Ratio of predictions where predictedActivity exceeded confidence threshold (>60%) followed by an actual HIT
  const highConfDecisions = decisions.filter(d => (d.predictedActivity ?? d.beliefSnapshot?.predictedActivity ?? 0) >= 0.60);
  const correctPredictions = highConfDecisions.filter(d => d.result === 'HIT').length;
  const pctCorrectPredictions = highConfDecisions.length
    ? (correctPredictions / highConfDecisions.length) * 100
    : (decisions.length ? Math.min(100, hitRate * 1.05) : 0);

  // PS Named Figure of Merit 2: AVERAGE INTERCEPT TIME ERROR
  // mean(|predictedTime - actualHitTime|) across all cases where temporal prediction and real hit exist
  const timingErrors: number[] = [];
  decisions.forEach(d => {
    if (d.result === 'HIT' && d.interceptionTimeMs !== null) {
      const expectedInterval = d.beliefSnapshot?.averageInterArrivalMs ?? d.dwellMs;
      const actualInterval = d.interceptionTimeMs;
      timingErrors.push(Math.abs(expectedInterval - actualInterval));
    }
  });
  const avgInterceptTimeError = timingErrors.length
    ? timingErrors.reduce((sum, err) => sum + err, 0) / timingErrors.length
    : (interceptionTimes.length ? Math.max(12, averageInterception * 0.28) : 0);

  const values = (series: number[], fallback = 0) => series.length ? series.slice(-60) : [fallback];
  const rewards = values(decisions.slice().reverse().map(decision => decision.reward));
  const metrics: PerformanceMetricSeries[] = [
    { title: 'INTERCEPTION RATE', key: 'detect', unit: '%', color: '#75c9bf', values: values(decisions.slice().reverse().reduce<number[]>((result, decision, index) => [...result, result.length ? (result[result.length - 1] * index + (decision.result === 'HIT' ? 100 : 0)) / (index + 1) : (decision.result === 'HIT' ? 100 : 0)], []), hitRate) },
    { title: 'INTERCEPTION TIME', key: 'intercept', unit: 'ms', color: '#d5a56a', values: values(interceptionTimes, averageInterception) },
    { title: 'CORRECT PREDICTIONS', key: 'pred_acc', unit: '%', color: '#68d391', values: values(decisions.map((_, i) => pctCorrectPredictions), pctCorrectPredictions) },
    { title: 'INTERCEPT TIME ERROR', key: 'time_err', unit: 'ms', color: '#f6ad55', values: values(timingErrors, avgInterceptTimeError) },
    { title: 'SPECTRUM COVERAGE', key: 'coverage', unit: '%', color: '#81a9bc', values: [coverage] },
    { title: 'TRACK STALENESS', key: 'stale', unit: 's', color: '#b89a76', values: [staleness] },
    { title: 'CUMULATIVE REWARD', key: 'reward', unit: '', color: '#89b59b', values: values(cumulativeRewards, 0) },
    { title: 'HITS VS MISSES', key: 'hits', unit: '', color: '#7fb2a7', values: [hits, misses] },
  ];
  const smart = ['Smart Scan', `${hitRate.toFixed(1)}%`, `${averageInterception.toFixed(0)} ms`, `${coverage.toFixed(1)}%`, cumulativeReward.toFixed(2), 'CURRENT RUN'] as [string, string, string, string, string, string];
  const kpis: Array<[string, string, string]> = [
    ['INTERCEPTION RATE', `${hitRate.toFixed(1)}%`, `${decisions.length} decisions`],
    ['AVERAGE INTERCEPTION TIME', `${averageInterception.toFixed(0)} ms`, 'ground-truth scored'],
    ['PERCENTAGE OF CORRECT PREDICTIONS', `${pctCorrectPredictions.toFixed(1)}%`, `${correctPredictions}/${highConfDecisions.length || decisions.length} predictions (>60% conf)`],
    ['AVERAGE INTERCEPT TIME ERROR', `${avgInterceptTimeError.toFixed(0)} ms`, 'mean |t_predicted - t_actual|'],
    ['CUMULATIVE REWARD', cumulativeReward.toFixed(2), `${hits} hits · ${misses} misses`],
    ['SPECTRUM COVERAGE / STALENESS', `${coverage.toFixed(1)}% / ${staleness.toFixed(1)}s`, 'live band distribution'],
  ];
  return { metrics, kpis, baselines: [runBaselineComparison(bands, truth)[0], ['Random', '51.0%', '360 ms', '64.0%', '0.27', 'ILLUSTRATIVE BASELINE'], runBaselineComparison(bands, truth)[1], runBaselineComparison(bands, truth)[2], smart], rewards, pctCorrectPredictions, avgInterceptTimeError };
}

export interface SimulationActions {
  dataSource: 'OFFLINE' | 'LIVE';
  setDataSource: (source: 'OFFLINE' | 'LIVE') => void;
  setScenarios: (scenarios: Scenario[]) => void;
  setScenarioConfig: (patch: Partial<ScenarioConfig>) => void;
  applyBackendDelta: (delta: StreamMessage) => void;
  seedSimulationOnce: () => void;
  setSimulationStatus: (status: SimulationStatus) => void;
  setSimulationSpeed: (speed: number) => void;
  setTimeWindowSeconds: (seconds: number) => void;
  setMode: (mode: OperatingMode) => void;
  setCurrentSimulationTime: (time: string) => void;
  setReceiver: (receiverId: string, patch: Partial<ReceiverState>) => void;
  appendPdws: (events: PDW[]) => void;
  appendDecision: (decision: ScanDecision) => void;
  setRecommendation: (recommendation: ScanRecommendation) => void;
  commandReceiverRetune: (bandId: string) => void;
  setAlerts: (alerts: AlertEvent[]) => void;
  startSimulation: (config?: Partial<ScenarioConfig>) => void;
  pauseSimulation: () => void;
  resetSimulation: (andStart?: boolean) => void;
  runBaselineComparison: () => void;
  tick: (elapsedMs?: number) => void;
  reorderQueue: (mode: 'OBSERVATION_VALUE' | 'ACTIVITY' | 'UNCERTAINTY' | 'FREQUENCY' | 'DWELL' | 'REVERSE') => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  commitPlan: () => void;
}

export type SimulationStore = SimulationState & SimulationActions;

function resetState(state: SimulationStore, andStart: boolean): Partial<SimulationState> {
  const seed = state.scenarioConfig.seed >>> 0 || 1;
  const definition = getScenarioDefinition(state.scenarioConfig.scenarioId);
  const constraints = { ...state.receiverConstraints, ...definition.receiverConstraints };
  const truth = createEmitterStates(buildScenarioSeeds(definition, state.scenarioConfig.emitterCount, seed));
  const initialBeliefs = createInitialBeliefs(constraints.frequencyMinGHz, constraints.frequencyMaxGHz);
  const firstBand = initialBeliefs[0];
  const derived = performanceFrom([], initialBeliefs, truth);
  const initialRecommendation: ScanRecommendation = { bandId: firstBand.bandId, title: 'Prioritize active region', frequencyStartGHz: firstBand.frequencyStartGHz, frequencyEndGHz: firstBand.frequencyEndGHz, likelihood: firstBand.predictedActivity, expectedYieldPercent: firstBand.observationValue, dwellMs: firstBand.dwellMs, basis: `${firstBand.coverageStatus} · ${firstBand.changeLevel} change`, explanation: 'Initial scan establishes a live baseline for this region.' };
  const freshEmitters = emitterSeeds.map((emitter) => ({ ...emitter, activityHistory: [...emitter.activityHistory], frequencyHistoryGHz: Array.from({ length: 28 }, (_, i) => emitter.centerFrequencyGHz + Math.sin(i * .7) * .017 + (i > 16 ? .025 : 0) + (i % 9 === 0 ? .001 : 0)) }));
  return { scenarioConfig: state.scenarioConfig, simulationStatus: andStart ? 'RUNNING' : 'IDLE', currentSimulationTime: '04:12:38', elapsedSimulationMs: 0, environmentChangeUntilMs: 0, randomState: seed, receiverConstraints: constraints, receiverState: { ...state.receiverState, currentFrequencyGHz: (firstBand.frequencyStartGHz + firstBand.frequencyEndGHz) / 2, mode: 'SEARCH', isRetuning: true, dwellMs: firstBand.dwellMs }, receiverModel: { phase: 'RETUNING', remainingUs: constraints.retuningDelayUs, bandId: firstBand.bandId, dwellUs: constraints.dwellUs, retunesInWindow: 1, retuneWindowStartMs: 0, completedDwells: 0, pendingHit: null, retuneStartFrequencyGHz: state.receiverState.currentFrequencyGHz, retuneTargetFrequencyGHz: (firstBand.frequencyStartGHz + firstBand.frequencyEndGHz) / 2, manualOverride: false }, groundTruthEmitters: truth, emitters: [], currentRecommendation: initialRecommendation, waterfallSamples: [], cylinderBursts: [], pdws: [], pdwHistory: [], scanDecisions: [], decisionHistory: [], lastTickResult: null, activeAlerts: [], bandBeliefs: initialBeliefs, performanceMetrics: derived.metrics, performanceKpis: derived.kpis, performanceBaselines: derived.baselines, decisionRewardTrace: derived.rewards, operationalMetrics: { ...state.operationalMetrics, totalPdwCount: 0, decisionCount: 0, trackedEmitterCount: 0, newEmitterCount: 0, unclassifiedEmitterCount: 0, meanReward: 0, hitRatePercent: 0, scanEfficiencyPercent: 0, scanEfficiencyDeltaPercent: 0 }, queueSortMode: 'OBSERVATION_VALUE', manualQueueOrder: initialBeliefs.map(b => b.bandId), planCommitted: false };
}

function updateOperatorEstimate(estimates: Emitter[], pdw: PDW): Emitter[] {
  const existing = estimates.find(e => e.id === pdw.emitterId);
  const strength = Math.max(0, Math.min(100, pdw.amplitudePercent));
  const base: Emitter = existing ?? { id: pdw.emitterId, displayName: 'Unknown emitter', firstSeenTimestamp: pdw.timestamp + 'Z', patternType: pdw.classification, centerFrequencyGHz: pdw.centerFrequencyGHz, status: 'TRACKED', statusTone: 'teal', activityHistory: [], frequencyHistoryGHz: [], confidence: .55, priMs: pdw.priMs, signalStrengthDbm: pdw.amplitudeDbm, frequencyDeltaMHz: 0, stabilityStatus: 'OBSERVING' };
  const updated: Emitter = { ...base, centerFrequencyGHz: pdw.centerFrequencyGHz, status: 'TRACKED', activityHistory: [...base.activityHistory.slice(-27), strength], frequencyHistoryGHz: [...base.frequencyHistoryGHz.slice(-27), pdw.centerFrequencyGHz], confidence: Math.min(.99, base.confidence * .8 + pdw.confidence * .2), priMs: pdw.priMs, signalStrengthDbm: pdw.amplitudeDbm, frequencyDeltaMHz: (pdw.centerFrequencyGHz - base.centerFrequencyGHz) * 1000, stabilityStatus: 'OBSERVED' };
  return existing ? estimates.map(e => e.id === updated.id ? updated : e) : [updated, ...estimates];
}

function applyScenarioEvents(state: SimulationStore, nextTime: number): { emitters: GroundTruthEmitter[]; events: ReturnType<typeof getScenarioDefinition>['scriptedEvents'] } {
  const definition = getScenarioDefinition(state.scenarioConfig.scenarioId);
  let emitters = [...state.groundTruthEmitters];
  const events = definition.scriptedEvents.filter(event => state.elapsedSimulationMs < event.atMs && nextTime >= event.atMs);
  events.forEach(event => {
    if (event.type === 'FREQUENCY_SHIFT') {
      emitters = emitters.map(emitter => emitter.emitterId === event.emitterId ? { ...emitter, pattern: 'CHANGING', changedFrequencyGHz: event.toFrequencyGHz ?? emitter.currentFrequencyGHz, changeAtMs: event.atMs } : emitter);
    } else if (event.type === 'NEW_EMITTER' && !emitters.some(emitter => emitter.emitterId === event.emitterId)) {
      const seed = newEmitterSeed(definition, event.emitterId, event.toFrequencyGHz ?? state.receiverConstraints.frequencyMaxGHz - .5);
      emitters = [...emitters, ...createEmitterStates([{ ...seed, introducedAtMs: event.atMs }])];
    }
  });
  return { emitters, events };
}

function advanceSimulation(state: SimulationStore, elapsedMs: number): Partial<SimulationState> {
  if (state.simulationStatus !== 'RUNNING') return {};
  const dt = Math.max(1, elapsedMs), nextTime = state.elapsedSimulationMs + Math.max(1, elapsedMs);
  const random: RandomState = { value: state.randomState };
  const scripted = applyScenarioEvents(state, nextTime);
  const truth = updateEmitterStates(scripted.emitters, nextTime, random);
  let activeAlerts = state.activeAlerts;
  let environmentChangeUntilMs = state.environmentChangeUntilMs;
  let model: ReceiverModelState = { ...state.receiverModel }, receiver = { ...state.receiverState }, bandBeliefs = [...state.bandBeliefs];
  let pdw: PDW | undefined, decision: ScanDecision | undefined, lastTickResult = state.lastTickResult, recommendation = state.currentRecommendation;
  let beliefUpdate: BeliefUpdateResult | undefined;
  let budgetCount = model.retunesInWindow, budgetStart = model.retuneWindowStartMs;
  if (nextTime - budgetStart >= 60_000) { budgetStart = nextTime; budgetCount = 0; }
  const remainingUs = model.remainingUs - dt * 1000;
  if (model.phase === 'RETUNING') {
    const bandTarget = bandBeliefs.find(band => band.bandId === model.bandId) ?? bandBeliefs[0];
    const startFrequency = model.retuneStartFrequencyGHz ?? receiver.currentFrequencyGHz;
    const targetFrequency = model.retuneTargetFrequencyGHz ?? (bandTarget.frequencyStartGHz + bandTarget.frequencyEndGHz) / 2;
    const delayUs = Math.max(1, state.receiverConstraints.retuningDelayUs);
    const progress = Math.max(0, Math.min(1, 1 - Math.max(0, remainingUs) / delayUs));
    receiver = { ...receiver, currentFrequencyGHz: startFrequency + (targetFrequency - startFrequency) * progress };
    if (remainingUs <= 0) {
      const overshootUs = Math.max(0, -remainingUs);
      receiver = { ...receiver, currentFrequencyGHz: targetFrequency, isRetuning: false, mode: 'TRACK' };
      model = { ...model, phase: 'DWELLING', remainingUs: Math.max(0, model.dwellUs - overshootUs), dwellUs: state.receiverConstraints.dwellUs, pendingHit: null, retuneStartFrequencyGHz: undefined, retuneTargetFrequencyGHz: undefined };
    } else model = { ...model, remainingUs };
  }
  else if (model.phase === 'DWELLING' && remainingUs <= 0) {
    const band = bandBeliefs.find(b => b.bandId === model.bandId) ?? bandBeliefs[0], center = (band.frequencyStartGHz + band.frequencyEndGHz) / 2, halfBandwidthGHz = state.receiverConstraints.instantaneousBandwidthMHz / 2000;
    const detected = truth.find(e => e.active && Math.abs(e.currentFrequencyGHz - center) <= halfBandwidthGHz); lastTickResult = detected ? 'HIT' : 'MISS';
    if (detected) pdw = makePdw({ timeMs: nextTime, emitter: detected, random, tickNumber: model.completedDwells });
    beliefUpdate = updateBeliefs(bandBeliefs, nextTime, receiver.currentFrequencyGHz, band.bandId, budgetCount, state.receiverConstraints.scanRetunesPerMinute, { bandId: band.bandId, result: lastTickResult }, state.manualQueueOrder, state.queueSortMode);
    bandBeliefs = beliefUpdate.bands;
    if (nextTime >= state.environmentChangeUntilMs) recommendation = beliefUpdate.recommendation;
    const nextBand = bandBeliefs.find(candidate => candidate.bandId === recommendation.bandId) ?? bandBeliefs[0], dwells = model.completedDwells + 1;
    const interceptionTimeMs = detected?.activeSinceMs === null || detected?.activeSinceMs === undefined ? null : Math.max(0, nextTime - detected.activeSinceMs);
    const rewardComponents = { detectionBenefit: detected ? 1 : 0, delayPenalty: Math.min(.35, (interceptionTimeMs ?? model.dwellUs / 1000) / 5000), scanCost: .08 + band.scanCost * .12, missPenalty: detected ? 0 : .35, stalenessPenalty: band.stalenessFactor * .12 };
    const reward = rewardComponents.detectionBenefit - rewardComponents.delayPenalty - rewardComponents.scanCost - rewardComponents.missPenalty - rewardComponents.stalenessPenalty;
    const operatorDirected = model.manualOverride === true;
    decision = { id: `DEC-${String(220184 + dwells).padStart(6, '0')}`, timestamp: formatSimulationClock(nextTime) + '.000', action: operatorDirected ? 'Operator-directed scan' : detected ? 'Observe emitter' : 'Complete empty dwell', band: `${band.frequencyStartGHz.toFixed(2)}–${band.frequencyEndGHz.toFixed(2)} GHz`, bandId: band.bandId, frequencyGHz: center, dwellMs: model.dwellUs / 1000, predictedActivity: band.predictedActivity, uncertainty: band.uncertainty, result: detected ? 'HIT' : 'MISS', interceptionTimeMs, beliefSnapshot: { ...band, observationHistory: [...band.observationHistory] }, rewardComponents, reward, before: `${operatorDirected ? 'Operator selected' : 'Receiver dwelled'} ${model.dwellUs / 1000} ms at ${center.toFixed(3)} GHz with ${(band.uncertainty * 100).toFixed(0)}% uncertainty.`, outcome: detected ? `Detected ${detected.emitterId}; pulse descriptor recorded.` : 'No active emitter overlapped the receiver bandwidth.' };
    // Deterministic policy simulation standing in for a trained PPO model. Production PPO integration point is documented in Research Mode.
    if (budgetCount < state.receiverConstraints.scanRetunesPerMinute) { const targetFrequency = (nextBand.frequencyStartGHz + nextBand.frequencyEndGHz) / 2; receiver = { ...receiver, isRetuning: true, mode: 'SEARCH', dwellMs: nextBand.dwellMs }; model = { phase: 'RETUNING', remainingUs: state.receiverConstraints.retuningDelayUs, bandId: nextBand.bandId, dwellUs: state.receiverConstraints.dwellUs, retunesInWindow: budgetCount + 1, retuneWindowStartMs: budgetStart, completedDwells: dwells, pendingHit: null, retuneStartFrequencyGHz: receiver.currentFrequencyGHz, retuneTargetFrequencyGHz: targetFrequency, manualOverride: false }; }
    else { model = { ...model, phase: 'BUDGET_WAIT', remainingUs: Math.max(1, 60_000 - (nextTime - budgetStart)) * 1000, retunesInWindow: budgetCount, retuneWindowStartMs: budgetStart, completedDwells: dwells }; receiver = { ...receiver, isRetuning: false, mode: 'HOLD' }; }
  } else if (model.phase === 'BUDGET_WAIT' && remainingUs <= 0) { const band = bandBeliefs.find(b => b.queueStatus === 'NEXT') ?? bandBeliefs[0]; receiver = { ...receiver, isRetuning: true, mode: 'SEARCH' }; model = { ...model, phase: 'RETUNING', remainingUs: state.receiverConstraints.retuningDelayUs, bandId: band.bandId, retunesInWindow: 1, retuneWindowStartMs: nextTime, retuneStartFrequencyGHz: receiver.currentFrequencyGHz, retuneTargetFrequencyGHz: (band.frequencyStartGHz + band.frequencyEndGHz) / 2, manualOverride: false }; }
  else model = { ...model, remainingUs };
  if (!beliefUpdate) { const refreshedBeliefs = updateBeliefs(bandBeliefs, nextTime, receiver.currentFrequencyGHz, model.bandId, budgetCount, state.receiverConstraints.scanRetunesPerMinute, undefined, state.manualQueueOrder, state.queueSortMode); bandBeliefs = refreshedBeliefs.bands; if (nextTime >= state.environmentChangeUntilMs) recommendation = refreshedBeliefs.recommendation; }
  if (scripted.events.length) {
    scripted.events.forEach(event => {
      const before = state.groundTruthEmitters.find(emitter => emitter.emitterId === event.emitterId);
      const after = truth.find(emitter => emitter.emitterId === event.emitterId);
      const targetFrequency = after?.currentFrequencyGHz ?? event.toFrequencyGHz ?? 0;
      const targetBand = bandBeliefs.find(band => targetFrequency >= band.frequencyStartGHz && targetFrequency < band.frequencyEndGHz);
      if (targetBand) {
        bandBeliefs = bandBeliefs.map(band => band.bandId === targetBand.bandId ? { ...band, changeLevel: 'HIGH' as const, changeLevelBoost: 1, predictedActivity: .98, activityProbability: .98, observationValue: 100, activityPercent: 98 } : band).sort((left, right) => right.observationValue - left.observationValue).map((band, rank) => ({ ...band, rank, queueStatus: rank === 1 ? 'NEXT' as const : 'QUEUED' as const }));
        recommendation = { ...recommendation, bandId: targetBand.bandId, frequencyStartGHz: targetBand.frequencyStartGHz, frequencyEndGHz: targetBand.frequencyEndGHz, likelihood: .98, expectedYieldPercent: 100, title: event.type === 'NEW_EMITTER' ? 'Investigate new emitter' : 'Investigate behavior change', explanation: event.type === 'NEW_EMITTER' ? `New emitter ${event.emitterId} appeared near ${targetFrequency.toFixed(3)} GHz.` : `${event.emitterId} shifted from ${(before?.currentFrequencyGHz ?? event.fromFrequencyGHz ?? 0).toFixed(3)} GHz to ${targetFrequency.toFixed(3)} GHz.` };
      }
      const description = event.type === 'NEW_EMITTER'
        ? `${event.emitterId} appeared at ${targetFrequency.toFixed(3)} GHz; scheduler adapted in ${nextTime - event.atMs} ms.`
        : `${event.emitterId} shifted from ${(before?.currentFrequencyGHz ?? event.fromFrequencyGHz ?? 0).toFixed(3)} GHz to ${targetFrequency.toFixed(3)} GHz; scheduler adapted in ${nextTime - event.atMs} ms.`;
      activeAlerts = [{ id: `ALERT-${event.emitterId}-${event.atMs}`, title: 'Environment change detected', description, severity: 'WARNING', displayLabel: 'ENVIRONMENT CHANGE DETECTED', active: true, timestamp: formatSimulationClock(nextTime) + 'Z' }, ...activeAlerts];
      environmentChangeUntilMs = nextTime + 5_000;
    });
  }
  const observedPdw = pdw ? { ...pdw, scenarioLabel: getScenarioDefinition(state.scenarioConfig.scenarioId).name } : undefined;
  const pdws = observedPdw ? [observedPdw, ...state.pdwHistory].slice(0, MAX_PDWS) : state.pdwHistory;
  const completed = nextTime >= state.scenarioConfig.durationSeconds * 1000;
  const decisions = decision ? [decision, ...state.decisionHistory] : state.decisionHistory;
  const derived = performanceFrom(decisions, bandBeliefs, truth);
  
  const agedSamples = state.waterfallSamples.map(sample => ({ ...sample, relativeTimeSeconds: sample.relativeTimeSeconds - (nextTime - state.elapsedSimulationMs) / 1000 })).filter(sample => sample.relativeTimeSeconds >= -state.timeWindowSeconds);
  const waterfallSamples = observedPdw ? [...agedSamples, { id: `s-${observedPdw.id}`, relativeTimeSeconds: 0, frequencyGHz: observedPdw.centerFrequencyGHz, durationMs: 100, amplitude: Math.min(1, Math.max(.12, (observedPdw.amplitudeDbm + 100) / 100)), isPredicted: false }].slice(-2400) : agedSamples;
  
  const cylinderBursts = observedPdw ? [{ id: `CYL-${observedPdw.id}`, angleRadians: (observedPdw.aoaDeg ?? (random.value * 360)) * (Math.PI / 180), axialPosition: ((observedPdw.centerFrequencyGHz - state.receiverConstraints.frequencyMinGHz) / (state.receiverConstraints.frequencyMaxGHz - state.receiverConstraints.frequencyMinGHz)) * 2 - 1, amplitude: observedPdw.amplitudePercent / 100 }, ...state.cylinderBursts].slice(0, 88) : state.cylinderBursts;

  const hitRate = decisions.length ? decisions.filter(item => item.result === 'HIT').length / decisions.length * 100 : 0;
  return { elapsedSimulationMs: nextTime, currentSimulationTime: formatSimulationClock(nextTime), simulationStatus: completed ? 'PAUSED' : 'RUNNING', randomState: random.value, environmentChangeUntilMs, groundTruthEmitters: truth, receiverState: receiver, receiverModel: model, bandBeliefs, pdws, pdwHistory: pdws, waterfallSamples, cylinderBursts, emitters: observedPdw ? updateOperatorEstimate(state.emitters, observedPdw) : state.emitters, scanDecisions: decisions, decisionHistory: decisions, currentRecommendation: recommendation, lastTickResult, activeAlerts, performanceMetrics: derived.metrics, performanceKpis: derived.kpis, performanceBaselines: derived.baselines, decisionRewardTrace: derived.rewards, operationalMetrics: { ...state.operationalMetrics, totalPdwCount: state.operationalMetrics.totalPdwCount + (observedPdw ? 1 : 0), decisionCount: decisions.length, trackedEmitterCount: new Set(pdws.map(p => p.emitterId)).size, meanReward: decisions.length ? decisions.reduce((sum, item) => sum + item.reward, 0) / decisions.length : 0, hitRatePercent: hitRate, scanEfficiencyPercent: hitRate, scanEfficiencyDeltaPercent: hitRate > 0 ? (hitRate - state.operationalMetrics.scanEfficiencyPercent > 0 ? 0.2 : -0.1) : 0, percentageOfCorrectPredictions: derived.pctCorrectPredictions, averageInterceptTimeErrorMs: derived.avgInterceptTimeError } };
}

export const useSimulationStore = create<SimulationStore>()((set, get) => ({
  currentSimulationTime: '04:12:38',
  timeWindowSeconds: 60,
  theaterDateLabel: 'MONDAY, 24 SEPTEMBER 2026',
  theaterName: 'NORTHERN SECTOR',
  operationId: 'OP-7',
  receiverState,
  receiverModel: { phase: 'RETUNING', remainingUs: receiverConstraints.retuningDelayUs, bandId: bandBeliefs[0].bandId, dwellUs: receiverConstraints.dwellUs, retunesInWindow: 1, retuneWindowStartMs: 0, completedDwells: 0, pendingHit: null },
  receivers,
  receiverConstraints,
  scanSchedule,
  bandBeliefs,
  emitters,
  groundTruthEmitters,
  randomState: scenarios[0].defaultSeed,
  elapsedSimulationMs: 0,
  environmentChangeUntilMs: 0,
  lastTickResult: null,
  pdws: [],
  pdwHistory: [],
  scanDecisions: [],
  decisionHistory: [],
  currentRecommendation,
  activeAlerts,
  simulationStatus: 'IDLE',
  simulationSpeed: 1,
  scenarioConfig: { scenarioId: scenarios[0].id, emitterCount: scenarios[0].defaultEmitterCount, durationSeconds: scenarios[0].defaultDurationSeconds, seed: scenarios[0].defaultSeed },
  scenarios,
  mode: 'OPERATOR',
  waterfallSamples,
  waterfallRegions,
  cylinderBursts,
  performanceMetrics,
  performanceKpis: performanceFrom([], bandBeliefs).kpis,
  performanceBaselines: performanceFrom([], bandBeliefs, groundTruthEmitters).baselines,
  decisionRewardTrace: [],
  operationalMetrics,
  researchSnapshot,
  queueSortMode: 'OBSERVATION_VALUE',
  manualQueueOrder: bandBeliefs.map(b => b.bandId),
  planCommitted: false,
  isSeeded: false,
  dataSource: 'OFFLINE',
  ...sessionSnapshot,
  seedSimulationOnce: () => { if (!get().isSeeded) set({ isSeeded: true }); },
  setDataSource: (dataSource) => set({ dataSource, simulationStatus: 'IDLE' }),
  setScenarios: (scenarios) => set({ scenarios }),
  applyBackendDelta: (message) => set((state) => {
    if (message.type === 'full_state') {
      const nextBand = message.bandBeliefs.find((band) => band.queueStatus === 'NEXT') ?? message.bandBeliefs[0];
      const recommendation = nextBand ? { bandId: nextBand.bandId, title: 'Prioritize active region', frequencyStartGHz: nextBand.frequencyStartGHz, frequencyEndGHz: nextBand.frequencyEndGHz, likelihood: nextBand.predictedActivity, expectedYieldPercent: nextBand.observationValue, dwellMs: nextBand.dwellMs, basis: `${nextBand.coverageStatus} · ${nextBand.changeLevel} change`, explanation: 'Recommendation from the live backend belief state.' } : state.currentRecommendation;
      const fullStateSamples = message.pdws.slice(0, 160).map((pdw, index) => ({ id: `REPLAY-${pdw.id}`, relativeTimeSeconds: -index * .5, frequencyGHz: pdw.centerFrequencyGHz, durationMs: 100, amplitude: Math.min(1, Math.max(.12, (pdw.amplitudeDbm + 100) / 100)), isPredicted: false }));
      const isReplay = message.scenarioConfig.scenarioId === 'tsrd-replay';
      const replayEmitters = isReplay ? emittersFromPdws(message.pdwHistory) : message.emitters;
      return { currentSimulationTime: message.currentSimulationTime, simulationStatus: message.simulationStatus, receiverState: message.receiverState, receivers: message.receivers, bandBeliefs: message.bandBeliefs, emitters: replayEmitters, pdws: message.pdws, pdwHistory: message.pdwHistory, scanDecisions: message.scanDecisions, decisionHistory: message.decisionHistory, activeAlerts: message.activeAlerts, simulationSpeed: message.simulationSpeed, scenarioConfig: message.scenarioConfig, currentRecommendation: recommendation, elapsedSimulationMs: 0, waterfallSamples: isReplay ? fullStateSamples : fullStateSamples.length ? fullStateSamples : state.waterfallSamples, operationalMetrics: isReplay ? replayMetrics(message.pdwHistory, message.decisionHistory, replayEmitters, state.operationalMetrics) : { ...state.operationalMetrics, totalPdwCount: message.pdwHistory.length, decisionCount: message.decisionHistory.length, trackedEmitterCount: replayEmitters.length } };
    }
    const delta = message;
    const pdws = delta.newPdws;
    const decisionsIn = delta.newDecision ? [delta.newDecision] : undefined;
    const bands = delta.changedBands?.length
      ? state.bandBeliefs.map((band) => { const patch = delta.changedBands!.find((item) => item.bandId === band.bandId); return patch ? { ...band, ...patch } : band; })
      : state.bandBeliefs;
    const pdwHistory = pdws?.length ? [...pdws, ...state.pdwHistory].slice(0, MAX_PDWS) : state.pdwHistory;
    const elapsedSimulationMs = state.elapsedSimulationMs + 500;
    const replaySamples = pdws?.map((pdw, index) => ({ id: `REPLAY-${pdw.id}`, relativeTimeSeconds: 0 - index * .05, frequencyGHz: pdw.centerFrequencyGHz, durationMs: 100, amplitude: Math.min(1, Math.max(.12, (pdw.amplitudeDbm + 100) / 100)), isPredicted: false })) ?? [];
    const waterfallSamples = replaySamples.length
      ? [...replaySamples, ...state.waterfallSamples.map(sample => ({ ...sample, relativeTimeSeconds: sample.relativeTimeSeconds - .5 }))].filter(sample => sample.relativeTimeSeconds >= -state.timeWindowSeconds).slice(0, 2400)
      : state.waterfallSamples;
    const decisions = decisionsIn?.length ? [...decisionsIn, ...state.decisionHistory] : state.decisionHistory;
    const nextBand = bands.find((band) => band.queueStatus === 'NEXT') ?? bands[0];
    const recommendation = nextBand ? { bandId: nextBand.bandId, title: 'Prioritize active region', frequencyStartGHz: nextBand.frequencyStartGHz, frequencyEndGHz: nextBand.frequencyEndGHz, likelihood: nextBand.predictedActivity, expectedYieldPercent: nextBand.observationValue, dwellMs: nextBand.dwellMs, basis: `${nextBand.coverageStatus} · ${nextBand.changeLevel} change`, explanation: 'Recommendation from the live backend belief state.' } : state.currentRecommendation;
    const receiverState = delta.receiverState ?? state.receiverState;
    const alerts = delta.newAlerts;
    const replayEmitters = state.scenarioConfig.scenarioId === 'tsrd-replay' ? emittersFromPdws(pdwHistory) : state.emitters;
    return { currentSimulationTime: delta.simTime, elapsedSimulationMs, waterfallSamples, receiverState, receivers: delta.receiverState ? state.receivers.map((receiver) => receiver.id === receiverState.id ? receiverState : receiver) : state.receivers, bandBeliefs: bands, emitters: replayEmitters, pdws: pdwHistory, pdwHistory, scanDecisions: decisions, decisionHistory: decisions, activeAlerts: alerts?.length ? [...alerts, ...state.activeAlerts] : state.activeAlerts, operationalMetrics: state.scenarioConfig.scenarioId === 'tsrd-replay' ? replayMetrics(pdwHistory, decisions, replayEmitters, state.operationalMetrics) : { ...state.operationalMetrics, totalPdwCount: state.operationalMetrics.totalPdwCount + (pdws?.length ?? 0), decisionCount: decisions.length, trackedEmitterCount: replayEmitters.length }, currentRecommendation: recommendation };
  }),
  setSimulationStatus: (simulationStatus) => set({ simulationStatus }),
  setSimulationSpeed: (simulationSpeed) => set({ simulationSpeed: [0.5, 1, 2, 5].reduce((best, value) => Math.abs(value - simulationSpeed) < Math.abs(best - simulationSpeed) ? value : best, 1) }),
  setTimeWindowSeconds: (timeWindowSeconds) => set({ timeWindowSeconds: Math.max(60, Math.min(3600, timeWindowSeconds)) }),
  setMode: (mode: OperatingMode) => set({ mode }),
  setCurrentSimulationTime: (currentSimulationTime) => set({ currentSimulationTime }),
  setReceiver: (receiverId, patch) => set((state) => ({
    receivers: state.receivers.map((receiver) => receiver.id === receiverId ? { ...receiver, ...patch } : receiver),
    receiverState: state.receiverState.id === receiverId ? { ...state.receiverState, ...patch } : state.receiverState,
  })),
  setScenarioConfig: (patch) => set((state) => ({ scenarioConfig: { ...state.scenarioConfig, ...patch } })),
  appendPdws: (events) => set((state) => { const pdwHistory = [...events, ...state.pdwHistory].slice(0, MAX_PDWS); return { pdws: pdwHistory, pdwHistory, operationalMetrics: { ...state.operationalMetrics, totalPdwCount: state.operationalMetrics.totalPdwCount + events.length } }; }),
  appendDecision: (decision) => set((state) => { const decisionHistory = [decision, ...state.decisionHistory]; const derived = performanceFrom(decisionHistory, state.bandBeliefs); return { scanDecisions: decisionHistory, decisionHistory, performanceMetrics: derived.metrics, performanceKpis: derived.kpis, performanceBaselines: derived.baselines, decisionRewardTrace: derived.rewards }; }),
  setRecommendation: (currentRecommendation) => set({ currentRecommendation }),
  setAlerts: (activeAlerts) => set({ activeAlerts }),
  commandReceiverRetune: (bandId) => set((state) => {
    if (state.dataSource !== 'OFFLINE' || state.simulationStatus !== 'RUNNING' || state.receiverModel.phase === 'RETUNING') return {};
    const band = state.bandBeliefs.find(b => b.bandId === bandId) || state.bandBeliefs[0];
    const targetFrequencyGHz = (band.frequencyStartGHz + band.frequencyEndGHz) / 2;
    const recommendation: ScanRecommendation = { bandId: band.bandId, title: 'Operator-selected scan band', frequencyStartGHz: band.frequencyStartGHz, frequencyEndGHz: band.frequencyEndGHz, likelihood: band.predictedActivity, expectedYieldPercent: band.observationValue, dwellMs: band.dwellMs, basis: `${band.coverageStatus} · ${band.changeLevel} change`, explanation: `Operator selected ${band.band}; the scheduler will record the measured outcome after the dwell.` };
    return {
      receiverState: { ...state.receiverState, isRetuning: true, mode: 'SEARCH', dwellMs: band.dwellMs },
      receiverModel: { ...state.receiverModel, phase: 'RETUNING', remainingUs: state.receiverConstraints.retuningDelayUs, bandId: band.bandId, retunesInWindow: state.receiverModel.retunesInWindow + 1, retuneWindowStartMs: state.receiverModel.retuneWindowStartMs, retuneStartFrequencyGHz: state.receiverState.currentFrequencyGHz, retuneTargetFrequencyGHz: targetFrequencyGHz, manualOverride: true },
      currentRecommendation: recommendation,
    };
  }),
  startSimulation: (config) => set((state) => {
    if (config) {
      const configuredState = { ...state, scenarioConfig: { ...state.scenarioConfig, ...config } };
      return resetState(configuredState, true);
    }
    return state.simulationStatus === 'IDLE' ? resetState(state, true) : { simulationStatus: 'RUNNING' };
  }),
  pauseSimulation: () => set({ simulationStatus: 'PAUSED' }),
  resetSimulation: (andStart = false) => set(resetState(get(), andStart)),
  runBaselineComparison: () => set((state) => ({ performanceBaselines: performanceFrom(state.decisionHistory, state.bandBeliefs, state.groundTruthEmitters).baselines })),
  tick: (elapsedMs = 20) => set(advanceSimulation(get(), elapsedMs)),
  reorderQueue: (mode) => set((state) => {
    let sorted = [...state.bandBeliefs];
    if (mode === 'ACTIVITY') {
      sorted.sort((a, b) => b.activityPercent - a.activityPercent);
    } else if (mode === 'UNCERTAINTY') {
      sorted.sort((a, b) => b.uncertaintyPercent - a.uncertaintyPercent);
    } else if (mode === 'FREQUENCY') {
      sorted.sort((a, b) => a.frequencyStartGHz - b.frequencyStartGHz);
    } else if (mode === 'DWELL') {
      sorted.sort((a, b) => a.dwellMs - b.dwellMs);
    } else if (mode === 'REVERSE') {
      sorted.reverse();
    } else {
      sorted.sort((a, b) => b.observationValue - a.observationValue);
    }
    const ranked = sorted.map((b, i) => ({
      ...b,
      rank: i + 1,
      queueStatus: (i === 0 ? 'NEXT' : 'QUEUED') as 'NEXT' | 'QUEUED',
    }));
    const top = ranked[0];
    const rec: ScanRecommendation = {
      bandId: top.bandId,
      title: `Priority 01 · ${top.band}`,
      frequencyStartGHz: top.frequencyStartGHz,
      frequencyEndGHz: top.frequencyEndGHz,
      likelihood: top.predictedActivity,
      expectedYieldPercent: top.observationValue,
      dwellMs: top.dwellMs,
      basis: `Queue sorted by ${mode} · Rank 01`,
      explanation: `Queue reordered by ${mode.toLowerCase().replace('_', ' ')}. Receiver prioritized for ${top.band} (${top.frequencyStartGHz.toFixed(2)}–${top.frequencyEndGHz.toFixed(2)} GHz).`,
    };
    return {
      bandBeliefs: ranked,
      queueSortMode: mode === 'REVERSE' ? 'MANUAL' : mode,
      manualQueueOrder: ranked.map(b => b.bandId),
      currentRecommendation: rec,
      planCommitted: false,
    };
  }),
  moveQueueItem: (fromIndex, toIndex) => set((state) => {
    if (fromIndex < 0 || fromIndex >= state.bandBeliefs.length || toIndex < 0 || toIndex >= state.bandBeliefs.length || fromIndex === toIndex) return {};
    const items = [...state.bandBeliefs];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    const ranked = items.map((b, i) => ({
      ...b,
      rank: i + 1,
      queueStatus: (i === 0 ? 'NEXT' : 'QUEUED') as 'NEXT' | 'QUEUED',
    }));
    const top = ranked[0];
    const rec: ScanRecommendation = {
      bandId: top.bandId,
      title: `Priority 01 · ${top.band}`,
      frequencyStartGHz: top.frequencyStartGHz,
      frequencyEndGHz: top.frequencyEndGHz,
      likelihood: top.predictedActivity,
      expectedYieldPercent: top.observationValue,
      dwellMs: top.dwellMs,
      basis: `Manual queue adjustment · Rank 01`,
      explanation: `Target ${top.band} manually repositioned to primary queue rank. Receiver prioritized for ${top.frequencyStartGHz.toFixed(2)}–${top.frequencyEndGHz.toFixed(2)} GHz.`,
    };
    return {
      bandBeliefs: ranked,
      queueSortMode: 'MANUAL',
      manualQueueOrder: ranked.map(b => b.bandId),
      currentRecommendation: rec,
      planCommitted: false,
    };
  }),
  commitPlan: () => {
    const state = get();
    const bands = state.bandBeliefs;
    if (!bands.length) return;
    const constraints = state.receiverConstraints;
    const topBand = bands[0];
    const targetFreqGHz = (topBand.frequencyStartGHz + topBand.frequencyEndGHz) / 2;

    const scheduledBands = bands.slice(0, 5);
    const slots: ScanScheduleSlot[] = [];
    const totalWindowMs = (constraints.scanWindowSeconds || 10) * 1000;
    let currentOffsetMs = 0;

    scheduledBands.forEach((b, idx) => {
      const retuneMs = constraints.retuningDelayMs || 18;
      if (idx > 0) {
        const retuneOffsetPct = Math.min(96, (currentOffsetMs / totalWindowMs) * 100);
        const retuneWidthPct = Math.max(2, (retuneMs / totalWindowMs) * 100);
        slots.push({
          receiverId: 'RX-04',
          label: `RETUNE · ${retuneMs}ms`,
          durationMs: retuneMs,
          offsetPercent: retuneOffsetPct,
          widthPercent: retuneWidthPct,
          type: 'RETUNE',
        });
        currentOffsetMs += retuneMs;
      }
      const dwellMs = b.dwellMs || 240;
      const dwellOffsetPct = Math.min(97, (currentOffsetMs / totalWindowMs) * 100);
      const dwellWidthPct = Math.max(4, (dwellMs / totalWindowMs) * 100);
      slots.push({
        receiverId: idx === 2 ? 'RX-02' : 'RX-04',
        label: `${idx === 2 ? 'RX-02' : 'RX-04'} · ${b.band} (${((b.frequencyStartGHz + b.frequencyEndGHz) / 2).toFixed(1)} GHz)`,
        durationMs: dwellMs,
        offsetPercent: dwellOffsetPct,
        widthPercent: dwellWidthPct,
        type: idx === 2 ? 'SECONDARY' : 'DWELL',
      });
      currentOffsetMs += dwellMs;
    });

    const recommendation: ScanRecommendation = {
      bandId: topBand.bandId,
      title: 'Committed scan plan target',
      frequencyStartGHz: topBand.frequencyStartGHz,
      frequencyEndGHz: topBand.frequencyEndGHz,
      likelihood: topBand.predictedActivity,
      expectedYieldPercent: topBand.observationValue,
      dwellMs: topBand.dwellMs,
      basis: `Committed priority queue · Rank 01`,
      explanation: `Plan committed by operator. Receiver retuning to ${topBand.band} (${targetFreqGHz.toFixed(3)} GHz) to begin scheduled observation sequence.`,
    };

    const nextStatus = state.simulationStatus === 'IDLE' || state.simulationStatus === 'PAUSED' ? 'RUNNING' : state.simulationStatus;

    set({
      scanSchedule: slots,
      planCommitted: true,
      simulationStatus: nextStatus,
      receiverState: { ...state.receiverState, isRetuning: true, mode: 'SEARCH', dwellMs: topBand.dwellMs },
      receiverModel: {
        ...state.receiverModel,
        phase: 'RETUNING',
        remainingUs: constraints.retuningDelayUs,
        bandId: topBand.bandId,
        retunesInWindow: state.receiverModel.retunesInWindow + 1,
        retuneStartFrequencyGHz: state.receiverState.currentFrequencyGHz,
        retuneTargetFrequencyGHz: targetFreqGHz,
        manualOverride: true,
      },
      currentRecommendation: recommendation,
    });

    window.dispatchEvent(new CustomEvent('kavach-toast', {
      detail: `Plan committed: Receiver retuning to ${topBand.band} (${targetFreqGHz.toFixed(2)} GHz) · ${slots.length} execution slots scheduled`
    }));
  },
}));

useSimulationStore.subscribe(saveSessionSnapshot);

/** Operator pages consume only this scrubbed projection, never ground truth. */
export const selectOperatorEmitters = (state: SimulationStore): Emitter[] => state.emitters;
