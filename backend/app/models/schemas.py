from typing import Literal

from pydantic import BaseModel, ConfigDict


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PDW(ContractModel):
    id: str
    timestamp: str
    emitterId: str
    centerFrequencyMHz: float | None = None
    centerFrequencyGHz: float
    priMs: float
    pulseWidthUs: float
    amplitudeDbm: float
    amplitudePercent: float
    classification: str
    result: Literal["HIT", "MISS", "REVIEW"]
    confidence: float
    aoaDeg: float | None = None
    scenarioLabel: str | None = None


class SchedulerState(ContractModel):
    bandId: str
    rank: int
    band: str
    frequencyStartGHz: float
    frequencyEndGHz: float
    activityPercent: float
    uncertaintyPercent: float
    observationValue: float
    dwellMs: float
    queueStatus: Literal["NEXT", "QUEUED"]
    activityProbability: float
    uncertainty: float
    predictedActivity: float
    predictedActivityBoost: float
    stalenessFactor: float
    changeLevelBoost: float
    scanCost: float
    timeSinceLastScanMs: float
    recentHits: int
    recentMisses: int
    lastObservedAtMs: float | None = None
    lastHitTimeMs: float | None = None
    averageInterArrivalMs: float | None = None
    changeLevel: Literal["NONE", "MEDIUM", "HIGH"]
    changeLevelUntilMs: float
    coverageStatus: Literal["FRESH", "STALE", "VERY_STALE"]
    observationHistory: list[Literal["HIT", "MISS"]]
    hitTimesMs: list[float]


class RewardComponents(ContractModel):
    detectionBenefit: float
    delayPenalty: float
    scanCost: float
    missPenalty: float
    stalenessPenalty: float


class ScanDecision(ContractModel):
    id: str
    timestamp: str
    action: str
    band: str
    bandId: str
    frequencyGHz: float
    dwellMs: float
    predictedActivity: float
    uncertainty: float
    result: Literal["HIT", "MISS"]
    interceptionTimeMs: float | None = None
    beliefSnapshot: SchedulerState
    rewardComponents: RewardComponents
    reward: float
    before: str
    outcome: str
    policyMode: str = "DETERMINISTIC"
    policyVersion: str = "belief-engine"
    policyConfidence: float = 1.0
    policyLogProbability: float = 0.0
    inferenceLatencyMs: float = 0.0
    safetyOverride: bool = False
    fallbackReason: str | None = None


class Emitter(ContractModel):
    id: str
    displayName: str
    firstSeenTimestamp: str
    patternType: str
    centerFrequencyGHz: float
    status: str
    statusTone: Literal["green", "teal", "amber", "quiet"]
    activityHistory: list[float]
    frequencyHistoryGHz: list[float]
    confidence: float
    priMs: float
    signalStrengthDbm: float
    frequencyDeltaMHz: float
    stabilityStatus: str


class PreviewBurst(ContractModel):
    x: float
    y: float
    width: float
    tone: Literal["teal", "amber"]
    opacity: float


class Scenario(ContractModel):
    id: str
    name: str
    description: str
    defaultEmitterCount: int
    defaultDurationSeconds: int
    defaultSeed: int
    previewBursts: list[PreviewBurst]


class ScenarioConfig(ContractModel):
    scenarioId: str
    emitterCount: int
    durationSeconds: int
    seed: int


class ReceiverState(ContractModel):
    id: str
    label: str
    currentFrequencyGHz: float
    mode: Literal["SEARCH", "TRACK", "HOLD"]
    dwellMs: float
    isRetuning: bool
    active: bool


class AlertEvent(ContractModel):
    id: str
    title: str
    description: str
    severity: Literal["INFO", "WARNING", "CRITICAL"]
    displayLabel: str
    active: bool
    timestamp: str


class SpectrumSample(ContractModel):
    id: str
    relativeTimeSeconds: float
    frequencyGHz: float
    durationMs: float
    amplitude: float
    isPredicted: bool


class OperationalMetrics(ContractModel):
    receiverCapacity: int
    trackedEmitterCount: int
    scanEfficiencyPercent: float
    totalPdwCount: int
    pdwUpdateRateKHz: float
    meanReward: float
    hitRatePercent: float
    policyVersion: str
    evaluationSetSize: int
    decisionCount: int
    newEmitterCount: int
    unclassifiedEmitterCount: int
    scanEfficiencyDeltaPercent: float


class SimulationState(ContractModel):
    currentSimulationTime: str
    timeWindowSeconds: float
    theaterDateLabel: str
    theaterName: str
    operationId: str
    receiverState: ReceiverState
    receivers: list[ReceiverState]
    bandBeliefs: list[SchedulerState]
    emitters: list[Emitter]
    pdws: list[PDW]
    pdwHistory: list[PDW]
    scanDecisions: list[ScanDecision]
    decisionHistory: list[ScanDecision]
    activeAlerts: list[AlertEvent]
    simulationStatus: Literal["IDLE", "RUNNING", "PAUSED"]
    simulationSpeed: float
    scenarioConfig: ScenarioConfig


class HealthResponse(ContractModel):
    status: Literal["ok", "degraded"]
    service: str
    mode: str
    version: str
    database: Literal["ok", "unavailable"]
    modelCheckpoint: Literal["loaded", "missing", "failed"]
