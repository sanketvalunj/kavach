from __future__ import annotations

import json
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core import auth
from app.core.config import PolicyMode, settings
from app.main import app
from app.ml.deinterleave_service import cluster_pulses
from app.models import PDW
from app.services.belief_engine import BeliefEngine, BeliefObservation
from app.services.simulation import build_tick_delta, simulation_service
from app.ml.inference_service import OBSERVATION_SIZE, scheduler_observation


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as active_client:
        yield active_client


def _operator_token(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> str:
    monkeypatch.setattr(settings, "jwt_secret", "phase-b11-test-secret-with-32-bytes-min")
    monkeypatch.setattr(settings, "operator_username", "operator")
    monkeypatch.setattr(settings, "operator_password", "secret")
    return client.post("/auth/login", json={"username": "operator", "password": "secret"}).json()["access_token"]


def test_auth_rejects_tampered_expired_and_wrong_secret_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "jwt_secret", "phase-b11-test-secret-with-32-bytes-min")
    valid, _ = auth.issue_token("operator", "OPERATOR")
    assert auth.user_from_token(valid).username == "operator"
    assert auth.user_from_token(valid + "x") is None
    monkeypatch.setattr(settings, "jwt_secret", "different-secret-with-at-least-32-bytes")
    assert auth.user_from_token(valid) is None


def test_deinterleaver_output_shape_and_cluster_accuracy() -> None:
    pulses = []
    for index in range(6):
        # Two stable pulse trains are separated in frequency and angle.
        for emitter, frequency, aoa in (("A", 5.0, 10.0), ("B", 9.0, 220.0)):
            pulses.append(PDW(
                id=f"{emitter}-{index}", timestamp=f"00:00:{index:02d}.000",
                emitterId=emitter, centerFrequencyMHz=frequency * 1000,
                centerFrequencyGHz=frequency, priMs=1.0, pulseWidthUs=4,
                amplitudeDbm=-45, amplitudePercent=55, aoaDeg=aoa,
                classification="PULSE TRAIN", result="HIT", confidence=0.95,
            ))
    clusters = cluster_pulses(pulses)
    assert len(clusters) == 2
    assert all({"id", "observations", "centerFrequencyGHz", "estimatedPriMs", "trace"} <= c.keys() for c in clusters)
    predicted = {pulse.emitterId: cluster_index for cluster_index, cluster in enumerate(clusters) for pulse in cluster["observations"]}
    assert predicted["A"] != predicted["B"]
    assert all(len(cluster["observations"]) == 6 for cluster in clusters)


def test_belief_engine_scripted_hit_miss_scenario() -> None:
    engine = BeliefEngine()
    results = ["HIT", "HIT", "MISS", "MISS", "HIT", "HIT", "HIT", "HIT"]
    for index, result in enumerate(results, start=1):
        update = engine.update(index * 500, 8.42, "rf-01", 0, 30, BeliefObservation("rf-01", result))
    observed = next(band for band in update.bands if band.bandId == "rf-01")
    assert observed.recentHits == 6
    assert observed.recentMisses == 2
    assert observed.observationHistory == results
    assert observed.changeLevel == "MEDIUM"


def test_model_observation_shape_and_bounds() -> None:
    observation = scheduler_observation(BeliefEngine().bands, 8.42, 20)
    assert observation.values.shape == (OBSERVATION_SIZE,)
    assert observation.values.dtype == np.float32
    assert np.isfinite(observation.values).all()
    assert np.all((observation.values >= 0) & (observation.values <= 1))


def test_reward_components_add_up_for_hit_and_miss() -> None:
    import pandas as pd
    from app.ml.scan_env import _reward_for_action

    row = pd.Series({"time_since_last_hit": 4000})
    for hit in (True, False):
        reward = _reward_for_action(row, action=4, previous_band=2, target_band=4, hit=hit)
        detection = 1.0 if hit else 0.0
        delay = 0.0008
        scan_cost = 0.08 + (2 * 240 / 8000) * 0.12
        miss = 0.0 if hit else 0.35
        staleness = (4000 / 12_000_000) * 0.12
        assert reward == pytest.approx(detection - delay - scan_cost - miss - staleness)


def test_api_scenario_load_start_stream_ticks_stop_and_disconnect(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    token = _operator_token(monkeypatch, client)
    headers = {"Authorization": f"Bearer {token}"}
    persisted: list[dict] = []
    monkeypatch.setattr("app.services.simulation.repository.record_scenario", lambda config: None)
    monkeypatch.setattr("app.services.simulation.repository.start_run", lambda *args: "test-run")
    monkeypatch.setattr("app.services.simulation.repository.stop_run", lambda *args: None)
    monkeypatch.setattr("app.services.simulation.repository.record_decision", lambda run_id, decision: persisted.append(decision))
    service = simulation_service
    service.command("reset")
    loaded = client.post("/scenario/load", headers=headers, json={"scenarioId": "adaptive-multi-emitter", "emitterCount": 3, "durationSeconds": 20, "seed": 41})
    assert loaded.status_code == 200
    started = client.post("/scenario/start", headers=headers)
    assert started.status_code == 200 and started.json()["simulationStatus"] == "RUNNING"
    try:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json({"type": "auth", "token": token})
            full = websocket.receive_json()
            assert full["type"] == "full_state" and full["version"] == 1
            assert "bandBeliefs" in full and "receiverState" in full
            assert set(full) - {"type", "version"} == set(client.get("/simulation/state").json())
            delta = websocket.receive_json()
            assert delta["type"] == "tick_delta" and delta["version"] == 1
            assert delta["sequence"] >= 1
            assert delta["simTime"] and delta.get("changedBands") and delta.get("newPdws") and delta.get("newDecision")
            assert persisted
            client.post("/scenario/pause", headers=headers)
    finally:
        service.command("reset")
    assert service.status == "PAUSED"


def _observe_run(client: TestClient, token: str, two_clients: bool) -> tuple[int, int]:
    headers = {"Authorization": f"Bearer {token}"}
    service = simulation_service
    service.command("reset")
    client.post("/scenario/load", headers=headers, json={"scenarioId": "adaptive-multi-emitter", "emitterCount": 2, "durationSeconds": 60, "seed": 9})
    client.post("/scenario/start", headers=headers)
    with client.websocket_connect("/ws/stream") as first:
        first.send_json({"type": "auth", "token": token})
        first.receive_json()  # Consume the initial snapshot (or the old implementation's first tick).
        second = None
        try:
            if two_clients:
                second = client.websocket_connect("/ws/stream")
                second.__enter__()
                second.send_json({"type": "auth", "token": token})
                second.receive_json()
            clock_start = service.now_ms
            started = time.monotonic()
            tick_count = 0
            while time.monotonic() - started < 3.2:
                message = first.receive_json()
                if message.get("type") in {"tick", "tick_delta"}:
                    tick_count += 1
                if second is not None and time.monotonic() - started >= 1.6:
                    second.close()
                    second.__exit__(None, None, None)
                    second = None
            elapsed_ms = int(service.now_ms - clock_start)
            client.post("/scenario/pause", headers=headers)
            first.close()
            return tick_count, elapsed_ms
        finally:
            if second is not None:
                second.close()
                second.__exit__(None, None, None)
            if service.status == "RUNNING":
                client.post("/scenario/pause", headers=headers)
            service.command("reset")


def test_shared_clock_is_independent_of_websocket_client_count(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    token = _operator_token(monkeypatch, client)
    monkeypatch.setattr("app.services.simulation.repository.record_scenario", lambda config: None)
    monkeypatch.setattr("app.services.simulation.repository.start_run", lambda *args: "shared-clock-test")
    monkeypatch.setattr("app.services.simulation.repository.stop_run", lambda *args: None)
    monkeypatch.setattr("app.services.simulation.repository.record_decision", lambda *args: None)
    two_client_ticks, two_client_ms = _observe_run(client, token, two_clients=True)
    single_client_ticks, single_client_ms = _observe_run(client, token, two_clients=False)
    assert two_client_ticks >= 2 and single_client_ticks >= 2
    assert abs(two_client_ticks - single_client_ticks) <= 1
    assert abs(two_client_ms - single_client_ms) <= 500


def test_steady_state_delta_serialization_is_smaller_than_full_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.simulation.repository.record_scenario", lambda config: None)
    monkeypatch.setattr("app.services.simulation.repository.stop_run", lambda *args: None)
    service = simulation_service
    service.command("reset")
    before = service.update.bands
    previous_bands = {band.bandId: band.model_dump(by_alias=True) for band in before}
    next_update = service.engine.update(500, service.receiver_frequency_ghz, service.current_band_id, 0, service.retune_budget)
    current_bands = [band.model_dump(by_alias=True) for band in next_update.bands]
    full_state = {"type": "full_state", "version": 1, **service.get_state().model_dump(by_alias=True)}
    receiver = service.get_state().receiverState.model_dump(by_alias=True)
    decision = service.get_decision().model_dump(by_alias=True)
    delta = {"type": "tick_delta", "version": 1, "sequence": 1, **build_tick_delta("04:11:52.584Z", previous_bands, current_bands, receiver, receiver, decision=decision)}
    full_bytes = len(json.dumps(full_state, separators=(",", ":")).encode())
    delta_bytes = len(json.dumps(delta, separators=(",", ":")).encode())
    assert "newPdws" not in delta and "newDecision" in delta and "newAlerts" not in delta and "receiverState" not in delta
    assert delta_bytes < full_bytes * 0.6


def test_inference_failure_returns_flagged_deterministic_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    service = simulation_service
    monkeypatch.setattr(service, "policy_mode", PolicyMode.TRAINED)
    monkeypatch.setattr(service.inference, "model", object())
    monkeypatch.setattr(service.inference, "predict_action", lambda observation: (_ for _ in ()).throw(RuntimeError("simulated failure")))
    decision = service.get_decision()
    assert decision.policyMode == "DETERMINISTIC_FALLBACK"
    assert decision.safetyOverride
    assert decision.fallbackReason == "Policy inference error: RuntimeError"


def test_frontend_backend_seeded_belief_replay_reproducibility() -> None:
    """Replay the same seeded scenario trace through the TS frontend and Python port."""
    repo = Path(__file__).resolve().parents[2]
    script = r"""
import { createInitialBeliefs, updateBeliefs } from './src/simulation/beliefEngine.ts';
import { random01 } from './src/simulation/engine.ts';
const scenario = { scenarioId: 'adaptive-multi-emitter', seed: 7419, durationSeconds: 120 };
const rng = { value: scenario.seed >>> 0 };
let bands = createInitialBeliefs(2, 18);
const trace = [];
for (let step = 1; step <= 40; step++) {
  const result = random01(rng) < 0.63 ? 'HIT' : 'MISS';
  trace.push(result);
  bands = updateBeliefs(bands, step * 500, 8.42, 'rf-01', 0, 30, { bandId: 'rf-01', result }).bands;
}
console.log(JSON.stringify({ scenario, trace, bands: bands.map(({bandId, activityProbability, uncertainty, observationValue, recentHits, recentMisses}) => ({bandId, activityProbability, uncertainty, observationValue, recentHits, recentMisses})) }));
"""
    completed = subprocess.run(["node", "--experimental-strip-types", "--input-type=module", "-e", script], cwd=repo, check=True, capture_output=True, text=True)
    frontend = __import__("json").loads(completed.stdout)
    assert frontend["scenario"] == {"scenarioId": "adaptive-multi-emitter", "seed": 7419, "durationSeconds": 120}
    engine = BeliefEngine()
    update = None
    for step, result in enumerate(frontend["trace"], start=1):
        update = engine.update(step * 500, 8.42, "rf-01", 0, 30, BeliefObservation("rf-01", result))
    backend = {band.bandId: band for band in update.bands}
    for band in frontend["bands"]:
        expected = backend[band["bandId"]]
        assert band["activityProbability"] == pytest.approx(expected.activityProbability, abs=1e-12)
        assert band["uncertainty"] == pytest.approx(expected.uncertainty, abs=1e-12)
        assert band["observationValue"] == expected.observationValue
        assert (band["recentHits"], band["recentMisses"]) == (expected.recentHits, expected.recentMisses)
