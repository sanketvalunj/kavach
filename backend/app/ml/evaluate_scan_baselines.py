import argparse
from pathlib import Path

from .scan_baselines import POLICIES, rollout_policy
from .scan_env import ScanSchedulingEnv


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate deterministic scan policies on Dataset B.")
    parser.add_argument("--dataset-b", type=Path, default=Path("data/processed/dataset_b/v1/train.parquet"))
    parser.add_argument("--report", type=Path, default=Path("data/reports/scan_baselines.md"))
    parser.add_argument("--episodes", type=int, default=5)
    args = parser.parse_args()
    lines = ["# Scan Scheduler Baselines", "", f"Dataset: `{args.dataset_b}`", "", "| Policy | Episode rewards | Mean reward |", "|---|---|---:|"]
    for name, policy in POLICIES.items():
        rewards = rollout_policy(ScanSchedulingEnv(args.dataset_b, max_episode_steps=32), policy, episodes=args.episodes, seed=7419)
        lines.append(f"| {name} | {', '.join(f'{reward:.4f}' for reward in rewards)} | {sum(rewards) / len(rewards):.4f} |")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text("\n".join(lines) + "\n")
    print(args.report)


if __name__ == "__main__":
    main()