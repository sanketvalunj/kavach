# Visible Data Classification

This table classifies fields visible in the KAVACH EW Command interface. `RAW` means a directly displayed observation or configuration value in the simulated data contract; it does not mean a live hardware feed. `DERIVED` means computed from observations by the belief engine, baseline evaluator, or operator clustering heuristic. `SIMULATED` means scenario ground truth or scripted engine data used for behavior and evaluation and never shown directly in Operator Mode.

| App surface | Visible field | Classification | Source or meaning |
|---|---|---|---|
| Header | Theater date, theater name, operation ID | RAW | TSRD-terminology-inspired sample metadata |
| Header | Current UTC/simulation time | DERIVED | Formatted from simulated elapsed time |
| Header | System nominal, sync/retuning delay | RAW | Simulated receiver constraint display |
| Command Center | Active receiver count/capacity | DERIVED | Store receiver states and configured capacity |
| Command Center | Tracked emitter count | DERIVED | Observed PDW emitter IDs |
| Command Center | Scan efficiency | DERIVED | Live operational metric projection |
| Command Center | Receiver ID, mode, current frequency | DERIVED | Global receiver state after simulated retunes |
| Command Center | Capture range | RAW | Active scenario receiver constraints |
| Command Center | Current observation emitter ID/display name | DERIVED | Operator estimate updated from observed PDWs |
| Command Center | Observation center frequency | DERIVED | Latest observed PDW estimate |
| Command Center | Pulse repetition interval | DERIVED | Latest observed PDW/track estimate |
| Command Center | Confidence | DERIVED | Operator estimate confidence update |
| Command Center | Signal strength | DERIVED | Latest observed PDW amplitude |
| Command Center | Environment-change alert | DERIVED | Generated when a scripted event is detected and adapted |
| Command Center | Next scan title and explanation | DERIVED | Belief-engine recommendation |
| Command Center | Recommendation likelihood and expected yield | DERIVED | Selected band prediction and observation value |
| Command Center | Dwell time and recommendation basis | DERIVED | Selected band belief and receiver constraints |
| Live Spectrum | Waterfall signal samples | SIMULATED | Frontend visualization samples; not a live capture |
| Live Spectrum | Receiver sweep position | DERIVED | Current simulated receiver frequency |
| Live Spectrum | Predicted search windows | DERIVED | Recommendation/band projection |
| PDW Inspector | PDW ID | RAW | Simulated observation record identifier |
| PDW Inspector | Time of arrival (ToA) | RAW | Simulated PDW observation timestamp |
| PDW Inspector | Center frequency | RAW | Simulated measured PDW frequency |
| PDW Inspector | AoA | RAW | Simulated measured angle of arrival |
| PDW Inspector | PRI, pulse width, amplitude | RAW | Simulated pulse descriptor measurements |
| PDW Inspector | Classification, confidence, result | RAW | Simulated observation output |
| PDW Inspector | Scenario label | RAW | Loaded scenario name attached to the observation |
| PDW Inspector | Filter match count and page range | DERIVED | Client-side filtering and pagination over `pdwHistory` |
| Emitter Activity | Scenario Emitter NN label | DERIVED | Stable ordering of frequency/AoA observation clusters |
| Emitter Activity | Cluster observation count | DERIVED | Number of PDWs assigned to the cluster |
| Emitter Activity | Pattern classification | DERIVED | Heuristic based on interval regularity, frequency range, trend, and recency |
| Emitter Activity | Frequency range and frequency-vs-time trace | DERIVED | Clustered observed PDW frequencies |
| Emitter Activity | Estimated PRI | DERIVED | Mean ToA delta within the cluster |
| Emitter Activity | Activity level/timeline | DERIVED | Observed cluster count and recency |
| Scan Strategy | Band ID and frequency range | RAW | Scenario band grid configuration |
| Scan Strategy | Activity, uncertainty, observation value | DERIVED | Belief-engine state for each band |
| Scan Strategy | Queue rank/status | DERIVED | Ranked recommendation candidates |
| Scan Strategy | Dwell and retune constraints | RAW | Active scenario receiver constraints |
| Decision History | Decision ID, timestamp, action, band | RAW | Stored completed decision record |
| Decision History | Predicted activity and uncertainty snapshot | DERIVED | Belief snapshot captured at decision time |
| Decision History | HIT/MISS outcome | DERIVED | Scored against simulated ground truth during the dwell |
| Decision History | Detection, delay, scan-cost, miss, staleness terms | DERIVED | Real Phase 3 reward decomposition |
| Decision History | Total reward | DERIVED | Sum of the stored reward terms |
| Performance | Interception rate | DERIVED | HIT decisions divided by total decisions |
| Performance | Average interception time | DERIVED | Ground-truth activation-to-scan timing for scored HITs |
| Performance | Cumulative reward | DERIVED | Running sum of stored decision rewards |
| Performance | Coverage and staleness | DERIVED | Distribution across live band beliefs |
| Performance | Hits vs misses | DERIVED | Counts from decision history |
| Performance | Smart Scan/current run row | DERIVED | Current live decision history and band state |
| Performance | Random, Thompson comparison rows | SIMULATED | Illustrative baseline values, not executed policies |
| Performance | Sequential Sweep row | DERIVED | Deterministic live baseline over the current scenario |
| Performance | Greedy-Activity row | DERIVED | Deterministic live activity-ranked baseline |
| Scenario Lab | Scenario name/description | RAW | Scenario catalog definition |
| Scenario Lab | Emitter count, duration, random seed | RAW | User-loaded scenario configuration |
| Scenario Lab | Spectrum range and receiver constraints | RAW | Active scenario definition |
| Scenario Lab | Scenario preview bursts | SIMULATED | Decorative preview samples for the scenario catalog |
| Scenario Lab | Scripted frequency shift/new emitter event | SIMULATED | Ground-truth engine event used for evaluation |
| Research Mode | Selected SchedulerState band values | DERIVED | Live band object stored by the belief engine |
| Research Mode | Policy factor contributions | DERIVED | Real Phase 2 weights multiplied by selected band values |
| Research Mode | Reward breakdown | DERIVED | Real Phase 3 reward components |
| Research Mode | Baseline comparison output | DERIVED/SIMULATED | Sequential and Greedy are live; Random and Thompson are illustrative |
| Research Mode | Ablation values | SIMULATED | Explicitly illustrative prototype evaluation values |
| Research Mode | Scenario configuration | RAW | Current loaded scenario configuration |
| Research Mode | Ground-truth overlay | SIMULATED | Evaluation-only ground truth; never shown in Operator Mode |

## Ground-Truth Boundary

The `groundTruthEmitters` collection drives scoring and scripted events inside the simulation engine. Operator pages consume the scrubbed operator estimate, band beliefs, decision history, PDW history, and inferred clusters. Only Research Mode may render ground truth, and it labels that data `GROUND TRUTH - EVALUATION ONLY`.

## Interpretation Notes

- RAW fields are simulated inputs or simulated sensor-like records in this frontend. They are not claims of live TSRD ingestion.
- DERIVED fields are reproducible from the current session state and heuristics.
- SIMULATED fields are intentionally not evidence of real-world emitter activity or a trained policy.
- Pattern classification and clustering are heuristic demonstrations, not certified deinterleaving or emitter-identification algorithms.
