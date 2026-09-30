# AEGIS EW Command

AEGIS EW Command is an electronic-warfare command-center prototype. Its Offline Simulation demo presents a simulated RF environment, deterministic scan policy, live belief updates, receiver retuning, decision history, performance metrics, emitter inference, and Research Mode.

## Project Overview

The demo closes the loop from scenario configuration to receiver behavior:

1. A scenario seeds deterministic ground-truth emitter behavior.
2. The simulated receiver dwells on a band and produces HIT/MISS observations.
3. The belief engine updates activity, uncertainty, staleness, change level, and observation value.
4. A deterministic policy selects the next recommendation.
5. The receiver retunes automatically after the dwell and retuning delay.
6. Each completed decision receives a decomposed reward and is added to Decision History.
7. Operator and Research pages consume the accumulated session state.

## Features

- Command Center with live spectrum, receiver state, recommendation, alert, and PDW stream.
- Scenario Lab with seeded scenarios, emitter count, duration, and random-seed controls.
- Scripted frequency-shift and new-emitter environment events.
- Automatic receiver retuning and deterministic policy simulation.
- Real decision history, reward decomposition, performance KPIs, and charts.
- PDW Inspector with frequency, ToA, AoA, amplitude, scenario search, and pagination.
- Operator-visible emitter clusters inferred from observed PDWs using frequency/AoA proximity.
- Research Mode with live scheduler state, policy factors, reward terms, baseline comparisons, ablation disclosure, scenario configuration, and ground-truth overlay.
- Session-only `sessionStorage` persistence with guarded reads/writes.
- Empty states for uninitialized scenarios, observations, decisions, and rewards.

## Tech Stack

- React 18
- Vite 6
- Zustand 5
- TypeScript for simulation, store, engine, and data contracts
- Recharts for data charts
- React Three Fiber, Three.js, and Drei for the spectrum scene
- Framer Motion for restrained interface transitions
- Lucide React for icons

## Folder Structure

```text
.
├── index.html
├── package.json
├── tsconfig.json
└── src
    ├── App.jsx                 # Pages, navigation, and operator/research views
    ├── DataChart.jsx           # Recharts visualizations
    ├── SpectrumScene.jsx       # RF field visualization
    ├── styles.css              # Established visual system and responsive layout
    ├── tokens.css              # Design tokens
    ├── data
    │   ├── README.md           # Visible-field data classification
    │   └── scenarios.ts        # Seeded scenario definitions and scripted events
    ├── simulation
    │   ├── baselines.ts        # Sequential and Greedy-Activity comparisons
    │   ├── beliefEngine.ts     # Band belief and recommendation heuristics
    │   ├── engine.ts           # Seeded emitter behavior and PDW generation
    │   └── loop.ts             # Background tick loop
    ├── store
    │   └── simulationStore.ts  # Global Zustand simulation state and actions
    └── types
        └── index.ts            # Shared simulation and UI contracts
```

## How To Run

Requirements: Node.js with npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The production validation command is:

```bash
npm run build
```

The project currently has no separate lint script. `npm run build` runs the TypeScript check followed by the Vite production build.

## How The Simulation Engine Works

### Phases 1-2: Environment and belief state

Scenario definitions provide emitter seeds, frequencies, patterns, timing, receiver constraints, and optional scripted events. A seeded PRNG makes generated emitters reproducible for a scenario and seed.

The engine advances emitter behavior at a simulated time. Stable, periodic, intermittent, frequency-agile, changing, and newly introduced emitters determine whether a target is active and which frequency it occupies. When the receiver completes a dwell, the engine creates a simulated PDW for an overlapping active emitter or records a MISS.

The belief engine maintains one `SchedulerState` per frequency band. It updates:

- Activity probability and predicted activity
- Uncertainty and staleness
- Recent HIT/MISS counts
- Timing history and predicted activity windows
- Change level and coverage status
- Scan cost and observation value

Recommendations are computed from these values and the weighted information-value heuristic. This is a deterministic temporal model, not machine learning.

### Phase 3: Decision loop

After a dwell completes, the receiver records the band, frequency, dwell, prediction, uncertainty, result, belief snapshot, and reward. The reward is:

```text
detection benefit
- delay penalty
- scan cost
- miss penalty
- staleness penalty
= decision reward
```

The receiver then retunes to the current top recommendation after the configured retuning delay. Decision History and Performance consume the growing history instead of placeholder rows. Smart Scan reflects the current run; non-Smart-Scan comparison rows are either deterministic baseline evaluations or explicitly illustrative.

## TSRD Terminology Used

The interface uses terminology inspired by electronic-support and threat-signal data workflows. It is not a certified or authoritative TSRD schema.

- **PDW**: Pulse Descriptor Word, a simulated observation record containing time, frequency, pulse, amplitude, AoA, classification, confidence, and result fields.
- **ToA**: Time of arrival for a pulse descriptor.
- **PRI**: Pulse repetition interval. The UI estimates it from observed inter-arrival times.
- **Emitter**: A simulated RF source in ground truth or an inferred operator-visible cluster.
- **Band belief**: The current scheduler state for a frequency band.
- **HIT/MISS**: Whether a simulated dwell overlapped an active ground-truth emitter.
- **AoA**: Angle of arrival, simulated for PDW records and used by the clustering heuristic.
- **Observation value**: The belief-engine score used to rank candidate scan bands.
- **Dwell**: The simulated receive interval spent observing a band.
- **Retune delay**: The simulated time required to move the receiver to another band.

## Current Integration Status

The Offline Simulation demo is the verified user-facing path: scenario playback, PDWs, alerts, recommendations, decisions, and research views run from the browser simulation. Backend API, WebSocket, database/migration, authentication, monitoring, and deployment scaffolding are built, but Live Backend integration and PostgreSQL deployment still require end-to-end verification; Live Backend is disabled in the current recording configuration. The project does not connect to operational RF hardware, and production security, deployment hardening, and model validation remain in progress. Ground truth is used for scoring and evaluation only and is kept separate from operator-facing estimates in Operator Mode.

## DRDO Integration Disclaimer

AEGIS EW Command is a conceptual demonstration and is not an official DRDO system, product, interface, data standard, or endorsement. References to DRDO, EW, TSRD terminology, or future integration are conceptual only. Any real integration would require authorized requirements, security review, approved interfaces, certified hardware/software, and the relevant organizational approvals.

## Operator Mode vs Research Mode

**Operator Mode** is the normal command-center experience. It shows receiver behavior, observed PDWs, inferred emitter clusters, recommendations, alerts, decisions, and live performance. It must not expose ground truth directly.

**Research Mode** is an inspection surface for the demonstration. It exposes live scheduler state, the real recommendation factor breakdown, reward terms, baseline runner output, scenario configuration, and an optional ground-truth overlay labeled for evaluation only.

The policy output is deterministic and simulated. The required disclosure is visible in Research Mode:

> Frontend demonstration uses a simulated policy output modeled on PPO's decision structure. Production PPO model integration point is documented in System/Integration.

## Status By Phase

- Phase 0: global state architecture and receiver UI implemented.
- Phase 1: seeded emitter behavior, HIT/MISS scoring, and PDWs implemented.
- Phase 2: belief state and recommendations implemented with heuristic scoring.
- Phase 3: decision loop, rewards, history, and live performance implemented.
- Phase 4: scenario configuration and scripted environment changes implemented.
- Phase 5: PDW filtering, pagination, and heuristic observed-emitter clustering implemented.
- Phase 6: Research Mode explainability and two live deterministic baselines implemented; Thompson and ablation remain illustrative.
- Phase 7: global navigation persistence, session snapshot persistence, empty states, and build/browser QA implemented.
- Phase 8: documentation.
# kavach
