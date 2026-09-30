import argparse
from pathlib import Path

from stable_baselines3 import PPO

from .scan_env import ScanSchedulingEnv


def main() -> None:
    parser = argparse.ArgumentParser(description="Train PPO on the Dataset B scan scheduler environment.")
    parser.add_argument("--dataset-b", type=Path, default=Path("data/processed/dataset_b/v1/train.parquet"))
    parser.add_argument("--timesteps", type=int, default=10_000)
    parser.add_argument("--output", type=Path, default=Path("app/ml/checkpoints/scan_ppo_v1"))
    args = parser.parse_args()
    env = ScanSchedulingEnv(args.dataset_b)
    model = PPO("MlpPolicy", env, seed=7419, verbose=1, n_steps=128, batch_size=128)
    model.learn(total_timesteps=args.timesteps)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    model.save(args.output)
    print(f"saved={args.output}")


if __name__ == "__main__":
    main()