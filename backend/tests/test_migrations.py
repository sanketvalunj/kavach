from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from app.db import repository
from app.db.database import get_session_factory
from app.db.models import AuditRecord, ModelVersionRecord, RunRecord, ScenarioRecord
from pathlib import Path

ALEMBIC_CONFIG = Path(__file__).resolve().parents[1] / "alembic.ini"


def test_initial_migration_upgrade_and_rollback(tmp_path, monkeypatch) -> None:
    database_file = tmp_path / "migration-test.db"
    monkeypatch.setenv("AEGIS_DATABASE_URL", f"sqlite:///{database_file}")
    config = Config(str(ALEMBIC_CONFIG))
    command.upgrade(config, "head")
    engine = create_engine(f"sqlite:///{database_file}")
    expected = {"scenarios", "runs", "decision_history", "model_versions", "audit_log", "alembic_version"}
    assert expected <= set(inspect(engine).get_table_names())
    command.downgrade(config, "base")
    assert not (expected - {"alembic_version"}) & set(inspect(engine).get_table_names())
    engine.dispose()


def test_decision_history_survives_database_engine_restart(tmp_path, monkeypatch) -> None:
    database_file = tmp_path / "persistence-test.db"
    monkeypatch.setenv("AEGIS_DATABASE_URL", f"sqlite:///{database_file}")
    config = Config(str(ALEMBIC_CONFIG))
    command.upgrade(config, "head")
    get_session_factory.cache_clear()
    run_id = repository.start_run({"scenarioId": "test", "emitterCount": 1, "durationSeconds": 30, "seed": 1}, "test-policy", "test-checkpoint")
    repository.record_decision(run_id, {"id": "DEC-1", "timestamp": "00:00:00", "result": "HIT", "band": "rf-01", "action": "SCAN", "reward": 1.0})
    get_session_factory().kw["bind"].dispose()
    get_session_factory.cache_clear()
    assert repository.query_history()["items"] == [{"id": "DEC-1", "timestamp": "00:00:00", "result": "HIT", "band": "rf-01", "action": "SCAN", "reward": 1.0}]
    get_session_factory().kw["bind"].dispose()
    get_session_factory.cache_clear()


def test_scenario_run_model_and_audit_crud(tmp_path, monkeypatch) -> None:
    database_file = tmp_path / "crud-test.db"
    monkeypatch.setenv("AEGIS_DATABASE_URL", f"sqlite:///{database_file}")
    command.upgrade(Config(str(ALEMBIC_CONFIG)), "head")
    get_session_factory.cache_clear()
    config = {"scenarioId": "crud-scenario", "emitterCount": 2, "durationSeconds": 60, "seed": 17}
    repository.record_scenario(config)
    run_id = repository.start_run(config, "policy-v-test", "checkpoint.zip")
    repository.record_decision(run_id, {"id": "DEC-CRUD", "timestamp": "00:00:01", "result": "HIT", "band": "rf-03", "action": "SCAN", "reward": 0.8})
    repository.stop_run(run_id, {"detections": 1}, "policy-v-test")
    assert repository.query_history(run_id=run_id)["items"][0]["id"] == "DEC-CRUD"
    factory = get_session_factory()
    with factory() as session:
        assert session.query(ScenarioRecord).filter_by(scenario_id="crud-scenario").count() >= 1
        run = session.get(RunRecord, run_id)
        assert run and run.ended_at is not None and run.final_aggregate_metrics == {"detections": 1}
        assert session.query(ModelVersionRecord).filter_by(version="policy-v-test").one().checkpoint == "checkpoint.zip"
        assert {entry.action for entry in session.query(AuditRecord).filter_by(run_id=run_id).all()} == {"SCENARIO_START", "SCENARIO_STOP"}
    factory.kw["bind"].dispose()
    get_session_factory.cache_clear()
