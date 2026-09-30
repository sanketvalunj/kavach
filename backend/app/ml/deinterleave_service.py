from collections.abc import Sequence
from pathlib import Path

from ..models import PDW
from .deinterleaving_baseline import cluster_pulses_dbscan


def cluster_pulses(pdws: Sequence[PDW], checkpoint: Path | None = None) -> list[dict[str, object]]:
    """Return the frontend's existing derived-cluster shape."""
    labels = cluster_pulses_dbscan(pdws) if checkpoint is None else _model_labels(pdws, checkpoint)
    clusters: dict[int, list[PDW]] = {}
    for pulse, label in zip(pdws, labels):
        clusters.setdefault(label, []).append(pulse)
    return [_cluster_record(index, observations) for index, observations in enumerate(clusters.values())]


def _model_labels(pdws: Sequence[PDW], checkpoint: Path) -> list[int]:
    from .deinterleaving_model import load_model
    import pandas as pd

    frame = pd.DataFrame([{
        "toa_us": _timestamp_us(pulse.timestamp), "frequency_mhz": pulse.centerFrequencyGHz * 1000,
        "aoa_deg": pulse.aoaDeg or 0, "pri_us": pulse.priMs * 1000, "amplitude_db": pulse.amplitudeDbm,
        "pulse_width_us": pulse.pulseWidthUs, "emitter_id": "unknown",
    } for pulse in pdws])
    from .deinterleaving_model import pairwise_cluster
    return pairwise_cluster(frame, load_model(checkpoint)).tolist()


def _cluster_record(index: int, observations: list[PDW]) -> dict[str, object]:
    ordered = sorted(observations, key=lambda pulse: _timestamp_us(pulse.timestamp))
    frequencies = [pulse.centerFrequencyGHz for pulse in observations]
    intervals = [_timestamp_us(right.timestamp) - _timestamp_us(left.timestamp) for left, right in zip(ordered, ordered[1:])]
    mean_pri_ms = sum(intervals) / len(intervals) / 1000 if intervals else ordered[0].priMs
    return {
        "id": f"Scenario Emitter {index + 1:02d}", "observations": list(observations), "firstSeen": ordered[0].timestamp,
        "centerFrequencyGHz": sum(frequencies) / len(frequencies), "frequencyMinGHz": min(frequencies), "frequencyMaxGHz": max(frequencies),
        "aoaDeg": sum((pulse.aoaDeg or 0) for pulse in observations) / len(observations), "estimatedPriMs": mean_pri_ms,
        "activityPercent": min(100, len(observations) * 12), "patternType": _pattern(ordered, intervals),
        "statusTone": "teal" if len(observations) >= 4 else "amber", "frequencyHistoryGHz": [pulse.centerFrequencyGHz for pulse in ordered],
        "activityHistory": [min(100, (position + 1) * 12) for position in range(len(ordered))],
        "trace": [{"t": (_timestamp_us(pulse.timestamp) - _timestamp_us(ordered[0].timestamp)) / 1_000_000, "freq": pulse.centerFrequencyGHz, "strength": pulse.amplitudePercent} for pulse in ordered],
    }


def _timestamp_us(timestamp: str) -> float:
    parts = timestamp.replace("Z", "").split(":")
    return (int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])) * 1_000_000


def _pattern(ordered: list[PDW], intervals: list[float]) -> str:
    frequencies = [pulse.centerFrequencyGHz for pulse in ordered]
    if max(frequencies) - min(frequencies) > 0.05:
        return "Frequency Agile"
    if len(intervals) >= 3:
        mean = sum(intervals) / len(intervals)
        variation = (sum((value - mean) ** 2 for value in intervals) / len(intervals)) ** 0.5 / mean if mean else 1
        if variation < 0.22:
            return "Periodic"
        if variation > 0.55:
            return "Intermittent"
    return "Stable"