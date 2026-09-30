import argparse
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import adjusted_rand_score, f1_score, precision_score, recall_score

from .deinterleaving_baseline import cluster_rows_dbscan
from .deinterleaving_model import load_model, pair_features, pair_indices, pairwise_cluster, train_model


def frontend_heuristic(rows: pd.DataFrame) -> np.ndarray:
    rows = rows.reset_index(drop=True)
    ordered = rows.sort_values("toa_us", kind="stable")
    clusters: list[dict[str, object]] = []
    for index in reversed(ordered.index.tolist()):
        row = rows.loc[index]
        match = next((cluster for cluster in clusters if abs(float(row.frequency_mhz) - float(cluster["frequency_mhz"])) <= 150 and _angle_distance(float(row.aoa_deg), float(cluster["aoa_deg"])) <= 25), None)
        if match is None:
            clusters.append({"frequency_mhz": float(row.frequency_mhz), "aoa_deg": float(row.aoa_deg), "indices": [index]})
        else:
            match["indices"].append(index)
            match["frequency_mhz"] = float(row.frequency_mhz)
            match["aoa_deg"] = float(row.aoa_deg)
    assignments = np.empty(len(rows), dtype=int)
    for cluster_id, cluster in enumerate(clusters):
        assignments[cluster["indices"]] = cluster_id
    return assignments


def evaluate(dataset_a_path: Path, checkpoint_path: Path) -> dict[str, dict[str, float]]:
    frame = pd.read_parquet(dataset_a_path)
    model = load_model(checkpoint_path)
    results: dict[str, dict[str, float]] = {}
    for name in ("frontend_heuristic", "dbscan", "trained_model"):
        ari_values: list[float] = []
        precision_values: list[float] = []
        recall_values: list[float] = []
        f1_values: list[float] = []
        for _, train in frame.groupby(["receiver_mode", "pulse_train_id"], sort=False):
            truth = pd.factorize(train["emitter_id"])[0]
            if name == "frontend_heuristic":
                predicted = frontend_heuristic(train)
            elif name == "dbscan":
                predicted = cluster_rows_dbscan(train)
            else:
                predicted = pairwise_cluster(train, model)
            ari_values.append(float(adjusted_rand_score(truth, predicted)))
            pair_x, pair_y = pair_features(train)
            if len(pair_y):
                if name == "trained_model":
                    pair_predicted = model.predict(pair_x)
                else:
                    order = train.sort_values("toa_us", kind="stable").index.to_numpy()
                    ordered_predicted = predicted[train.index.get_indexer(order)]
                    pair_predicted = np.asarray([ordered_predicted[left] == ordered_predicted[right] for left, right in pair_indices(len(ordered_predicted))], dtype=int)
                precision_values.append(float(precision_score(pair_y, pair_predicted, zero_division=0)))
                recall_values.append(float(recall_score(pair_y, pair_predicted, zero_division=0)))
                f1_values.append(float(f1_score(pair_y, pair_predicted, zero_division=0)))
        results[name] = {"ari": _mean(ari_values), "precision": _mean(precision_values), "recall": _mean(recall_values), "f1": _mean(f1_values)}
    return results


def write_report(results: dict[str, dict[str, float]], output_path: Path, checkpoint_path: Path, test_path: Path, validation_results: dict[str, dict[str, float]] | None = None) -> None:
    lines = ["# Deinterleaving Evaluation", "", f"- Test split: `{test_path}`", f"- Checkpoint: `{checkpoint_path}`", "- Labels are evaluated only within each `(receiver_mode, pulse_train_id)`."]
    if validation_results is not None:
        lines.extend(["", "## Validation split", "", "| Method | ARI | Pair precision | Pair recall | Pair F1 |", "|---|---:|---:|---:|---:|"])
        for method, values in validation_results.items():
            lines.append(f"| {method} | {values['ari']:.4f} | {values['precision']:.4f} | {values['recall']:.4f} | {values['f1']:.4f} |")
    lines.extend(["", "## Held-out test split", "", "| Method | ARI | Pair precision | Pair recall | Pair F1 |", "|---|---:|---:|---:|---:|"])
    for method, values in results.items():
        lines.append(f"| {method} | {values['ari']:.4f} | {values['precision']:.4f} | {values['recall']:.4f} | {values['f1']:.4f} |")
    baseline = results["frontend_heuristic"]["ari"]
    model = results["trained_model"]["ari"]
    lines.extend(["", f"Trained-model ARI delta versus frontend heuristic: **{model - baseline:+.4f}**.", "A positive delta is required before claiming improvement; this report does not manufacture a pass when the held-out result is non-positive."])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and evaluate the deinterleaving model on Dataset A.")
    parser.add_argument("--dataset-a", type=Path, default=Path("data/processed/dataset_a/v1"))
    parser.add_argument("--checkpoint-dir", type=Path, default=Path("app/ml/checkpoints"))
    parser.add_argument("--report", type=Path, default=Path("data/reports/deinterleaving_eval.md"))
    args = parser.parse_args()
    train_path = args.dataset_a / "train.parquet"
    validation_path = args.dataset_a / "validation.parquet"
    test_path = args.dataset_a / "test.parquet"
    checkpoint = args.checkpoint_dir / f"deinterleaving_pairwise_{date.today().isoformat()}.joblib"
    print("train_metrics", train_model(train_path, checkpoint))
    validation_results = evaluate(validation_path, checkpoint)
    results = evaluate(test_path, checkpoint)
    write_report(results, args.report, checkpoint, test_path, validation_results)
    print("validation", validation_results)
    print(results)


def _angle_distance(left: float, right: float) -> float:
    return abs((left - right + 180) % 360 - 180)


def _mean(values: list[float]) -> float:
    return float(sum(values) / len(values)) if values else 0.0


if __name__ == "__main__":
    main()