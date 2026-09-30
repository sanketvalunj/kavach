import type { EmitterPattern, GroundTruthEmitter, PDW } from '../types';

export interface RandomState { value: number }

/** Small seeded PRNG: reproducible for a scenario seed, but varied by tick. */
export function random01(state: RandomState): number {
  let x = state.value >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.value = x >>> 0 || 0x6d2b79f5;
  return state.value / 0x100000000;
}

export interface EmitterSeed {
  emitterId: string;
  trueClass: string;
  platform: string;
  actualFrequencyGHz: number;
  missionRole: string;
  pattern: EmitterPattern;
  introducedAtMs?: number;
  agileFrequenciesGHz?: number[];
  hopIntervalMs?: number;
  periodMs?: number;
  activeDurationMs?: number;
  intermittencyProbability?: number;
  changeAtMs?: number;
  changedFrequencyGHz?: number;
  pulseWidthUs?: number;
  amplitudeDbm?: number;
  priMs?: number;
  aoaDeg?: number;
}

export function createEmitterStates(seeds: EmitterSeed[]): GroundTruthEmitter[] {
  return seeds.map(seed => ({
    emitterId: seed.emitterId,
    trueClass: seed.trueClass,
    platform: seed.platform,
    actualFrequencyGHz: seed.actualFrequencyGHz,
    missionRole: seed.missionRole,
    pattern: seed.pattern,
    introducedAtMs: seed.introducedAtMs ?? 0,
    agileFrequenciesGHz: seed.agileFrequenciesGHz ?? [],
    hopIntervalMs: seed.hopIntervalMs ?? 800,
    periodMs: seed.periodMs ?? 1500,
    activeDurationMs: seed.activeDurationMs ?? 200,
    intermittencyProbability: seed.intermittencyProbability ?? 0.45,
    changeAtMs: seed.changeAtMs ?? 45_000,
    changedFrequencyGHz: seed.changedFrequencyGHz ?? seed.actualFrequencyGHz + 0.025,
    pulseWidthUs: seed.pulseWidthUs ?? 4,
    amplitudeDbm: seed.amplitudeDbm ?? -48,
    priMs: seed.priMs ?? 1.25,
    aoaDeg: seed.aoaDeg ?? 0,
    active: false,
    activeSinceMs: null,
    currentFrequencyGHz: seed.actualFrequencyGHz,
  }));
}

/** Evaluates each configured RF behavior at the supplied simulation time. */
export function updateEmitterStates(
  emitters: GroundTruthEmitter[],
  timeMs: number,
  random: RandomState,
): GroundTruthEmitter[] {
  return emitters.map(emitter => {
    const exists = timeMs >= emitter.introducedAtMs;
    const phaseMs = Math.max(0, timeMs - emitter.introducedAtMs);
    let active = false;
    let frequencyGHz = emitter.actualFrequencyGHz;
    switch (emitter.pattern) {
      case 'STABLE':
        active = exists;
        frequencyGHz += (random01(random) - 0.5) * 0.00006;
        break;
      case 'PERIODIC':
        active = exists && phaseMs % emitter.periodMs < emitter.activeDurationMs;
        break;
      case 'INTERMITTENT':
        active = exists && random01(random) < emitter.intermittencyProbability;
        break;
      case 'FREQUENCY_AGILE': {
        active = exists;
        const hops = emitter.agileFrequenciesGHz.length ? emitter.agileFrequenciesGHz : [emitter.actualFrequencyGHz];
        frequencyGHz = hops[Math.floor(phaseMs / emitter.hopIntervalMs) % hops.length];
        break;
      }
      case 'CHANGING':
        active = exists;
        frequencyGHz = timeMs >= emitter.changeAtMs ? emitter.changedFrequencyGHz : emitter.actualFrequencyGHz;
        frequencyGHz += (random01(random) - 0.5) * 0.00006;
        break;
      case 'NEW':
        active = exists;
        frequencyGHz += (random01(random) - 0.5) * 0.00006;
        break;
    }
    return { ...emitter, active, activeSinceMs: active ? (emitter.active ? emitter.activeSinceMs : timeMs) : null, currentFrequencyGHz: frequencyGHz };
  });
}

export interface PdwObservation {
  timeMs: number;
  emitter: GroundTruthEmitter;
  random: RandomState;
  tickNumber: number;
}

export function makePdw({ timeMs, emitter, random, tickNumber }: PdwObservation): PDW {
  const measuredMHz = emitter.currentFrequencyGHz * 1000 + (random01(random) - 0.5) * 0.08;
  const timestamp = new Date(Date.UTC(2026, 8, 24, 4, 12, 38) + timeMs).toISOString().slice(11, 23);
  const amplitudeDbm = emitter.amplitudeDbm + (random01(random) - 0.5) * 4;
  return {
    id: `PDW-${String(89143 + tickNumber).padStart(5, '0')}`,
    timestamp,
    emitterId: emitter.emitterId,
    centerFrequencyMHz: measuredMHz,
    centerFrequencyGHz: measuredMHz / 1000,
    priMs: Math.max(0.05, emitter.priMs * (1 + (random01(random) - 0.5) * 0.04)),
    pulseWidthUs: Math.max(0.05, emitter.pulseWidthUs * (1 + (random01(random) - 0.5) * 0.08)),
    amplitudeDbm,
    amplitudePercent: Math.max(0, Math.min(100, Math.round(100 + amplitudeDbm))),
    aoaDeg: (emitter.aoaDeg + (random01(random) - 0.5) * 2 + 360) % 360,
    classification: emitter.pattern === 'FREQUENCY_AGILE' ? 'FREQUENCY HOP' : emitter.pattern === 'PERIODIC' ? 'PULSE TRAIN' : emitter.pattern === 'INTERMITTENT' ? 'INTERMITTENT' : 'PULSE TRAIN',
    result: 'HIT',
    confidence: 0.72 + random01(random) * 0.25,
  };
}

export function formatSimulationClock(elapsedMs: number): string {
  return new Date(Date.UTC(2026, 8, 24, 4, 12, 38) + elapsedMs).toISOString().slice(11, 19);
}
