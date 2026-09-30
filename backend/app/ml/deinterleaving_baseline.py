from collections.abc import Sequence

import numpy as np
from sklearn.cluster import DBSCAN

from ..models import PDW


def cluster_pulses_dbscan(pdws: Sequence[PDW], eps: float = 1.2, min_samples: int = 2) -> list[int]:
    """Cluster one train with normalized frequency, circular AoA, and PRI."""
    if not pdws:
        return []
    frequencies = np.asarray([pulse.centerFrequencyGHz * 1000.0 for pulse in pdws], dtype=float)
    aoa = np.deg2rad(np.asarray([pulse.aoaDeg or 0.0 for pulse in pdws], dtype=float))
    pri = np.asarray([pulse.priMs for pulse in pdws], dtype=float)
    feature_matrix = np.column_stack([
        frequencies / 50.0,
        np.sin(aoa),
        np.cos(aoa),
        np.log1p(np.maximum(pri, 0.0)) / 2.0,
    ])
    labels = DBSCAN(eps=eps, min_samples=min_samples, metric="euclidean").fit_predict(feature_matrix)
    return labels.astype(int).tolist()


def cluster_rows_dbscan(rows, eps: float = 1.2, min_samples: int = 2) -> np.ndarray:
    """Dataset-A equivalent used by offline evaluation."""
    if len(rows) == 0:
        return np.empty(0, dtype=int)
    aoa = np.deg2rad(rows["aoa_deg"].to_numpy(dtype=float))
    features = np.column_stack([
        rows["frequency_mhz"].to_numpy(dtype=float) / 50.0,
        np.sin(aoa), np.cos(aoa),
        np.log1p(np.maximum(rows["pri_us"].fillna(0).to_numpy(dtype=float), 0.0)) / 2000.0,
    ])
    return DBSCAN(eps=eps, min_samples=min_samples).fit_predict(features)