# Deinterleaving Model

The B2 implementation has three layers:

- `deinterleaving_baseline.py` uses DBSCAN over normalized frequency, circular AoA, and PRI features per pulse train.
- `deinterleaving_model.py` trains a supervised pairwise same-emitter classifier using Dataset A's train split, then forms clusters by connected components.
- `deinterleave_service.py` converts assignments into the frontend's existing `Scenario Emitter` object shape.

Train and evaluate after B1 has produced Dataset A:

```bash
python -m app.ml.evaluate_deinterleaving
```

The command trains only on `train.parquet`, evaluates only on `test.parquet`, writes a date-versioned checkpoint under `app/ml/checkpoints/`, and writes `data/reports/deinterleaving_eval.md`. Validation split use should be added for hyperparameter selection before any final test run. The report explicitly records the ARI delta against the frontend heuristic and does not claim improvement unless the held-out number is positive.