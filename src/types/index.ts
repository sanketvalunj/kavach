export type SimulationStatus = 'IDLE' | 'RUNNING' | 'PAUSED';
export type OperatingMode = 'OPERATOR' | 'RESEARCH';
export type ReceiverMode = 'SEARCH' | 'TRACK' | 'HOLD';
export type ScanQueueStatus = 'NEXT' | 'QUEUED';
export type ChangeLevel = 'NONE' | 'MEDIUM' | 'HIGH';
export type CoverageStatus = 'FRESH' | 'STALE' | 'VERY_STALE';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type EmitterPattern = 'STABLE' | 'PERIODIC' | 'INTERMITTENT' | 'FREQUENCY_AGILE' | 'CHANGING' | 'NEW';
export type ReceiverPhase = 'RETUNING' | 'DWELLING' | 'BUDGET_WAIT';

export interface PDW {
  id: string;
  timestamp: string;
  emitterId: string;
  centerFrequencyMHz?: number;
  centerFrequencyGHz: number;
  priMs: number;
  pulseWidthUs: number;
  amplitudeDbm: number;
  amplitudePercent: number;
  classification: string;
  result: 'HIT' | 'MISS' | 'REVIEW';
  confidence: number;
  aoaDeg?: number;
  scenarioLabel?: string;
}

export interface SchedulerState {
  bandId: string;
  rank: number;
  band: string;
  frequencyStartGHz: number;
  frequencyEndGHz: number;
  activityPercent: number;
  uncertaintyPercent: number;
  observationValue: number;
  dwellMs: number;
  queueStatus: ScanQueueStatus;
  activityProbability: number;
  uncertainty: number;
  predictedActivity: number;
  predictedActivityBoost: number;
  stalenessFactor: number;
  changeLevelBoost: number;
  scanCost: number;
  timeSinceLastScanMs: number;
  recentHits: number;
  recentMisses: number;
  lastObservedAtMs: number | null;
  lastHitTimeMs: number | null;
  averageInterArrivalMs: number | null;
  changeLevel: ChangeLevel;
  changeLevelUntilMs: number;
  coverageStatus: CoverageStatus;
  observationHistory: Array<'HIT' | 'MISS'>;
  hitTimesMs: number[];
}

export interface ScanDecision {
  id: string;
  timestamp: string;
  action: string;
  band: string;
  bandId: string;
  frequencyGHz: number;
  dwellMs: number;
  predictedActivity: number;
  uncertainty: number;
  result: 'HIT' | 'MISS';
  interceptionTimeMs: number | null;
  beliefSnapshot: SchedulerState;
  rewardComponents: {
    detectionBenefit: number;
    delayPenalty: number;
    scanCost: number;
    missPenalty: number;
    stalenessPenalty: number;
  };
  reward: number;
  before: string;
  outcome: string;
  policyMode?: string;
  policyVersion?: string;
  safetyOverride?: boolean;
  fallbackReason?: string | null;
}

/** Operator-facing emitter estimate. Ground truth is held separately. */
export interface Emitter {
  id: string;
  displayName: string;
  firstSeenTimestamp: string;
  patternType: string;
  centerFrequencyGHz: number;
  status: string;
  statusTone: 'green' | 'teal' | 'amber' | 'quiet';
  activityHistory: number[];
  frequencyHistoryGHz: number[];
  confidence: number;
  priMs: number;
  signalStrengthDbm: number;
  frequencyDeltaMHz: number;
  stabilityStatus: string;
}

export interface GroundTruthEmitter {
  emitterId: string;
  trueClass: string;
  platform: string;
  actualFrequencyGHz: number;
  missionRole: string;
  pattern: EmitterPattern;
  introducedAtMs: number;
  agileFrequenciesGHz: number[];
  hopIntervalMs: number;
  periodMs: number;
  activeDurationMs: number;
  intermittencyProbability: number;
  changeAtMs: number;
  changedFrequencyGHz: number;
  pulseWidthUs: number;
  amplitudeDbm: number;
  priMs: number;
  aoaDeg: number;
  active: boolean;
  activeSinceMs: number | null;
  currentFrequencyGHz: number;
}

export interface ReceiverModelState {
  phase: ReceiverPhase;
  remainingUs: number;
  bandId: string;
  dwellUs: number;
  retunesInWindow: number;
  retuneWindowStartMs: number;
  completedDwells: number;
  pendingHit: GroundTruthEmitter | null;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  defaultEmitterCount: number;
  defaultDurationSeconds: number;
  defaultSeed: number;
  previewBursts: Array<{ x: number; y: number; width: number; tone: 'teal' | 'amber'; opacity: number }>;
}

export interface ScenarioScriptedEvent {
  type: 'FREQUENCY_SHIFT' | 'NEW_EMITTER';
  atMs: number;
  emitterId: string;
  fromFrequencyGHz?: number;
  toFrequencyGHz?: number;
}

export interface ScenarioDefinition extends Scenario {
  emitterSeeds: import('../simulation/engine.ts').EmitterSeed[];
  receiverConstraints: Partial<ReceiverConstraints>;
  scriptedEvents: ScenarioScriptedEvent[];
}

export interface ScenarioConfig {
  scenarioId: string;
  emitterCount: number;
  durationSeconds: number;
  seed: number;
}

export interface ReceiverState {
  id: string;
  label: string;
  currentFrequencyGHz: number;
  mode: ReceiverMode;
  dwellMs: number;
  isRetuning: boolean;
  active: boolean;
}

export interface AlertEvent {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  displayLabel: string;
  active: boolean;
  timestamp: string;
}

export interface ScanRecommendation {
  bandId: string;
  title: string;
  frequencyStartGHz: number;
  frequencyEndGHz: number;
  likelihood: number;
  expectedYieldPercent: number;
  dwellMs: number;
  basis: string;
  explanation: string;
}

export interface SpectrumSample {
  id: string;
  relativeTimeSeconds: number;
  frequencyGHz: number;
  durationMs: number;
  amplitude: number;
  isPredicted: boolean;
}

export interface SpectrumBurst {
  id: string;
  angleRadians: number;
  axialPosition: number;
  amplitude: number;
}

export interface WaterfallRegion {
  id: string;
  styleClass: 'band-one' | 'band-two';
  topPercent: number;
  heightPercent: number;
  label: string;
}

export interface OperationalMetrics {
  receiverCapacity: number;
  trackedEmitterCount: number;
  scanEfficiencyPercent: number;
  totalPdwCount: number;
  pdwUpdateRateKHz: number;
  meanReward: number;
  hitRatePercent: number;
  policyVersion: string;
  evaluationSetSize: number;
  decisionCount: number;
  newEmitterCount: number;
  unclassifiedEmitterCount: number;
  scanEfficiencyDeltaPercent: number;
}

export interface ReceiverConstraints {
  frequencyMinGHz: number;
  frequencyMaxGHz: number;
  bandwidthMHz: number;
  dwellLimitMs: number;
  retuningDelayMs: number;
  scanBudgetSeconds: number;
  scanWindowSeconds: number;
  optimizationPolicy: string;
  instantaneousBandwidthMHz: number;
  retuningDelayUs: number;
  dwellUs: number;
  scanRetunesPerMinute: number;
}

export interface ScanScheduleSlot {
  receiverId: string;
  label: string;
  durationMs: number;
  offsetPercent: number;
  widthPercent: number;
  type: 'DWELL' | 'RETUNE' | 'SECONDARY';
}

export interface PerformanceMetricSeries {
  title: string;
  key: string;
  unit: string;
  color: string;
  values: number[];
}

export interface ResearchSnapshot {
  tabs: string[];
  fieldsByTab: Record<string, Array<[string, string]>>;
  decisionTraceId: string;
  decisionTraceFields: Array<[string, string]>;
  baselineRuns: Array<[string, string, string, string, string, string]>;
}

export interface SimulationState {
  currentSimulationTime: string;
  timeWindowSeconds: number;
  theaterDateLabel: string;
  theaterName: string;
  operationId: string;
  receiverState: ReceiverState;
  receiverModel: ReceiverModelState;
  receivers: ReceiverState[];
  receiverConstraints: ReceiverConstraints;
  scanSchedule: ScanScheduleSlot[];
  bandBeliefs: SchedulerState[];
  emitters: Emitter[];
  /** Ground truth is isolated from operator-facing emitter records. */
  groundTruthEmitters: GroundTruthEmitter[];
  randomState: number;
  elapsedSimulationMs: number;
  environmentChangeUntilMs: number;
  lastTickResult: 'HIT' | 'MISS' | null;
  pdws: PDW[];
  pdwHistory: PDW[];
  scanDecisions: ScanDecision[];
  decisionHistory: ScanDecision[];
  currentRecommendation: ScanRecommendation;
  activeAlerts: AlertEvent[];
  simulationStatus: SimulationStatus;
  simulationSpeed: number;
  scenarioConfig: ScenarioConfig;
  scenarios: Scenario[];
  mode: OperatingMode;
  waterfallSamples: SpectrumSample[];
  waterfallRegions: WaterfallRegion[];
  cylinderBursts: SpectrumBurst[];
  performanceMetrics: PerformanceMetricSeries[];
  performanceKpis: Array<[string, string, string]>;
  performanceBaselines: Array<[string, string, string, string, string, string]>;
  decisionRewardTrace: number[];
  operationalMetrics: OperationalMetrics;
  researchSnapshot: ResearchSnapshot;
  isSeeded: boolean;
}
