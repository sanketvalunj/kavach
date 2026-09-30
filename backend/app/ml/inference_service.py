import logging
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..models import SchedulerState

logger = logging.getLogger(__name__)
BAND_COUNT = 75
FEATURES_PER_BAND = 6
OBSERVATION_SIZE = BAND_COUNT * FEATURES_PER_BAND + 4


@dataclass(frozen=True, slots=True)
class SchedulerObservation:
    values: np.ndarray
    current_band: int
    remaining_budget: int


@dataclass(frozen=True, slots=True)
class ActionResult:
    action: int
    confidence: float
    log_probability: float
    latency_ms: float
    model_version: str
    safety_override: bool = False


class InferenceService:
    def __init__(self, checkpoint: str | Path | None = None) -> None:
        self.checkpoint = Path(checkpoint) if checkpoint else None
        self.model = None
        self.model_version = "unavailable"
        self.checkpoint_status = "missing"
        if self.checkpoint and self.checkpoint.exists():
            try:
                from stable_baselines3 import PPO
                self.model = PPO.load(self.checkpoint)
                self.model_version = f"{self.checkpoint.parent.name}:{self.checkpoint.stem}"
                self.checkpoint_status = "loaded"
            except Exception:
                self.checkpoint_status = "failed"
                logger.exception("Unable to load PPO checkpoint %s", self.checkpoint)

    @property
    def available(self) -> bool:
        return self.model is not None

    def predict_action(self, observation: SchedulerObservation) -> ActionResult:
        started = time.perf_counter()
        if self.model is None:
            raise RuntimeError("No trained policy checkpoint is loaded")
        values = np.asarray(observation.values, dtype=np.float32)
        if values.shape != (OBSERVATION_SIZE,):
            raise ValueError(f"Expected scheduler observation shape {(OBSERVATION_SIZE,)}, got {values.shape}")
        action_array, _ = self.model.predict(values, deterministic=True)
        action = int(np.asarray(action_array).reshape(-1)[0])
        confidence, log_probability = self._distribution_stats(values, action)
        return ActionResult(action, confidence, log_probability, (time.perf_counter() - started) * 1000, self.model_version)

    def _distribution_stats(self, values: np.ndarray, action: int) -> tuple[float, float]:
        try:
            import torch
            tensor = torch.as_tensor(values[None], dtype=torch.float32, device=self.model.device)
            distribution = self.model.policy.get_distribution(tensor).distribution
            probability = float(distribution.probs[0, action].detach().cpu().item())
            return probability, math.log(max(probability, 1e-12))
        except Exception:
            return 0.0, 0.0


def scheduler_observation(bands: list[SchedulerState], receiver_frequency_ghz: float, remaining_budget: int, max_budget: int = 30) -> SchedulerObservation:
    activity = np.zeros(BAND_COUNT, dtype=np.float32)
    uncertainty = np.ones(BAND_COUNT, dtype=np.float32)
    recency = np.zeros(BAND_COUNT, dtype=np.float32)
    prediction = np.zeros(BAND_COUNT, dtype=np.float32)
    change = np.zeros(BAND_COUNT, dtype=np.float32)
    coverage = np.ones(BAND_COUNT, dtype=np.float32)
    for band in bands:
        center = (band.frequencyStartGHz + band.frequencyEndGHz) / 2 * 1000
        index = max(0, min(BAND_COUNT - 1, int(center // 240)))
        activity[index] = float(np.clip(band.activityProbability, 0, 1))
        uncertainty[index] = float(np.clip(band.uncertainty, 0, 1))
        recency[index] = float(np.clip(1 - band.timeSinceLastScanMs / 12_000, 0, 1))
        prediction[index] = float(np.clip(band.predictedActivity, 0, 1))
        change[index] = float(np.clip(band.changeLevelBoost, 0, 1))
        coverage[index] = {"FRESH": 0.0, "STALE": 0.5, "VERY_STALE": 1.0}[band.coverageStatus]
    values = np.column_stack((activity, uncertainty, recency, prediction, change, coverage)).reshape(-1)
    current_band = max(0, min(BAND_COUNT - 1, int(receiver_frequency_ghz * 1000 // 240)))
    global_state = np.asarray([current_band / (BAND_COUNT - 1), receiver_frequency_ghz / 18, remaining_budget / max_budget, 0], dtype=np.float32)
    return SchedulerObservation(np.concatenate((values, global_state)).astype(np.float32), current_band, remaining_budget)
