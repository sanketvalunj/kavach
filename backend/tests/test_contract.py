from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import pytest

from app.main import app
from app.core.config import settings


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] in {"ok", "degraded"}
    assert response.json()["database"] in {"ok", "unavailable"}


def test_contract_routes_and_openapi(monkeypatch) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    expected = {"/auth/login", "/simulation/state", "/spectrum", "/scheduler/decision", "/metrics", "/history", "/history/export", "/scenario/list", "/scenario/load", "/scenario/start", "/scenario/pause", "/scenario/reset", "/research/baselines", "/research/ground-truth"}
    assert expected <= paths.keys()
    assert any(getattr(route, "path", None) == "/ws/stream" for route in app.routes)
    assert client.get("/simulation/state").json()["receiverState"]["id"] == "RX-04"
    monkeypatch.setattr(settings, "jwt_secret", "pilot-test-secret-which-is-at-least-32-bytes")
    monkeypatch.setattr(settings, "operator_username", "operator")
    monkeypatch.setattr(settings, "operator_password", "operator-pass")
    token = client.post("/auth/login", json={"username": "operator", "password": "operator-pass"}).json()["access_token"]
    monkeypatch.setattr("app.services.simulation.repository.record_scenario", lambda config: None)
    assert client.post("/scenario/load", headers={"Authorization": f"Bearer {token}"}, json={"scenarioId": "adaptive-multi-emitter", "emitterCount": 8, "durationSeconds": 120, "seed": 7419}).status_code == 200


def test_stream_connects_with_a_bearer_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "jwt_secret", "pilot-test-secret-which-is-at-least-32-bytes")
    monkeypatch.setattr(settings, "operator_username", "operator")
    monkeypatch.setattr(settings, "operator_password", "operator-pass")
    token = client.post("/auth/login", json={"username": "operator", "password": "operator-pass"}).json()["access_token"]
    with client.websocket_connect("/ws/stream") as websocket:
        websocket.send_json({"type": "auth", "token": token})
        assert websocket is not None


def test_jwt_role_boundaries(monkeypatch) -> None:
    monkeypatch.setattr(settings, "jwt_secret", "pilot-test-secret-which-is-at-least-32-bytes")
    monkeypatch.setattr(settings, "operator_username", "operator")
    monkeypatch.setattr(settings, "operator_password", "operator-pass")
    monkeypatch.setattr(settings, "researcher_username", "researcher")
    monkeypatch.setattr(settings, "researcher_password", "researcher-pass")
    operator = client.post("/auth/login", json={"username": "operator", "password": "operator-pass"}).json()
    researcher = client.post("/auth/login", json={"username": "researcher", "password": "researcher-pass"}).json()
    assert operator["role"] == "OPERATOR"
    assert researcher["role"] == "RESEARCHER"
    assert client.post("/scenario/start").status_code == 401
    with client.websocket_connect("/ws/stream") as socket:
        socket.send_json({"type": "auth"})
        with pytest.raises(WebSocketDisconnect):
            socket.receive_json()
    assert client.post("/research/baselines", headers={"Authorization": f"Bearer {operator['access_token']}"}).status_code == 403
    assert client.post("/research/baselines", headers={"Authorization": f"Bearer {researcher['access_token']}"}).status_code == 200
    assert client.get("/simulation/state").status_code == 200
