# TSRD Dataset Build

The backend uses the Alan Turing Institute's gated [Turing Synthetic Radar Dataset](https://huggingface.co/datasets/alan-turing-institute/turing-synthetic-radar-dataset). Accept the dataset conditions and create a Hugging Face token with access before running the build. Do not commit the downloaded files: `backend/data/` is ignored.

Use Python 3.13 for the pinned local environment. On macOS this workspace uses `/usr/local/bin/python3.13` and `.venv313`; Python 3.14 attempted source builds for the pinned `pyarrow` release.

## Full build

From `backend/`, install the pinned requirements and set the token in the environment:

```bash
export HUGGING_FACE_TOKEN=hf_...
python -m app.data.build_all
```

The command downloads the six split/mode groups into `data/raw/`, then writes:

- `data/processed/dataset_a/v1/{train,validation,test}.parquet`
- `data/processed/dataset_b/v1/{train,validation,test}.parquet`
- `data/samples/{train,validation,test}_v1.json`
- `data/reports/tsrd_validation.md`

Use `--max-trains 1` for a small authenticated smoke build. The default processes all train, validation, and test pulse trains for both `stare` and `scan`; TSRD is multi-billion-pulse scale and requires substantial disk space and time.

## Uploaded CSV source

The project currently has CSV exports under `src/data/`. They can be used without downloading HDF5:

```bash
cd backend
python -m app.data.build_all --source-dir ../src/data --max-trains 1
```

The adapter reads `pulses_all.csv` and maps `centre_frequency_mhz` to `frequency_mhz`. It scopes each pulse train as `(split, receiver_mode, scenario_id)` and preserves `emitter_id` only within that scope. This CSV path is a local adapter; native TSRD HDF5 remains the canonical acquisition format.

## Label scope

The raw `emitter_id` values are arbitrary and only meaningful inside one pulse train. Dataset A retains both `receiver_mode` and `pulse_train_id` on every row. Dataset B groups by that same pair and never treats equal numeric labels in different trains as the same emitter. This preserves the frontend's scenario-local emitter semantics.

## Feature and reward policy

Dataset A sorts each train by ToA and derives consecutive-pulse PRI, frequency, AoA, amplitude, and pulse-width deltas. Frequency hops are flagged at an absolute CF delta of 50 MHz; staggered PRI is flagged when a rolling window has at least four positive intervals with coefficient of variation of at least 5%.

Dataset B replays each train with a 240 MHz instantaneous bandwidth, 240 ms dwell, and 18 ms retune delay. Its reward uses the frontend's current structure: detection benefit minus delay penalty, scan cost, miss penalty, and staleness penalty. The exact frontend weights are reflected in `scheduler_dataset.py`.