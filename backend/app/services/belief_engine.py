from dataclasses import dataclass

from ..models import SchedulerState

BELIEF_WEIGHTS = {
    "activityProbability": 0.28,
    "uncertainty": 0.22,
    "predictedActivityBoost": 0.20,
    "stalenessFactor": 0.15,
    "changeLevelBoost": 0.15,
    "scanCost": 0.12,
}
BAND_COUNT = 32
HISTORY_LENGTH = 20
TIMING_HISTORY_LENGTH = 8
STALE_AFTER_MS = 8_000
VERY_STALE_AFTER_MS = 18_000
PREDICTION_WINDOW_MS = 1_500


@dataclass(frozen=True, slots=True)
class BeliefObservation:
    band_id: str
    result: str


@dataclass(frozen=True, slots=True)
class BeliefUpdate:
    bands: list[SchedulerState]
    next_band: SchedulerState
    budget_exhausted: bool


class BeliefEngine:
    """Authoritative Python port of the frontend Phase 2 belief engine."""

    def __init__(self, min_frequency_ghz: float = 2, max_frequency_ghz: float = 18) -> None:
        self.bands = create_initial_beliefs(min_frequency_ghz, max_frequency_ghz)

    def update(
        self,
        now_ms: float,
        receiver_frequency_ghz: float,
        current_band_id: str,
        retunes_in_window: int,
        retune_budget: int,
        observation: BeliefObservation | None = None,
    ) -> BeliefUpdate:
        observed_id = observation.band_id if observation else None
        updated = [
            _update_band(
                band,
                now_ms,
                receiver_frequency_ghz,
                observation.result if observed_id == band.bandId else None,
            )
            for band in self.bands
        ]
        budget_exhausted = retunes_in_window >= retune_budget
        feasible = [] if budget_exhausted else [band for band in updated if band.bandId != current_band_id]
        ranked = sorted(updated, key=lambda band: band.observationValue, reverse=True)
        next_band = (
            sorted(feasible, key=lambda band: band.observationValue, reverse=True)[0]
            if feasible
            else next((band for band in updated if band.bandId == current_band_id), ranked[0])
        )
        self.bands = [
            band.model_copy(update={"rank": rank, "queueStatus": "NEXT" if band.bandId == next_band.bandId else "QUEUED"})
            for rank, band in enumerate(ranked, start=1)
        ]
        ranked_next_band = next(band for band in self.bands if band.bandId == next_band.bandId)
        return BeliefUpdate(self.bands, ranked_next_band, budget_exhausted)

    def replay_tick(self, now_ms: float, receiver_frequency_ghz: float, current_band_id: str, hit: bool) -> BeliefUpdate:
        """Advance a Dataset A/B replay tick using the observed current band."""
        band_id = current_band_id
        return self.update(now_ms, receiver_frequency_ghz, current_band_id, 30, 30, BeliefObservation(band_id, "HIT" if hit else "MISS"))


def create_initial_beliefs(min_frequency_ghz: float, max_frequency_ghz: float) -> list[SchedulerState]:
    width = (max_frequency_ghz - min_frequency_ghz) / BAND_COUNT
    return [_create_band(index, min_frequency_ghz + index * width, min(max_frequency_ghz, min_frequency_ghz + (index + 1) * width)) for index in range(BAND_COUNT)]


def _create_band(index: int, start: float, end: float) -> SchedulerState:
    return SchedulerState(
        bandId=f"rf-{index + 1:02d}", rank=index + 1, band=f"{_band_name(start)} / {index + 1}",
        frequencyStartGHz=round(start, 3), frequencyEndGHz=round(end, 3), activityPercent=0,
        uncertaintyPercent=100, observationValue=0, dwellMs=round(180 + (index % 5) * 35),
        queueStatus="NEXT" if index == 0 else "QUEUED", activityProbability=0.05, uncertainty=1,
        predictedActivity=0.05, predictedActivityBoost=0, stalenessFactor=1, changeLevelBoost=0,
        scanCost=0, timeSinceLastScanMs=0, recentHits=0, recentMisses=0, lastObservedAtMs=None,
        lastHitTimeMs=None, averageInterArrivalMs=None, changeLevel="NONE", changeLevelUntilMs=0,
        coverageStatus="FRESH", observationHistory=[], hitTimesMs=[],
    )


def _update_band(band: SchedulerState, now_ms: float, receiver_frequency_ghz: float, result: str | None) -> SchedulerState:
    time_since_last_scan = now_ms if band.lastObservedAtMs is None else max(0, now_ms - band.lastObservedAtMs)
    history = ([*band.observationHistory, result][-HISTORY_LENGTH:] if result else band.observationHistory)
    hit_times = ([*band.hitTimesMs, now_ms][-TIMING_HISTORY_LENGTH:] if result == "HIT" else band.hitTimesMs)
    recent_hits = history.count("HIT")
    recent_misses = len(history) - recent_hits
    activity_probability = (
        band.activityProbability * 0.82 + 0.18 if result == "HIT"
        else band.activityProbability * 0.94 if result == "MISS"
        else band.activityProbability * 0.9995
    )
    recent_rate, previous_rate = _compare_windows(history)
    change_magnitude = abs(recent_rate - previous_rate)
    change_level = "HIGH" if change_magnitude >= 0.55 else "MEDIUM" if change_magnitude >= 0.3 else band.changeLevel if now_ms < band.changeLevelUntilMs else "NONE"
    change_until = now_ms + 6_000 if change_magnitude >= 0.55 else now_ms + 3_500 if change_magnitude >= 0.3 else band.changeLevelUntilMs
    change_boost = 1 if change_level == "HIGH" else 0.55 if change_level == "MEDIUM" else 0
    stable_hit_times = [now_ms] if change_magnitude >= 0.3 and result == "HIT" else [] if change_magnitude >= 0.3 else hit_times
    average_interval = _average_interval(stable_hit_times)
    predicted_window = stable_hit_times[-1] + average_interval if average_interval is not None and len(stable_hit_times) >= 2 else None
    prediction_boost = min(1 - activity_probability, 0.35) if predicted_window is not None and abs(predicted_window - now_ms) <= max(PREDICTION_WINDOW_MS, average_interval * 0.3) else 0
    predicted_activity = min(1, activity_probability + prediction_boost)
    uncertainty = min(1, 0.12 + change_boost * 0.35) if result else min(1, time_since_last_scan / 12_000 + change_boost * 0.25)
    staleness = min(1, time_since_last_scan / 12_000)
    coverage = "VERY_STALE" if time_since_last_scan >= VERY_STALE_AFTER_MS else "STALE" if time_since_last_scan >= STALE_AFTER_MS else "FRESH"
    scan_cost = min(1, abs((band.frequencyStartGHz + band.frequencyEndGHz) / 2 - receiver_frequency_ghz) / 8)
    value = max(0, min(1, BELIEF_WEIGHTS["activityProbability"] * activity_probability + BELIEF_WEIGHTS["uncertainty"] * uncertainty + BELIEF_WEIGHTS["predictedActivityBoost"] * prediction_boost + BELIEF_WEIGHTS["stalenessFactor"] * staleness + BELIEF_WEIGHTS["changeLevelBoost"] * change_boost - BELIEF_WEIGHTS["scanCost"] * scan_cost))
    return band.model_copy(update={
        "activityProbability": activity_probability, "uncertainty": uncertainty, "predictedActivity": predicted_activity,
        "predictedActivityBoost": prediction_boost, "stalenessFactor": staleness, "changeLevelBoost": change_boost,
        "scanCost": scan_cost, "observationValue": round(value * 100), "activityPercent": round(activity_probability * 100),
        "uncertaintyPercent": round(uncertainty * 100), "timeSinceLastScanMs": 0 if result else time_since_last_scan,
        "recentHits": recent_hits, "recentMisses": recent_misses, "lastObservedAtMs": now_ms if result else band.lastObservedAtMs,
        "lastHitTimeMs": now_ms if result == "HIT" else band.lastHitTimeMs, "averageInterArrivalMs": average_interval,
        "changeLevel": change_level, "changeLevelUntilMs": change_until, "coverageStatus": coverage,
        "observationHistory": history, "hitTimesMs": stable_hit_times,
    })


def _compare_windows(history: list[str]) -> tuple[float, float]:
    if len(history) < 8:
        return 0, 0
    split = len(history) // 2
    previous, recent = history[:split], history[split:]
    return recent.count("HIT") / len(recent), previous.count("HIT") / len(previous)


def _average_interval(times: list[float]) -> float | None:
    return sum(right - left for left, right in zip(times, times[1:])) / (len(times) - 1) if len(times) >= 2 else None


def _band_name(start: float) -> str:
    return "L/S-BAND" if start < 4 else "C-BAND" if start < 8 else "X-BAND" if start < 12 else "KU-BAND" if start < 18 else "K-BAND"