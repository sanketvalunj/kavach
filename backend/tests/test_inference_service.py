from pathlib import Path

from app.core.config import PolicyMode
from app.services.simulation import simulation_service


def test_trained_decision_has_model_metadata_or_safe_fallback() -> None:
    original_mode = simulation_service.policy_mode
    original_budget = simulation_service.retunes_in_window
    try:
        simulation_service.policy_mode = PolicyMode.TRAINED
        simulation_service.retunes_in_window = 0
        decision = simulation_service.get_decision()
        assert decision.policyMode in {"TRAINED", "DETERMINISTIC_FALLBACK"}
        assert decision.policyVersion
        assert decision.inferenceLatencyMs >= 0
        assert 0 <= decision.policyConfidence <= 1
    finally:
        simulation_service.policy_mode = original_mode
        simulation_service.retunes_in_window = original_budget


def test_exhausted_budget_forces_safety_fallback() -> None:
    original_mode = simulation_service.policy_mode
    original_budget = simulation_service.retunes_in_window
    try:
        simulation_service.policy_mode = PolicyMode.TRAINED
        simulation_service.retunes_in_window = simulation_service.retune_budget
        decision = simulation_service.get_decision()
        assert decision.policyMode == "DETERMINISTIC_FALLBACK"
        assert decision.safetyOverride is True
    finally:
        simulation_service.policy_mode = original_mode
        simulation_service.retunes_in_window = original_budget