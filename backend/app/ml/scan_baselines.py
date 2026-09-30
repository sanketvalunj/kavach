from collections.abc import Callable

import numpy as np

from .scan_env import ScanSchedulingEnv

Policy = Callable[[ScanSchedulingEnv, np.ndarray], int]


def sequential_policy(env: ScanSchedulingEnv, observation: np.ndarray) -> int:
    return env._steps % env.action_space.n


def greedy_activity_policy(env: ScanSchedulingEnv, observation: np.ndarray) -> int:
    return int(np.argmax(env._band_activity + env._band_prediction))


def random_policy(env: ScanSchedulingEnv, observation: np.ndarray) -> int:
    return int(env.action_space.sample())


def thompson_policy(env: ScanSchedulingEnv, observation: np.ndarray) -> int:
    return int(np.argmax(env._rng.beta(env._successes, env._failures)))


POLICIES: dict[str, Policy] = {
    "Sequential Sweep": sequential_policy,
    "Greedy Activity": greedy_activity_policy,
    "Random": random_policy,
    "Thompson Sampling": thompson_policy,
}


def rollout_policy(env: ScanSchedulingEnv, policy: Policy, episodes: int = 5, seed: int = 7419) -> list[float]:
    rewards: list[float] = []
    for episode in range(episodes):
        observation, _ = env.reset(seed=seed + episode)
        total = 0.0
        done = False
        while not done:
            action = policy(env, observation)
            observation, reward, terminated, truncated, _ = env.step(action)
            total += reward
            done = terminated or truncated
        rewards.append(total)
    return rewards