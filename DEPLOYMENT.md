# Aegis local deployment and smoke checks

## One-command local stack

From the repository root, run:

```sh
docker compose up --build
```

The stack starts PostgreSQL, applies Alembic migrations in the backend container, launches FastAPI, and runs the Vite frontend dev server. Open `http://localhost:5173`; API docs are at `http://localhost:8000/docs`. Data is stored in the `aegis-postgres` named volume. `docker compose down` preserves it; `docker compose down -v` deletes it.

Compose defaults are for a local-only demo and use visible development credentials. Override them in a root `.env` file before sharing a network or pilot deployment:

```dotenv
POSTGRES_PASSWORD=replace-with-a-private-database-password
AEGIS_JWT_SECRET=replace-with-at-least-32-random-bytes
AEGIS_OPERATOR_USERNAME=operator
AEGIS_OPERATOR_PASSWORD=replace-with-a-private-password
AEGIS_RESEARCHER_USERNAME=researcher
AEGIS_RESEARCHER_PASSWORD=replace-with-a-private-password
AEGIS_BACKEND_MODE=SIMULATION
AEGIS_POLICY_MODE=DETERMINISTIC
```

Other backend settings include `AEGIS_DATABASE_URL`, `AEGIS_JWT_EXPIRATION_MINUTES`, `AEGIS_INFERENCE_TIMEOUT_SECONDS`, `AEGIS_POLICY_CHECKPOINT`, and `AEGIS_MODEL_DIR`. Compose configures the database URL for the internal `postgres` hostname. Keep `.env` out of source control.

## Migrations

The container entrypoint runs `alembic upgrade head` before starting Uvicorn. To apply or inspect migrations manually from `backend/` with the configured database URL:

```sh
alembic current
alembic upgrade head
alembic downgrade -1  # rollback one revision; review its data impact first
```

Schema revision and rollback guidance, plus SQLite migration checks, are in [backend/PERSISTENCE.md](backend/PERSISTENCE.md).

## Trained model checkpoint

The default policy is deterministic. To use PPO, set `AEGIS_POLICY_MODE=TRAINED` and point `AEGIS_POLICY_CHECKPOINT` at a readable Stable-Baselines3 checkpoint inside the container. Existing checkpoints are copied into the backend image under `app/ml/checkpoints`. For an external checkpoint, place it under `./models`, mount that directory through `AEGIS_MODEL_DIR=./models`, and set the container path, for example:

```dotenv
AEGIS_MODEL_DIR=./models
AEGIS_POLICY_MODE=TRAINED
AEGIS_POLICY_CHECKPOINT=/models/final.zip
```

Rebuild/restart the backend after changing checkpoint files or policy settings. `/health` reports `modelCheckpoint` as `loaded`, `missing`, or `failed`. In trained mode, an unavailable checkpoint makes health `degraded`; inference requests still use the deterministic belief engine and expose the fallback reason in decision metadata and Research Mode.

## Selecting data source

Use the frontend **Data Source** selector to switch between `OFFLINE SIMULATION` and `LIVE BACKEND`. Offline mode runs the browser simulation. Live mode fetches the backend state/scenario catalog and receives WebSocket deltas; choose **TSRD pulse train replay** in Scenario Lab to replay the checked-in pulse export.

`AEGIS_BACKEND_MODE` selects the server integration label (`SIMULATION`, `DATASET_REPLAY`, or reserved `LIVE`). The `LIVE` hardware mode is not implemented and does not connect to receiver hardware. This switch is separate from the frontend Data Source selector.

## Monitoring

- `GET /health` reports database connectivity and checkpoint loadability. Compose gates backend readiness on database connectivity; a missing trained checkpoint is reported as degraded while the API remains available for deterministic fallback.
- `GET /metrics/prometheus` exposes HTTP request totals and duration aggregates in Prometheus text format. The existing `GET /metrics` remains the operational policy metrics response.
- Backend request, fallback, and error logs are emitted as newline-delimited JSON to stdout/stderr.

## Deployment smoke checklist

After starting a stack or deploying a new image:

1. Confirm all Compose services become healthy with `docker compose ps` and `curl http://localhost:8000/health`; check `database` and `modelCheckpoint` fields.
2. Open `http://localhost:5173`, confirm the dashboard loads, and confirm `GET /metrics/prometheus` returns Prometheus text.
3. Sign in with the configured operator account. Verify Scenario Lab can load, start, pause, and reset a scenario; verify the unauthenticated start request is rejected.
4. Switch to Live Backend, start TSRD replay, and confirm pulse/decision updates appear in the dashboard and Decision History.
5. Sign in as researcher and verify Research Mode can request baseline comparison and the evaluation overlay. Confirm an operator token is denied for those research-only endpoints.
6. If trained mode is enabled, check `/health` shows the checkpoint loaded and verify the latest decision reports trained policy metadata. Exercise a deliberately unavailable checkpoint in a non-production environment and confirm a deterministic fallback reason/flag appears in Research Mode.
7. Restart only the backend container with `docker compose restart backend`; verify database-backed decision history remains available afterward.
