from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import f1_score, precision_score, recall_score

FEATURE_COLUMNS = ["frequency_delta", "aoa_delta", "pri_delta", "amplitude_delta", "pw_delta", "toa_delta"]


@dataclass(frozen=True, slots=True)
class ModelMetrics:
    precision: float
    recall: float
    f1: float


def pair_features(rows: pd.DataFrame, max_gap: int = 8) -> tuple[np.ndarray, np.ndarray]:
    ordered = rows.sort_values("toa_us", kind="stable").reset_index(drop=True)
    if len(ordered) < 2:
        return np.empty((0, len(FEATURE_COLUMNS))), np.empty(0, dtype=int)
    pairs = pair_indices(len(ordered), max_gap)
    return _features_for_pairs(ordered, pairs), np.asarray([ordered.iloc[left]["emitter_id"] == ordered.iloc[right]["emitter_id"] for left, right in pairs], dtype=int)


def pair_indices(length: int, max_gap: int = 8) -> list[tuple[int, int]]:
    return [(left, right) for left in range(length) for right in range(left + 1, min(length, left + max_gap + 1))]


def _features_for_pairs(ordered: pd.DataFrame, pairs: list[tuple[int, int]]) -> np.ndarray:
    left = ordered.iloc[[pair[0] for pair in pairs]]
    right = ordered.iloc[[pair[1] for pair in pairs]]
    return np.column_stack([
        np.abs(right["frequency_mhz"].to_numpy() - left["frequency_mhz"].to_numpy()) / 100.0,
        np.abs(right["aoa_deg"].to_numpy() - left["aoa_deg"].to_numpy()) / 180.0,
        np.abs(right["pri_us"].fillna(0).to_numpy() - left["pri_us"].fillna(0).to_numpy()) / 1000.0,
        np.abs(right["amplitude_db"].to_numpy() - left["amplitude_db"].to_numpy()) / 20.0,
        np.abs(right["pulse_width_us"].to_numpy() - left["pulse_width_us"].to_numpy()) / 20.0,
        np.abs(right["toa_us"].to_numpy() - left["toa_us"].to_numpy()) / 1000.0,
    ])


def train_model(dataset_a_path: Path, checkpoint_path: Path) -> ModelMetrics:
    frame = pd.read_parquet(dataset_a_path)
    feature_parts: list[np.ndarray] = []
    label_parts: list[np.ndarray] = []
    for _, train in frame.groupby(["receiver_mode", "pulse_train_id"], sort=False):
        features, labels = pair_features(train)
        feature_parts.append(features)
        label_parts.append(labels)
    features = np.vstack(feature_parts)
    labels = np.concatenate(label_parts)
    model = HistGradientBoostingClassifier(max_iter=120, learning_rate=0.08, max_leaf_nodes=15, random_state=42)
    class_counts = np.bincount(labels, minlength=2)
    sample_weights = np.asarray([1.0 / max(1, class_counts[label]) for label in labels], dtype=float)
    sample_weights *= len(labels) / sample_weights.sum()
    model.fit(features, labels, sample_weight=sample_weights)
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model_version": "pairwise-hgb-v1", "features": FEATURE_COLUMNS, "model": model}, checkpoint_path)
    predictions = model.predict(features)
    return ModelMetrics(precision=float(precision_score(labels, predictions, zero_division=0)), recall=float(recall_score(labels, predictions, zero_division=0)), f1=float(f1_score(labels, predictions, zero_division=0)))


def load_model(checkpoint_path: Path):
    return joblib.load(checkpoint_path)["model"]


def pairwise_cluster(rows: pd.DataFrame, model, threshold: float = 0.5) -> np.ndarray:
    input_positions = {index: position for position, index in enumerate(rows.index)}
    ordered = rows.sort_values("toa_us", kind="stable").reset_index()
    if len(ordered) == 0:
        return np.empty(0, dtype=int)
    parent = list(range(len(ordered)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    pairs = pair_indices(len(ordered), max_gap=8)
    features = _features_for_pairs(ordered.assign(emitter_id=ordered["emitter_id"]), pairs)
    probabilities = model.predict_proba(features)[:, 1] if len(features) else np.empty(0)
    for (left, right), probability in zip(pairs, probabilities):
        if probability >= threshold:
            union(left, right)
    roots = {root: cluster for cluster, root in enumerate(sorted({find(index) for index in range(len(parent))}))}
    clustered = np.asarray([roots[find(index)] for index in range(len(parent))], dtype=int)
    result = np.empty(len(clustered), dtype=int)
    result[[input_positions[index] for index in ordered["index"]]] = clustered
    return result