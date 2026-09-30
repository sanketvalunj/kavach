import argparse
import json
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback

from .scan_baselines import POLICIES
from .scan_env import ScanSchedulingEnv

CONFIGURATIONS = {
    "PPO only": (False, False),
    "PPO + Temporal Intelligence": (True, False),
    "PPO + Change Detection": (False, True),
    "PPO + Temporal + Change Detection": (True, True),
    "Complete Smart Scan": (True, True),
}
METRICS = ("interception_rate", "average_interception_time", "recovery_time_after_change", "spectrum_staleness", "cumulative_reward")


def train_configuration(name: str, dataset_path: Path, output_dir: Path, tensorboard_dir: Path, timesteps: int) -> Path:
    temporal, change = CONFIGURATIONS[name]
    env = ScanSchedulingEnv(dataset_path, include_temporal=temporal, include_change=change, seed=7419)
    safe_name = name.lower().replace(" ", "_").replace("+", "and")
    checkpoint_dir = output_dir / safe_name
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    callback = CheckpointCallback(save_freq=max(128, min(10_000, timesteps // 2)), save_path=str(checkpoint_dir), name_prefix="ppo")
    model = PPO("MlpPolicy", env, seed=7419, verbose=0, n_steps=128, batch_size=128, tensorboard_log=str(tensorboard_dir))
    model.learn(total_timesteps=timesteps, tb_log_name=safe_name, callback=callback)
    final_path = checkpoint_dir / "final"
    model.save(final_path)
    return final_path


def evaluate_policy(name: str, dataset_path: Path, model_path: Path | None, episodes: int, seed: int) -> dict[str, dict[str, float]]:
    temporal, change = CONFIGURATIONS.get(name, (True, True))
    env = ScanSchedulingEnv(dataset_path, include_temporal=temporal, include_change=change, max_episode_steps=32)
    model = PPO.load(model_path, env=env) if model_path else None
    episode_values = {metric: [] for metric in METRICS}
    for episode in range(episodes):
        observation, _ = env.reset(seed=seed + episode)
        values = {metric: 0.0 for metric in METRICS}
        total_steps = 0
        hits = 0
        interception_times: list[float] = []
        recovery_times: list[float] = []
        done = False
        while not done:
            action = int(model.predict(observation, deterministic=True)[0]) if model else POLICIES[name](env, observation)
            observation, reward, terminated, truncated, info = env.step(action)
            total_steps += 1
            hits += int(info["hit"])
            values["cumulative_reward"] += reward
            values["spectrum_staleness"] += float(info["spectrum_staleness_ms"])
            if info["interception_time_ms"] is not None:
                interception_times.append(float(info["interception_time_ms"]))
            if info["recovery_time_ms"] is not None:
                recovery_times.append(float(info["recovery_time_ms"]))
            done = terminated or truncated
        values["interception_rate"] = hits / max(1, total_steps)
        values["average_interception_time"] = float(np.mean(interception_times)) if interception_times else 0.0
        values["recovery_time_after_change"] = float(np.mean(recovery_times)) if recovery_times else 0.0
        values["spectrum_staleness"] /= max(1, total_steps)
        for metric in METRICS:
            episode_values[metric].append(values[metric])
    return {metric: _summary(values) for metric, values in episode_values.items()}


def write_reports(results: dict[str, dict[str, dict[str, float]]], json_path: Path, markdown_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(results, indent=2) + "\n")
    lines = ["# PPO Scheduler Ablation Results", "", "All configurations use the same held-out Dataset B test split and seeded episodes. Cells show mean; variance; 95% CI.", "", "| Configuration | Interception rate | Avg interception time (ms) | Recovery after change (ms) | Spectrum staleness (ms) | Cumulative reward |", "|---|---|---|---|---|---|"]
    for name, metrics in results.items():
        lines.append(f"| {name} | {_cell(metrics['interception_rate'])} | {_cell(metrics['average_interception_time'])} | {_cell(metrics['recovery_time_after_change'])} | {_cell(metrics['spectrum_staleness'])} | {_cell(metrics['cumulative_reward'])} |")
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text("\n".join(lines) + "\n")


def _summary(values: list[float]) -> dict[str, float]:
    array = np.asarray(values, dtype=float)
    mean = float(array.mean()) if len(array) else 0.0
    variance = float(array.var(ddof=1)) if len(array) > 1 else 0.0
    ci = 1.96 * float(array.std(ddof=1)) / np.sqrt(len(array)) if len(array) > 1 else 0.0
    return {"mean": mean, "variance": variance, "ci95_low": mean - ci, "ci95_high": mean + ci, "episodes": float(len(array))}


def _cell(metric: dict[str, float]) -> str:
    return f"{metric['mean']:.4f}; var {metric['variance']:.4f}; CI [{metric['ci95_low']:.4f}, {metric['ci95_high']:.4f}]"


def main() -> None:
    parser = argparse.ArgumentParser(description="Train PPO scheduler ablations and evaluate real baselines.")
    parser.add_argument("--train-data", type=Path, default=Path("data/processed/dataset_b/v1/train.parquet"))
    parser.add_argument("--test-data", type=Path, default=Path("data/processed/dataset_b/v1/test.parquet"))
    parser.add_argument("--timesteps", type=int, default=2_048)
    parser.add_argument("--episodes", type=int, default=5)
    parser.add_argument("--seed", type=int, default=7419)
    parser.add_argument("--checkpoint-dir", type=Path, default=Path("app/ml/checkpoints/ppo_ablations"))
    parser.add_argument("--tensorboard-dir", type=Path, default=Path("data/tensorboard"))
    parser.add_argument("--report-dir", type=Path, default=Path("data/reports"))
    args = parser.parse_args()
    models: dict[str, Path] = {}
    for name in CONFIGURATIONS:
        models[name] = train_configuration(name, args.train_data, args.checkpoint_dir, args.tensorboard_dir, args.timesteps)
    results: dict[str, dict[str, dict[str, float]]] = {}
    for name, model_path in models.items():
        results[name] = evaluate_policy(name, args.test_data, model_path, args.episodes, args.seed)
    for name, policy in POLICIES.items():
        results[name] = evaluate_policy(name, args.test_data, None, args.episodes, args.seed)
    write_reports(results, args.report_dir / "ablation_results.json", args.report_dir / "ablation_results.md")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()