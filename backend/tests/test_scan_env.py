from pathlib import Path

import numpy as np

from app.ml.scan_baselines import POLICIES, rollout_policy
from app.ml.scan_env import BAND_COUNT, GLOBAL_FEATURES, BAND_FEATURES, ScanSchedulingEnv


DATASET_B = Path(__file__).parents[1] / "data/processed/dataset_b/v1/train.parquet"


def test_scan_env_reset_step_and_reproducibility() -> None:
    env = ScanSchedulingEnv(DATASET_B, max_episode_steps=8)
    first, _ = env.reset(seed=123, options={"start": 0})
    second, _ = env.reset(seed=123, options={"start": 0})
    assert env.observation_space.shape == (BAND_COUNT * BAND_FEATURES + GLOBAL_FEATURES,)
    assert np.array_equal(first, second)
    observation, reward, terminated, truncated, info = env.step(0)
    assert env.observation_space.contains(observation)
    assert np.isfinite(reward)
    assert isinstance(terminated, bool)
    assert isinstance(truncated, bool)
    assert "target_band" in info


def test_baselines_have_sane_reproducible_rollouts() -> None:
    for name, policy in POLICIES.items():
        first = rollout_policy(ScanSchedulingEnv(DATASET_B, max_episode_steps=12), policy, episodes=3)
        second = rollout_policy(ScanSchedulingEnv(DATASET_B, max_episode_steps=12), policy, episodes=3)
        assert len(first) == 3, name
        assert all(np.isfinite(value) for value in first), name
        assert first == second, name