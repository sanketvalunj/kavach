import asyncio
import csv
import io
import json
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.responses import PlainTextResponse

from ..core.config import settings
from ..models import HealthResponse, OperationalMetrics, Scenario, ScenarioConfig, ScanDecision, SimulationState, SpectrumSample
from ..services.simulation import simulation_service
from ..db import repository
from ..core.auth import LoginRequest, User, authenticate, issue_token, require_operator, require_researcher, user_from_token

router = APIRouter()


@router.post("/auth/login", tags=["auth"])
def login(credentials: LoginRequest) -> dict:
    role = authenticate(credentials.username, credentials.password)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid username or password", headers={"WWW-Authenticate": "Bearer"})
    token, expires_in = issue_token(credentials.username, role)
    return {"access_token": token, "token_type": "bearer", "expires_in": expires_in, "username": credentials.username, "role": role}


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    database_ok = repository.check_connection()
    checkpoint = simulation_service.inference.checkpoint_status
    healthy = database_ok and (settings.policy_mode != "TRAINED" or simulation_service.inference.available)
    return HealthResponse(status="ok" if healthy else "degraded", service=settings.app_name, mode=settings.backend_mode.value, version=settings.app_version, database="ok" if database_ok else "unavailable", modelCheckpoint=checkpoint)


@router.get("/simulation/state", response_model=SimulationState, tags=["simulation"])
def get_simulation_state() -> SimulationState:
    return simulation_service.get_state()


@router.get("/spectrum", response_model=list[SpectrumSample], tags=["spectrum"])
def get_spectrum() -> list[SpectrumSample]:
    return simulation_service.get_spectrum()


@router.get("/scheduler/decision", response_model=ScanDecision, tags=["scheduler"])
def get_scheduler_decision(_: User = Depends(require_operator)) -> ScanDecision:
    return simulation_service.get_decision()


@router.get("/metrics", response_model=OperationalMetrics, tags=["metrics"])
def get_metrics() -> OperationalMetrics:
    return simulation_service.get_metrics()


@router.get("/metrics/prometheus", response_class=PlainTextResponse, include_in_schema=True, tags=["metrics"])
def prometheus_metrics() -> str:
    from ..core.observability import request_metrics
    return request_metrics.prometheus()


@router.get("/history", tags=["history"])
def get_history(limit: int = 50, offset: int = 0, run_id: str | None = None, result: str | None = None, band: str | None = None) -> dict:
    return repository.query_history(limit, offset, run_id, result, band)


@router.get("/history/export", tags=["history"])
def export_history(format: str = "csv", run_id: str | None = None, result: str | None = None, band: str | None = None) -> Response:
    data = repository.query_history(500, 0, run_id, result, band)
    rows = list(data["items"])
    offset = len(rows)
    while offset < data["total"]:
        rows.extend(repository.query_history(500, offset, run_id, result, band)["items"])
        offset = len(rows)
    if format.lower() == "json":
        return Response(json.dumps(rows, indent=2), media_type="application/json", headers={"Content-Disposition": "attachment; filename=aegis-decision-history.json"})
    if format.lower() != "csv":
        return Response(json.dumps({"detail": "format must be csv or json"}), status_code=422, media_type="application/json")
    output = io.StringIO()
    fields = list(rows[0]) if rows else ["id", "timestamp", "action", "band", "result", "reward"]
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=aegis-decision-history.csv"})


@router.get("/scenario/list", response_model=list[Scenario], tags=["scenario"])
def list_scenarios() -> list[Scenario]:
    return simulation_service.list_scenarios()


@router.post("/scenario/load", response_model=Scenario, tags=["scenario"])
async def load_scenario(config: ScenarioConfig, _: User = Depends(require_operator)) -> Scenario:
    await simulation_service.stop_clock()
    return simulation_service.load_scenario(config)


@router.post("/scenario/start", response_model=SimulationState, tags=["scenario"])
async def start_scenario(_: User = Depends(require_operator)) -> SimulationState:
    state = simulation_service.command("start")
    await simulation_service.start_clock()
    return state


@router.post("/scenario/pause", response_model=SimulationState, tags=["scenario"])
async def pause_scenario(_: User = Depends(require_operator)) -> SimulationState:
    await simulation_service.stop_clock()
    return simulation_service.command("pause")


@router.post("/scenario/reset", response_model=SimulationState, tags=["scenario"])
async def reset_scenario(_: User = Depends(require_operator)) -> SimulationState:
    await simulation_service.stop_clock()
    return simulation_service.command("reset")


@router.post("/research/baselines", tags=["research"])
def run_baselines(_: User = Depends(require_researcher)) -> dict:
    return simulation_service.run_research_baselines()


@router.get("/research/ground-truth", tags=["research"])
def get_ground_truth(_: User = Depends(require_researcher)) -> dict:
    return simulation_service.get_research_ground_truth()


@router.websocket("/ws/stream")
async def stream(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        auth_message = await asyncio.wait_for(websocket.receive_json(), timeout=5)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        await websocket.close(code=4401, reason="Bearer token required")
        return
    if not isinstance(auth_message, dict) or auth_message.get("type") != "auth" or user_from_token(str(auth_message.get("token", ""))) is None:
        await websocket.close(code=4401, reason="Bearer token required")
        return
    queue = simulation_service.subscribe()
    try:
        state = simulation_service.get_state()
        await websocket.send_json({"type": "full_state", "version": 1, **state.model_dump(by_alias=True)})
        while True:
            await websocket.send_json(await queue.get())
    except WebSocketDisconnect:
        return
    finally:
        simulation_service.unsubscribe(queue)
