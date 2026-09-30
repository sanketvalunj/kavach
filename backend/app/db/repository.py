from datetime import datetime, timezone
from uuid import uuid4
import logging
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from .database import get_session_factory
from .models import AuditRecord, DecisionRecord, ModelVersionRecord, RunRecord, ScenarioRecord

logger = logging.getLogger(__name__)


def _session() -> Session:
    return get_session_factory()()


def check_connection() -> bool:
    try:
        with _session() as session:
            session.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.exception("database_health_check_failed")
        return False


def record_scenario(config: dict) -> None:
    with _session() as session, session.begin():
        session.add(ScenarioRecord(scenario_id=config["scenarioId"], config=config, seed=config["seed"]))


def start_run(config: dict, model_version: str, checkpoint: str) -> str:
    run_id = str(uuid4())
    with _session() as session, session.begin():
        session.add(ScenarioRecord(scenario_id=config["scenarioId"], config=config, seed=config["seed"]))
        existing_model = session.scalar(select(ModelVersionRecord).where(ModelVersionRecord.version == model_version))
        if existing_model:
            existing_model.checkpoint = checkpoint
        else:
            session.add(ModelVersionRecord(version=model_version, checkpoint=checkpoint, metadata_json={"source": "runtime policy configuration"}))
        session.add(RunRecord(id=run_id, scenario_id=config["scenarioId"], data_source_mode="LIVE_BACKEND"))
        session.add(AuditRecord(run_id=run_id, action="SCENARIO_START", model_version=model_version, details={"config": config}))
    return run_id


def stop_run(run_id: str | None, metrics: dict, model_version: str) -> None:
    if not run_id:
        return
    with _session() as session, session.begin():
        run = session.get(RunRecord, run_id)
        if run:
            run.ended_at = datetime.now(timezone.utc)
            run.final_aggregate_metrics = metrics
            session.add(AuditRecord(run_id=run_id, action="SCENARIO_STOP", model_version=model_version, details={"metrics": metrics}))


def record_decision(run_id: str | None, decision: dict) -> None:
    if not run_id:
        return
    with _session() as session, session.begin():
        session.add(DecisionRecord(run_id=run_id, decision_id=decision["id"], timestamp=decision["timestamp"], result=decision["result"], band=decision["band"], action=decision["action"], payload=decision))


def query_history(limit: int = 50, offset: int = 0, run_id: str | None = None, result: str | None = None, band: str | None = None) -> dict:
    limit = min(max(limit, 1), 500)
    with _session() as session:
        query = select(DecisionRecord)
        count_query = select(func.count()).select_from(DecisionRecord)
        for model, value in ((DecisionRecord.run_id, run_id), (DecisionRecord.result, result)):
            if value:
                query = query.where(model == value)
                count_query = count_query.where(model == value)
        if band:
            query = query.where(DecisionRecord.band.ilike(f"%{band}%"))
            count_query = count_query.where(DecisionRecord.band.ilike(f"%{band}%"))
        records = session.scalars(query.order_by(DecisionRecord.id.desc()).offset(offset).limit(limit)).all()
        total = session.scalar(count_query) or 0
        return {"items": [record.payload for record in records], "total": total, "limit": limit, "offset": offset}
