import type { GroundTruthEmitter, SchedulerState } from '../types';

export type BaselineRow = [string, string, string, string, string, string];

function bandForFrequency(bands: SchedulerState[], frequencyGHz: number): SchedulerState | undefined {
    return bands.find(band => frequencyGHz >= band.frequencyStartGHz && frequencyGHz < band.frequencyEndGHz);
}

function evaluate(name: string, order: SchedulerState[], bands: SchedulerState[], truth: GroundTruthEmitter[]): BaselineRow {
    const activeTruth = truth.filter(emitter => emitter.active);
    const coveredBands = new Set(order.slice(0, Math.max(1, Math.min(order.length, activeTruth.length * 3))).map(band => band.bandId));
    const detected = activeTruth.filter(emitter => {
        const band = bandForFrequency(bands, emitter.currentFrequencyGHz);
        return band ? coveredBands.has(band.bandId) : false;
    }).length;
    const detection = activeTruth.length ? detected / activeTruth.length * 100 : 0;
    const coverage = bands.length ? coveredBands.size / bands.length * 100 : 0;
    const latency = order.length ? order.slice(0, Math.max(1, detected)).reduce((sum, band) => sum + band.dwellMs, 0) / Math.max(1, detected) : 0;
    const reward = detection / 100 - latency / 5000 - .08;
    return [name, `${detection.toFixed(1)}%`, `${latency.toFixed(0)} ms`, `${coverage.toFixed(1)}%`, reward.toFixed(2), 'LIVE COMPARISON'];
}

/** Deterministic alternative policy: visit bands from low to high frequency. */
export function sequentialSweep(bands: SchedulerState[]): SchedulerState[] {
    return [...bands].sort((left, right) => left.frequencyStartGHz - right.frequencyStartGHz);
}

/** Deterministic alternative policy: visit the highest current activity first. */
export function greedyActivity(bands: SchedulerState[]): SchedulerState[] {
    return [...bands].sort((left, right) => right.activityProbability - left.activityProbability || right.observationValue - left.observationValue);
}

export function runBaselineComparison(bands: SchedulerState[], truth: GroundTruthEmitter[]): BaselineRow[] {
    return [
        evaluate('Sequential Sweep', sequentialSweep(bands), bands, truth),
        evaluate('Greedy-Activity', greedyActivity(bands), bands, truth),
        // Thompson Sampling remains illustrative until a stochastic policy runner exists.
        ['Thompson Sampling', '74.0%', '255 ms', '79.0%', '0.57', 'ILLUSTRATIVE BASELINE'],
    ];
}
