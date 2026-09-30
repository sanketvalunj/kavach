from app.main import app
from app.services.belief_engine import BeliefEngine, BeliefObservation
from fastapi.testclient import TestClient


def test_initial_beliefs_match_frontend_shape() -> None:
    engine = BeliefEngine()
    assert len(engine.bands) == 32
    assert engine.bands[0].bandId == "rf-01"
    assert engine.bands[0].activityProbability == 0.05
    assert engine.bands[0].uncertainty == 1
    assert engine.bands[0].coverageStatus == "FRESH"


def test_hit_update_matches_frontend_formula() -> None:
    engine = BeliefEngine()
    result = engine.update(1000, 2.5, "rf-01", 0, 30, BeliefObservation("rf-01", "HIT"))
    observed = next(band for band in result.bands if band.bandId == "rf-01")
    assert observed.activityProbability == 0.221
    assert observed.uncertainty == 0.12
    assert observed.recentHits == 1
    assert observed.recentMisses == 0
    assert observed.timeSinceLastScanMs == 0


def test_stale_coverage_and_api_projection() -> None:
    engine = BeliefEngine()
    result = engine.update(20_000, 8.42, "rf-01", 0, 30)
    assert result.bands[0].coverageStatus == "VERY_STALE"
    client = TestClient(app)
    state = client.get("/simulation/state").json()
    decision = client.get("/scheduler/decision")
    assert decision.status_code == 401
    assert len(state["bandBeliefs"]) == 32
