# Aegis Backend

FastAPI service for Aegis EW Command with a typed REST contract, PostgreSQL-backed run history, JWT pilot authentication, and a WebSocket delta stream.

## Run locally

From `backend/`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The service exposes Swagger UI at `/docs`, ReDoc at `/redoc`, OpenAPI JSON at `/openapi.json`, health/readiness detail at `/health`, and Prometheus request metrics at `/metrics/prometheus` (`/metrics` remains operational policy data).

## Integration mode

Set `AEGIS_BACKEND_MODE` to `SIMULATION`, `DATASET_REPLAY`, or `LIVE`. The default is `SIMULATION`. `LIVE` is intentionally reserved and does not connect to receiver hardware in this phase.

The architecture is hybrid: the existing browser simulation remains the frontend offline/demo fallback while this service becomes the connected backend contract.

## Trained scheduler inference

Set `AEGIS_POLICY_MODE=TRAINED` to use the exported PPO checkpoint for `/scheduler/decision`. The default `DETERMINISTIC` mode uses the server-side belief-engine ranking. Set `AEGIS_POLICY_CHECKPOINT` to override the checkpoint path. Every decision reports policy mode, checkpoint version, confidence, log-probability, inference latency, and whether a safety fallback was applied.

## Minimum-viable pilot authentication

The demo keeps read-only dashboard endpoints (`/health`, `/simulation/state`, `/spectrum`, `/metrics`, and `/history`) open for the internal dashboard. Scenario load/start/pause/reset, `/scheduler/decision`, and the real-time `/ws/stream` require a bearer JWT for either role. `/research/baselines` and `/research/ground-truth` require `RESEARCHER`; an `OPERATOR` token cannot invoke them. Obtain a token with `POST /auth/login` using JSON `{ "username": "...", "password": "..." }`.

Configure credentials and a signing key through environment variables; there are no built-in demo passwords:

```sh
export AEGIS_JWT_SECRET="$(openssl rand -hex 32)"
export AEGIS_OPERATOR_USERNAME="operator"
export AEGIS_OPERATOR_PASSWORD="<set-a-private-password>"
export AEGIS_RESEARCHER_USERNAME="researcher"
export AEGIS_RESEARCHER_PASSWORD="<set-a-private-password>"
```

Tokens use HS256 and expire after 60 minutes by default (`AEGIS_JWT_EXPIRATION_MINUTES`). The frontend keeps its bearer token in tab-scoped session storage and adds it to protected API calls. The research reference endpoint is synthetic and explicitly labels its source; it does not expose hardware or classified ground truth.

This is minimum-viable authentication for an internal pilot/demo, not a production defense-system-grade security posture. Real deployment requires, at minimum, network isolation and allowlisting, TLS/mTLS, managed identity and credential rotation, hardware security modules or a secrets manager for signing-key storage, rate limiting and lockout protections, audit-grade tamper-evident logs, security monitoring, and a formal threat model and review. All device/DRDO integrations shown by the frontend remain conceptual simulation surfaces.
