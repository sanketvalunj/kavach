from pathlib import Path

import gymnasium as gym
import numpy as np
import pandas as pd
from gymnasium import spaces

from ..data.scheduler_dataset import BAND_WIDTH_MHZ, SCAN_MAX_MHZ

BAND_COUNT = int(SCAN_MAX_MHZ // BAND_WIDTH_MHZ)
BAND_FEATURES = 6
GLOBAL_FEATURES = 4


class ScanSchedulingEnv(gym.Env[np.ndarray, int]):
    """Discrete band-selection environment backed by Dataset B replay rows."""

    metadata = {"render_modes": []}

    def __init__(self, dataset_path: str | Path, max_episode_steps: int = 128, seed: int | None = None, include_temporal: bool = True, include_change: bool = True) -> None:
        super().__init__()
        self.dataset_path = Path(dataset_path)
        self.rows = pd.read_parquet(self.dataset_path).reset_index(drop=True)
        if self.rows.empty:
            raise ValueError(f"Dataset B is empty: {self.dataset_path}")
        self.max_episode_steps = max_episode_steps
        self.include_temporal = include_temporal
        self.include_change = include_change
        self.action_space = spaces.Discrete(BAND_COUNT)
        self.observation_space = spaces.Box(0.0, 1.0, shape=(BAND_COUNT * BAND_FEATURES + GLOBAL_FEATURES,), dtype=np.float32)
        self._rng = np.random.default_rng(seed)
        self._episode_start = 0
        self._cursor = 0
        self._steps = 0
        self._current_band = 0
        self._previous_frequency = 0.0
        self._remaining_budget = 30
        self._band_activity = np.zeros(BAND_COUNT, dtype=np.float32)
        self._band_uncertainty = np.ones(BAND_COUNT, dtype=np.float32)
        self._band_recency = np.zeros(BAND_COUNT, dtype=np.float32)
        self._band_prediction = np.zeros(BAND_COUNT, dtype=np.float32)
        self._band_change = np.zeros(BAND_COUNT, dtype=np.float32)
        self._band_coverage = np.ones(BAND_COUNT, dtype=np.float32)
        self._successes = np.ones(BAND_COUNT, dtype=np.float32)
        self._failures = np.ones(BAND_COUNT, dtype=np.float32)

    def reset(self, *, seed: int | None = None, options: dict | None = None) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        if seed is not None:
            self._rng = np.random.default_rng(seed)
            self.action_space.seed(seed)
        options = options or {}
        self._episode_start = int(options.get("start", self._rng.integers(0, max(1, len(self.rows) - 1))))
        self._episode_start = min(self._episode_start, len(self.rows) - 1)
        self._cursor = self._episode_start
        self._steps = 0
        self._current_band = 0
        self._previous_frequency = 0.0
        self._remaining_budget = 30
        self._band_activity.fill(0)
        self._band_uncertainty.fill(1)
        self._band_recency.fill(0)
        self._band_prediction.fill(0)
        self._band_change.fill(0)
        self._band_coverage.fill(1)
        self._successes.fill(1)
        self._failures.fill(1)
        self._load_replay_features()
        return self._observation(), {"cursor": self._cursor}

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        action = int(action)
        row = self.rows.iloc[self._cursor]
        target_band = _action_band(row["action"])
        hit = action == target_band
        reward = _reward_for_action(row, action, self._current_band, target_band, hit)
        self._successes[action] += float(hit)
        self._failures[action] += float(not hit)
        self._update_beliefs(row, action, hit)
        self._previous_frequency = self._current_band * BAND_WIDTH_MHZ + BAND_WIDTH_MHZ / 2
        self._current_band = action
        self._remaining_budget = max(0, self._remaining_budget - 1)
        self._cursor += 1
        self._steps += 1
        if not (terminated := self._cursor >= len(self.rows)):
            self._load_replay_features()
        truncated = self._steps >= self.max_episode_steps or self._remaining_budget == 0
        info = {
            "target_band": target_band, "hit": hit, "time_slot": int(row["time_slot"]),
            "interception_time_ms": float(row["time_since_last_hit"]) / 1000 if hit else None,
            "recovery_time_ms": float(row["time_since_last_hit"]) / 1000 if bool(row["frequency_hop_detected"]) and hit else None,
            "spectrum_staleness_ms": float(row["time_since_last_hit"]),
        }
        return self._observation(), float(reward), terminated, truncated, info

    def _load_replay_features(self) -> None:
        row = self.rows.iloc[self._cursor]
        target_band = _action_band(row["action"])
        self._band_prediction[target_band] = float(np.clip(row["estimated_activity"], 0, 1)) if self.include_temporal else 0.0
        self._band_change[target_band] = float(bool(row["frequency_hop_detected"])) if self.include_change else 0.0

    def _update_beliefs(self, row: pd.Series, action: int, hit: bool) -> None:
        self._band_activity[action] = np.clip(0.82 * self._band_activity[action] + (0.18 if hit else 0), 0, 1)
        self._band_uncertainty[action] = 0.12 if hit else min(1, self._band_uncertainty[action] * 0.94)
        self._band_recency[action] = 1.0
        self._band_prediction[action] = float(np.clip(row["estimated_activity"], 0, 1))
        self._band_change[action] = float(bool(row["frequency_hop_detected"]))
        self._band_coverage[action] = 0.0
        self._band_recency = np.maximum(0, self._band_recency - 0.05)
        self._band_coverage = np.minimum(1, self._band_coverage + 0.02)

    def _observation(self) -> np.ndarray:
        temporal_recency = self._band_recency if self.include_temporal else np.zeros_like(self._band_recency)
        temporal_prediction = self._band_prediction if self.include_temporal else np.zeros_like(self._band_prediction)
        change = self._band_change if self.include_change else np.zeros_like(self._band_change)
        features = np.column_stack((self._band_activity, self._band_uncertainty, temporal_recency, temporal_prediction, change, self._band_coverage)).reshape(-1)
        global_state = np.asarray([self._current_band / max(1, BAND_COUNT - 1), self._previous_frequency / SCAN_MAX_MHZ, self._remaining_budget / 30, self._steps / max(1, self.max_episode_steps)], dtype=np.float32)
        return np.concatenate((features, global_state)).astype(np.float32)


def _action_band(action: object) -> int:
    try:
        return max(0, min(BAND_COUNT - 1, int(str(action).split("_")[-1])))
    except (ValueError, AttributeError):
        return 0


def _reward_for_action(row: pd.Series, action: int, previous_band: int, target_band: int, hit: bool) -> float:
    detection_benefit = 1.0 if hit else 0.0
    delay_penalty = min(0.35, max(0.0, float(row["time_since_last_hit"]) / 1000.0) / 5000.0)
    scan_cost = 0.08 + min(1.0, abs(action - previous_band) * BAND_WIDTH_MHZ / 8_000.0) * 0.12
    miss_penalty = 0.0 if hit else 0.35
    staleness_penalty = min(1.0, max(0.0, float(row["time_since_last_hit"])) / 12_000_000.0) * 0.12
    return detection_benefit - delay_penalty - scan_cost - miss_penalty - staleness_penalty