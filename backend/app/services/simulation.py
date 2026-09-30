import logging
import csv
import asyncio
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from pathlib import Path

from . import mock_data
from .belief_engine import BeliefEngine, BeliefObservation
from ..core.config import PolicyMode, settings
from ..ml.inference_service import InferenceService, scheduler_observation
from ..db import repository

logger = logging.getLogger(__name__)
from ..models import AlertEvent, OperationalMetrics, PDW, RewardComponents, Scenario, ScenarioConfig, ScanDecision, SimulationState, SpectrumSample


def build_tick_delta(
    sim_time: str,
    previous_bands: dict[str, dict],
    current_bands: list[dict],
    previous_receiver: dict,
    receiver: dict,
    pdws: list[dict] | None = None,
    decision: dict | None = None,
    alerts: list[dict] | None = None,
) -> dict:
    changed_bands = []
    for band in current_bands:
        previous = previous_bands.get(band["bandId"], {})
        changed = {key: value for key, value in band.items() if key != "bandId" and previous.get(key) != value}
        if changed:
            changed_bands.append({"bandId": band["bandId"], **changed})
    delta = {"simTime": sim_time}
    if changed_bands:
        delta["changedBands"] = changed_bands
    if pdws:
        delta["newPdws"] = pdws
    if decision:
        delta["newDecision"] = decision
    if alerts:
        delta["newAlerts"] = alerts
    if receiver != previous_receiver:
        delta["receiverState"] = receiver
    return delta


class SimulationService:
    def __init__(self) -> None:
        self.engine = BeliefEngine()
        self.current_band_id = "rf-01"
        self.receiver_frequency_ghz = 8.420
        self.now_ms = 0.0
        self.retunes_in_window = 0
        self.retune_budget = 30
        self.status = "PAUSED"
        self.scenario_id = "adaptive-multi-emitter"
        self.scenario_config = {"scenarioId": self.scenario_id, "emitterCount": 8, "durationSeconds": 300, "seed": 7419}
        self.policy_mode = settings.policy_mode
        self.inference = InferenceService(settings.policy_checkpoint)
        self.inference_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="aegis-inference")
        self.inference_latencies_ms: list[float] = []
        self.replay_rows: list[dict[str, str]] = []
        source_root = Path(__file__).resolve()
        replay_path = next((root / "src" / "data" / "pulses_all.csv" for root in (source_root.parents[3], source_root.parents[2]) if (root / "src" / "data" / "pulses_all.csv").exists()), source_root.parents[2] / "src" / "data" / "pulses_all.csv")
        if replay_path.exists():
            with replay_path.open(newline="") as source:
                self.replay_rows = [row for row in csv.DictReader(source) if row.get("receiver_mode") == "scan"]
        self.replay_index = 0
        self.replay_pdws = []
        self.replay_decisions = []
        self.replay_alerts = []
        self.current_run_id: str | None = None
        self.simulation_speed = 1.0
        self.clock_interval_seconds = 0.5
        self._clock_task: asyncio.Task | None = None
        self._subscribers: set[asyncio.Queue[dict]] = set()
        self._tick_sequence = 0
        self.update = self.engine.update(self.now_ms, self.receiver_frequency_ghz, self.current_band_id, self.retunes_in_window, self.retune_budget)

    def subscribe(self) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self._subscribers.discard(queue)

    async def start_clock(self) -> None:
        if self._clock_task is None or self._clock_task.done():
            self._clock_task = asyncio.create_task(self._run_clock(), name="aegis-simulation-clock")

    async def stop_clock(self) -> None:
        task = self._clock_task
        self._clock_task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _run_clock(self) -> None:
        try:
            while self.status == "RUNNING":
                delta = self.tick()
                self._tick_sequence += 1
                message = {"type": "tick_delta", "version": 1, "sequence": self._tick_sequence, **delta}
                for queue in tuple(self._subscribers):
                    queue.put_nowait(message)
                await asyncio.sleep(self.clock_interval_seconds / max(0.1, self.simulation_speed))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("simulation_clock_failed")
            self.status = "PAUSED"

    def get_state(self) -> SimulationState:
        base = mock_data.state()
        receiver = base.receiverState.model_copy(update={"currentFrequencyGHz": self.receiver_frequency_ghz})
        replay_only = self.scenario_id == "tsrd-replay"
        return base.model_copy(update={
            "currentSimulationTime": self._simulation_time(), "receiverState": receiver,
            "receivers": [receiver], "bandBeliefs": self.update.bands,
            "simulationStatus": self.status, "simulationSpeed": self.simulation_speed,
            "scenarioConfig": ScenarioConfig.model_validate(self.scenario_config),
            "emitters": [], "pdws": list(self.replay_pdws) if replay_only else base.pdws,
            "pdwHistory": list(self.replay_pdws) if replay_only else base.pdwHistory,
            "scanDecisions": list(self.replay_decisions) if replay_only else base.scanDecisions,
            "decisionHistory": list(self.replay_decisions) if replay_only else base.decisionHistory,
            "activeAlerts": list(self.replay_alerts) if replay_only else base.activeAlerts,
        })

    def _simulation_time(self) -> str:
        origin = datetime(2026, 9, 29, 4, 11, 52, 84_000, tzinfo=timezone.utc)
        current = origin + timedelta(milliseconds=self.now_ms)
        return current.strftime("%H:%M:%S.") + f"{current.microsecond // 1000:03d}Z"

    def get_spectrum(self) -> list[SpectrumSample]:
        return [SpectrumSample(id="WF-1", relativeTimeSeconds=-12, frequencyGHz=8.42, durationMs=240, amplitude=0.82, isPredicted=False)]

    def get_decision(self) -> ScanDecision:
        band = self.update.next_band
        policy_mode = "DETERMINISTIC"
        policy_version = "belief-engine"
        confidence = 1.0
        log_probability = 0.0
        latency_ms = 0.0
        safety_override = False
        fallback_reason: str | None = None
        if self.policy_mode == PolicyMode.TRAINED:
            observation = scheduler_observation(self.update.bands, self.receiver_frequency_ghz, max(0, self.retune_budget - self.retunes_in_window))
            if self.inference.available and self.retunes_in_window < self.retune_budget:
                try:
                    result = self.inference_executor.submit(self.inference.predict_action, observation).result(timeout=settings.inference_timeout_seconds)
                    if 0 <= result.action < 75:
                        candidate_frequency = (result.action * 240 + 120) / 1000
                        band = min(self.update.bands, key=lambda candidate: abs((candidate.frequencyStartGHz + candidate.frequencyEndGHz) / 2 - candidate_frequency))
                        policy_mode = "TRAINED"
                        policy_version = result.model_version
                        confidence = result.confidence
                        log_probability = result.log_probability
                        latency_ms = result.latency_ms
                        self.inference_latencies_ms.append(latency_ms)
                    else:
                        safety_override = True
                        fallback_reason = f"Policy returned invalid action {result.action}"
                except FutureTimeout:
                    fallback_reason = f"Policy inference exceeded {settings.inference_timeout_seconds:.2f}s timeout"
                    logger.error("%s; using deterministic recommendation", fallback_reason)
                    safety_override = True
                except Exception as error:
                    fallback_reason = f"Policy inference error: {type(error).__name__}"
                    logger.exception("%s; using deterministic recommendation", fallback_reason)
                    safety_override = True
            else:
                safety_override = True
                fallback_reason = "Trained policy unavailable" if not self.inference.available else "Scan budget exhausted"
                logger.warning("Trained policy unavailable or scan budget exhausted; using deterministic recommendation")
        if safety_override:
            policy_mode = "DETERMINISTIC_FALLBACK"
            policy_version = "belief-engine"
        return ScanDecision(
            id=f"DEC-{int(self.now_ms):08d}", timestamp=self._simulation_time(),
            action="SCAN_BAND", band=band.band, bandId=band.bandId,
            frequencyGHz=(band.frequencyStartGHz + band.frequencyEndGHz) / 2,
            dwellMs=band.dwellMs, predictedActivity=band.predictedActivity,
            uncertainty=band.uncertainty, result="HIT" if band.recentHits else "MISS",
            interceptionTimeMs=None, beliefSnapshot=band,
            rewardComponents=RewardComponents(detectionBenefit=0, delayPenalty=0, scanCost=band.scanCost, missPenalty=0, stalenessPenalty=band.stalenessFactor * 0.12),
            reward=0, before="Initial belief state", outcome="Awaiting observation",
            policyMode=policy_mode, policyVersion=policy_version, policyConfidence=confidence,
            policyLogProbability=log_probability, inferenceLatencyMs=latency_ms, safetyOverride=safety_override,
            fallbackReason=fallback_reason,
        )

    def get_metrics(self) -> OperationalMetrics:
        return mock_data.metrics()

    def get_history(self) -> list[ScanDecision]:
        return [mock_data.decision()]

    def run_research_baselines(self) -> dict:
        return {"scenarioId": self.scenario_id, "baselines": [{"name": "Current belief policy", "nextBand": self.update.next_band.band, "predictedActivity": self.update.next_band.predictedActivity, "status": "CURRENT"}, {"name": "Sequential sweep", "nextBand": self.update.bands[-1].band, "predictedActivity": self.update.bands[-1].predictedActivity, "status": "COMPARISON"}], "disclaimer": "Prototype comparison over the current simulated belief state."}

    def get_research_ground_truth(self) -> dict:
        return {"source": "SIMULATION_REFERENCE", "emitters": [{"emitterId": "E-041", "active": True, "currentFrequencyGHz": self.receiver_frequency_ghz}], "disclaimer": "Synthetic evaluation reference; no hardware or classified source is connected."}

    def list_scenarios(self) -> list[Scenario]:
        return [mock_data.scenario(), Scenario(id="tsrd-replay", name="TSRD pulse train replay", description="Recorded real pulse descriptor train", defaultEmitterCount=1, defaultDurationSeconds=300, defaultSeed=7419, previewBursts=[{"x": 30, "y": 24, "width": 20, "tone": "teal", "opacity": 0.85}])]

    def tick(self) -> dict:
        """Advance one backend step and return only changed fields and newly emitted rows."""
        previous_bands = {band.bandId: band.model_dump(by_alias=True) for band in self.update.bands}
        previous_receiver = self.get_state().receiverState.model_dump(by_alias=True)
        row = self.replay_rows[self.replay_index % len(self.replay_rows)] if self.scenario_id == "tsrd-replay" and self.replay_rows else None
        if self.scenario_id == "tsrd-replay" and row is None:
            raise RuntimeError("TSRD replay dataset is unavailable; refusing to substitute generated pulse data")
        self.now_ms += 500
        self.retunes_in_window = (self.retunes_in_window + 1) % max(1, self.retune_budget)
        detected = str(row.get("detected", "false")).lower() == "true" if row else bool(int(self.now_ms / 500) % 3)
        self.update = self.engine.update(self.now_ms, self.receiver_frequency_ghz, self.current_band_id, self.retunes_in_window, self.retune_budget, observation=BeliefObservation(self.current_band_id, "HIT" if detected else "MISS"))
        self.current_band_id = self.update.next_band.bandId
        state = self.get_state()
        decision = self.get_decision()
        if row:
            self.replay_index += 1
        frequency_ghz = float(row["centre_frequency_mhz"]) / 1000 if row else self.receiver_frequency_ghz
        pri_ms = float(row["toa_us"]) / 1000 if row else 1.25
        pdw = PDW(id=f"PDW-LIVE-{int(self.now_ms):08d}", timestamp=state.currentSimulationTime, emitterId=f"TSRD-{row['emitter_id']}" if row else "E-041", centerFrequencyMHz=frequency_ghz * 1000, centerFrequencyGHz=frequency_ghz, priMs=pri_ms, pulseWidthUs=float(row["pulse_width_us"]) if row else 4.1, amplitudeDbm=float(row["amplitude_db"]) if row else -48, amplitudePercent=67, aoaDeg=float(row["aoa_deg"]) if row else None, classification=f"TSRD {row['emitter_type']}" if row else "PULSE TRAIN", result="HIT" if detected else "MISS", confidence=1.0 if row else 0.84, scenarioLabel="TSRD pulse train replay" if row else None)
        if row:
            self.replay_pdws = [pdw, *self.replay_pdws][:2400]
            self.replay_decisions = [decision, *self.replay_decisions][:2400]
        alerts = [AlertEvent(id=f"ALERT-LIVE-{int(self.now_ms)}", title="Emitter change detected", description="Live belief update indicates a change in the observed pulse train.", severity="WARNING", displayLabel="CHANGE HIGH", active=True, timestamp=state.currentSimulationTime)] if int(self.now_ms) % 15000 == 0 else []
        if row:
            self.replay_alerts = [*alerts, *self.replay_alerts][:100]
        if decision.safetyOverride:
            alerts.append(AlertEvent(id=f"ALERT-POLICY-{int(self.now_ms)}", title="Policy inference fallback", description=decision.fallbackReason or "Deterministic recommendation used after trained-policy inference was unavailable.", severity="WARNING", displayLabel="POLICY FALLBACK", active=True, timestamp=state.currentSimulationTime))
        decision_data = decision.model_dump(by_alias=True)
        repository.record_decision(self.current_run_id, decision_data)
        receiver = state.receiverState.model_copy(update={"currentFrequencyGHz": self.update.next_band.frequencyStartGHz + (self.update.next_band.frequencyEndGHz - self.update.next_band.frequencyStartGHz) / 2})
        self.receiver_frequency_ghz = receiver.currentFrequencyGHz
        next_bands = [band.model_dump(by_alias=True) for band in self.update.bands]
        receiver_data = receiver.model_dump(by_alias=True)
        return build_tick_delta(
            self._simulation_time(), previous_bands, next_bands,
            previous_receiver, receiver_data,
            [pdw.model_dump(by_alias=True)] if pdw else None,
            decision_data,
            [alert.model_dump(by_alias=True) for alert in alerts] if alerts else None,
        )

    def load_scenario(self, config: ScenarioConfig) -> Scenario:
        self.engine = BeliefEngine()
        self.current_band_id = "rf-01"
        self.receiver_frequency_ghz = 8.420
        self.retunes_in_window = 0
        self.status = "PAUSED"
        self.update = self.engine.update(0, self.receiver_frequency_ghz, self.current_band_id, 0, self.retune_budget)
        self.now_ms = 0
        self._tick_sequence = 0
        self.scenario_id = config.scenarioId
        self.scenario_config = config.model_dump()
        self.replay_index = 0
        self.replay_pdws = []
        self.replay_decisions = []
        self.replay_alerts = []
        if config.scenarioId == "tsrd-replay" and not self.replay_rows:
            raise RuntimeError("TSRD replay dataset is unavailable")
        repository.record_scenario(config.model_dump())
        return mock_data.scenario().model_copy(update={"id": config.scenarioId})

    def command(self, action: str) -> SimulationState:
        self.status = "RUNNING" if action == "start" else "PAUSED"
        if action == "start" and not self.current_run_id:
            decision = self.get_decision()
            self.current_run_id = repository.start_run(self._scenario_config(), decision.policyVersion, settings.policy_checkpoint)
        elif action in {"pause", "reset"} and self.current_run_id:
            repository.stop_run(self.current_run_id, self.get_metrics().model_dump(), self.get_decision().policyVersion)
            self.current_run_id = None
        if action == "reset":
            self.load_scenario(ScenarioConfig(scenarioId="adaptive-multi-emitter", emitterCount=8, durationSeconds=120, seed=7419))
        return self.get_state()

    def _scenario_config(self) -> dict:
        return self.scenario_config

    def observe(self, hit: bool, band_id: str | None = None, now_ms: float | None = None) -> None:
        self.now_ms = self.now_ms if now_ms is None else now_ms
        observed_band_id = band_id or self.current_band_id
        self.update = self.engine.update(self.now_ms, self.receiver_frequency_ghz, self.current_band_id, self.retunes_in_window, self.retune_budget, observation=BeliefObservation(observed_band_id, "HIT" if hit else "MISS"))
        self.current_band_id = self.update.next_band.bandId


simulation_service = SimulationService()
