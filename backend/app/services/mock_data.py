from ..models import AlertEvent, Emitter, OperationalMetrics, PDW, PreviewBurst, RewardComponents, Scenario, ScenarioConfig, ScanDecision, SchedulerState, SimulationState


def band() -> SchedulerState:
    return SchedulerState(bandId="BAND-08", rank=1, band="8.0-8.5 GHz", frequencyStartGHz=8.0, frequencyEndGHz=8.5, activityPercent=82.0, uncertaintyPercent=18.0, observationValue=0.84, dwellMs=240, queueStatus="NEXT", activityProbability=0.82, uncertainty=0.18, predictedActivity=0.86, predictedActivityBoost=0.04, stalenessFactor=0.08, changeLevelBoost=0.12, scanCost=0.24, timeSinceLastScanMs=18420, recentHits=7, recentMisses=2, lastObservedAtMs=165780, lastHitTimeMs=165540, averageInterArrivalMs=840, changeLevel="MEDIUM", changeLevelUntilMs=180000, coverageStatus="FRESH", observationHistory=["HIT", "MISS", "HIT"], hitTimesMs=[162100, 163200, 165540])


def scenario() -> Scenario:
    return Scenario(id="adaptive-multi-emitter", name="Adaptive Multi-Emitter Environment", description="Mixed emitters with a scripted frequency shift at 20 seconds", defaultEmitterCount=8, defaultDurationSeconds=120, defaultSeed=7419, previewBursts=[PreviewBurst(x=32.0, y=18.0, width=20.0, tone="teal", opacity=0.6)])


def emitter() -> Emitter:
    return Emitter(id="E-041", displayName="Unknown emitter", firstSeenTimestamp="04:08:12Z", patternType="PULSE TRAIN", centerFrequencyGHz=8.420, status="ACTIVE", statusTone="green", activityHistory=[12, 18, 24, 35, 47, 56], frequencyHistoryGHz=[8.420, 8.421, 8.420], confidence=0.948, priMs=1.25, signalStrengthDbm=-42, frequencyDeltaMHz=12.4, stabilityStatus="STABLE")


def pdw() -> PDW:
    return PDW(id="PDW-89142", timestamp="04:11:52.084", emitterId="E-041", centerFrequencyGHz=8.4201, priMs=1.250, pulseWidthUs=4.1, amplitudeDbm=-42, amplitudePercent=82, classification="PULSE TRAIN", result="HIT", confidence=0.948, aoaDeg=41, scenarioLabel="Adaptive Multi-Emitter Environment")


def decision() -> ScanDecision:
    current_band = band()
    return ScanDecision(id="DEC-1842", timestamp="04:11:52.084Z", action="SCAN_BAND", band=current_band.band, bandId=current_band.bandId, frequencyGHz=8.25, dwellMs=240, predictedActivity=0.86, uncertainty=0.18, result="HIT", interceptionTimeMs=244, beliefSnapshot=current_band, rewardComponents=RewardComponents(detectionBenefit=0.72, delayPenalty=0.06, scanCost=0.04, missPenalty=0.0, stalenessPenalty=0.02), reward=0.60, before="8.0-8.5 GHz", outcome="Emitter E-041 intercepted")


def state() -> SimulationState:
    receiver = {"id": "RX-04", "label": "Receiver 04", "currentFrequencyGHz": 8.420, "mode": "TRACK", "dwellMs": 240, "isRetuning": True, "active": True}
    config = ScenarioConfig(scenarioId="adaptive-multi-emitter", emitterCount=8, durationSeconds=120, seed=7419)
    current_decision = decision()
    current_pdw = pdw()
    return SimulationState(currentSimulationTime="04:11:52.084Z", timeWindowSeconds=10, theaterDateLabel="29 SEP 2026", theaterName="AEGIS TEST THEATER", operationId="OP-2026-0929-01", receiverState=receiver, receivers=[receiver], bandBeliefs=[band()], emitters=[emitter()], pdws=[current_pdw], pdwHistory=[current_pdw], scanDecisions=[current_decision], decisionHistory=[current_decision], activeAlerts=[AlertEvent(id="ALERT-041", title="Emitter change detected", description="E-041 center frequency shifted +12.4 MHz.", severity="WARNING", displayLabel="CHANGE HIGH", active=True, timestamp="04:11:52Z")], simulationStatus="PAUSED", simulationSpeed=1, scenarioConfig=config)


def metrics() -> OperationalMetrics:
    return OperationalMetrics(receiverCapacity=6, trackedEmitterCount=1, scanEfficiencyPercent=87.3, totalPdwCount=1284, pdwUpdateRateKHz=12.8, meanReward=0.62, hitRatePercent=78.4, policyVersion="ppo-ew-v2.8", evaluationSetSize=12400, decisionCount=1842, newEmitterCount=3, unclassifiedEmitterCount=2, scanEfficiencyDeltaPercent=2.1)