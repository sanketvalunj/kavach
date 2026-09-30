import type { ScenarioDefinition } from '../types';
import type { EmitterSeed, RandomState } from '../simulation/engine';

function mulberry32(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value += 0x6d2b79f5;
        let result = Math.imul(value ^ value >>> 15, 1 | value);
        result ^= result + Math.imul(result ^ result >>> 7, 61 | result);
        return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
}

const profiles: EmitterSeed[] = [
    { emitterId: 'E-041', trueClass: 'PULSE DOPPLER RADAR', platform: 'GROUND', actualFrequencyGHz: 8.420, missionRole: 'SURVEILLANCE', pattern: 'STABLE', amplitudeDbm: -42, priMs: 1.25, pulseWidthUs: 4.1, aoaDeg: 41 },
    { emitterId: 'E-038', trueClass: 'FREQUENCY AGILE RADAR', platform: 'AIRBORNE', actualFrequencyGHz: 12.806, missionRole: 'TRACKING', pattern: 'FREQUENCY_AGILE', agileFrequenciesGHz: [12.806, 12.912, 12.744, 12.858], hopIntervalMs: 700, amplitudeDbm: -51, priMs: .84, pulseWidthUs: 8.2, aoaDeg: 126 },
    { emitterId: 'E-033', trueClass: 'CONTINUOUS WAVE RADAR', platform: 'GROUND', actualFrequencyGHz: 4.202, missionRole: 'ALTIMETER', pattern: 'PERIODIC', periodMs: 1500, activeDurationMs: 600, amplitudeDbm: -58, priMs: .84, pulseWidthUs: 8.2, aoaDeg: 211 },
    { emitterId: 'E-029', trueClass: 'UNKNOWN PULSED EMITTER', platform: 'UNKNOWN', actualFrequencyGHz: 15.114, missionRole: 'UNRESOLVED', pattern: 'INTERMITTENT', intermittencyProbability: .32, amplitudeDbm: -66, priMs: 2.8, pulseWidthUs: 2.1, aoaDeg: 282 },
    { emitterId: 'E-052', trueClass: 'SEARCH RADAR', platform: 'GROUND', actualFrequencyGHz: 3.180, missionRole: 'SEARCH', pattern: 'PERIODIC', periodMs: 2200, activeDurationMs: 850, amplitudeDbm: -54, priMs: 1.8, pulseWidthUs: 5, aoaDeg: 18 },
    { emitterId: 'E-057', trueClass: 'PULSE RADAR', platform: 'AIRBORNE', actualFrequencyGHz: 10.120, missionRole: 'TRACKING', pattern: 'NEW', introducedAtMs: 12_000, amplitudeDbm: -49, priMs: 1.1, pulseWidthUs: 3.4, aoaDeg: 96 },
    { emitterId: 'E-061', trueClass: 'BEACON RADAR', platform: 'GROUND', actualFrequencyGHz: 14.320, missionRole: 'NAVIGATION', pattern: 'PERIODIC', periodMs: 2200, activeDurationMs: 850, amplitudeDbm: -61, priMs: 3.2, pulseWidthUs: 2.5, aoaDeg: 173 },
    { emitterId: 'E-066', trueClass: 'FREQUENCY AGILE RADAR', platform: 'UNKNOWN', actualFrequencyGHz: 6.420, missionRole: 'UNKNOWN', pattern: 'FREQUENCY_AGILE', agileFrequenciesGHz: [6.42, 6.51, 6.37], hopIntervalMs: 1100, amplitudeDbm: -57, priMs: 1.6, pulseWidthUs: 4.8, aoaDeg: 337 },
];

function seededProfiles(count: number, seed: number, source = profiles): EmitterSeed[] {
    const random = mulberry32(seed);
    return Array.from({ length: Math.max(1, Math.min(24, count)) }, (_, index) => {
        if (index < source.length) return { ...source[index], agileFrequenciesGHz: source[index].agileFrequenciesGHz?.slice() };
        const frequency = 2.2 + random() * 15.4;
        return { emitterId: `E-${String(70 + index).padStart(3, '0')}`, trueClass: 'UNKNOWN PULSED EMITTER', platform: 'UNKNOWN', actualFrequencyGHz: Number(frequency.toFixed(3)), missionRole: 'UNRESOLVED', pattern: index % 3 === 0 ? 'INTERMITTENT' : 'STABLE', intermittencyProbability: .25 + random() * .35, amplitudeDbm: -58 - random() * 14, priMs: .8 + random() * 2, pulseWidthUs: 2 + random() * 5, aoaDeg: Math.round(random() * 360) };
    });
}

const preview = (seed: number) => Array.from({ length: 11 }, (_, index) => ({ x: (index * 31 + seed) % 155, y: 8 + ((index * 17 + seed) % 36), width: 8 + (index * 7) % 29, tone: index % 4 === 0 ? 'amber' as const : 'teal' as const, opacity: .3 + (index % 5) * .12 }));
const commonConstraints = { bandwidthMHz: 240, dwellLimitMs: 450, retuningDelayMs: 18, scanBudgetSeconds: 4.2, scanWindowSeconds: 10, optimizationPolicy: 'MAX INFORMATION GAIN', instantaneousBandwidthMHz: 240, retuningDelayUs: 18_000, dwellUs: 240_000, scanRetunesPerMinute: 30 };

export const scenarioDefinitions: ScenarioDefinition[] = [
    { id: 'adaptive-multi-emitter', name: 'Adaptive Multi-Emitter Environment', description: 'Mixed emitters with a scripted frequency shift at 20 seconds', defaultEmitterCount: 8, defaultDurationSeconds: 120, defaultSeed: 7419, previewBursts: preview(3), emitterSeeds: seededProfiles(8, 7419), receiverConstraints: { ...commonConstraints, frequencyMinGHz: 2, frequencyMaxGHz: 18 }, scriptedEvents: [{ type: 'FREQUENCY_SHIFT', atMs: 20_000, emitterId: 'E-041', fromFrequencyGHz: 8.420, toFrequencyGHz: 9.120 }] },
    { id: 'urban-dense', name: 'Dense Urban Emitter Field', description: 'High-density pulse trains and moderate congestion', defaultEmitterCount: 10, defaultDurationSeconds: 300, defaultSeed: 7421, previewBursts: preview(7), emitterSeeds: seededProfiles(10, 7421), receiverConstraints: { ...commonConstraints, frequencyMinGHz: 2, frequencyMaxGHz: 18 }, scriptedEvents: [] },
    { id: 'sudden-behaviour-change', name: 'Sudden Behaviour Change', description: 'A stable emitter changes frequency at 20 seconds', defaultEmitterCount: 5, defaultDurationSeconds: 120, defaultSeed: 7423, previewBursts: preview(11), emitterSeeds: seededProfiles(5, 7423), receiverConstraints: { ...commonConstraints, frequencyMinGHz: 3, frequencyMaxGHz: 16 }, scriptedEvents: [{ type: 'FREQUENCY_SHIFT', atMs: 20_000, emitterId: 'E-041', fromFrequencyGHz: 8.420, toFrequencyGHz: 11.240 }] },
    { id: 'new-emitter-appears', name: 'New Emitter Appears', description: 'A new airborne emitter enters the theater at 20 seconds', defaultEmitterCount: 5, defaultDurationSeconds: 120, defaultSeed: 7427, previewBursts: preview(17), emitterSeeds: seededProfiles(5, 7427), receiverConstraints: { ...commonConstraints, frequencyMinGHz: 2, frequencyMaxGHz: 18 }, scriptedEvents: [{ type: 'NEW_EMITTER', atMs: 20_000, emitterId: 'E-099', toFrequencyGHz: 13.440 }] },
    { id: 'border-sweep', name: 'Border Surveillance Sweep', description: 'Wide-area search with intermittent tracks', defaultEmitterCount: 5, defaultDurationSeconds: 300, defaultSeed: 7431, previewBursts: preview(23), emitterSeeds: seededProfiles(5, 7431), receiverConstraints: { ...commonConstraints, frequencyMinGHz: 2, frequencyMaxGHz: 18 }, scriptedEvents: [] },
    { id: 'coastal-radar', name: 'Coastal Radar Corridor', description: 'Long-range surveillance with layered returns', defaultEmitterCount: 7, defaultDurationSeconds: 420, defaultSeed: 7433, previewBursts: preview(29), emitterSeeds: seededProfiles(7, 7433), receiverConstraints: { ...commonConstraints, frequencyMinGHz: 2, frequencyMaxGHz: 18 }, scriptedEvents: [] },
    { id: 'sparse-intercept', name: 'Sparse Low-Probability Intercept', description: 'Low density with sparse observations', defaultEmitterCount: 3, defaultDurationSeconds: 600, defaultSeed: 7439, previewBursts: preview(31), emitterSeeds: seededProfiles(3, 7439), receiverConstraints: { ...commonConstraints, frequencyMinGHz: 4, frequencyMaxGHz: 18 }, scriptedEvents: [] },
];

export function getScenarioDefinition(id: string): ScenarioDefinition {
    return scenarioDefinitions.find(scenario => scenario.id === id) ?? scenarioDefinitions[0];
}

export function buildScenarioSeeds(definition: ScenarioDefinition, count: number, seed: number): EmitterSeed[] {
    const generated = seededProfiles(count, seed, definition.emitterSeeds);
    return generated.filter(emitter => emitter.emitterId !== 'E-099');
}

export function newEmitterSeed(definition: ScenarioDefinition, eventEmitterId: string, frequencyGHz: number): EmitterSeed {
    return { emitterId: eventEmitterId, trueClass: 'UNKNOWN PULSED EMITTER', platform: 'AIRBORNE', actualFrequencyGHz: frequencyGHz, missionRole: 'UNRESOLVED', pattern: 'NEW', introducedAtMs: 0, amplitudeDbm: -52, priMs: 1.4, pulseWidthUs: 4.2, aoaDeg: 108 };
}
