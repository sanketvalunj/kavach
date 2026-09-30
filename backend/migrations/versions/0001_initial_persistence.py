"""Initial durable scenario, run, decision, model and audit tables.

Revision ID: 0001_initial
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table("scenarios", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("scenario_id", sa.String(128), nullable=False), sa.Column("config", sa.JSON(), nullable=False), sa.Column("seed", sa.Integer(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_scenarios_scenario_id", "scenarios", ["scenario_id"])
    op.create_table("runs", sa.Column("id", sa.String(36), primary_key=True), sa.Column("scenario_id", sa.String(128), nullable=False), sa.Column("started_at", sa.DateTime(timezone=True), nullable=False), sa.Column("ended_at", sa.DateTime(timezone=True)), sa.Column("data_source_mode", sa.String(32), nullable=False), sa.Column("final_aggregate_metrics", sa.JSON()))
    op.create_index("ix_runs_scenario_id", "runs", ["scenario_id"])
    op.create_table("decision_history", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("run_id", sa.String(36), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False), sa.Column("decision_id", sa.String(128), nullable=False), sa.Column("timestamp", sa.String(64), nullable=False), sa.Column("result", sa.String(16), nullable=False), sa.Column("band", sa.String(128), nullable=False), sa.Column("action", sa.String(128), nullable=False), sa.Column("payload", sa.JSON(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    for column in ("run_id", "decision_id", "timestamp", "result", "band"):
        op.create_index(f"ix_decision_history_{column}", "decision_history", [column])
    op.create_table("model_versions", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("version", sa.String(128), nullable=False, unique=True), sa.Column("checkpoint", sa.Text(), nullable=False), sa.Column("metadata_json", sa.JSON(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_model_versions_version", "model_versions", ["version"])
    op.create_table("audit_log", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("run_id", sa.String(36), sa.ForeignKey("runs.id", ondelete="SET NULL")), sa.Column("actor", sa.String(128), nullable=False), sa.Column("action", sa.String(64), nullable=False), sa.Column("model_version", sa.String(128)), sa.Column("details", sa.JSON(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_audit_log_run_id", "audit_log", ["run_id"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])

def downgrade() -> None:
    op.drop_index("ix_audit_log_action", table_name="audit_log")
    op.drop_index("ix_audit_log_run_id", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("ix_model_versions_version", table_name="model_versions")
    op.drop_table("model_versions")
    for column in reversed(("run_id", "decision_id", "timestamp", "result", "band")):
        op.drop_index(f"ix_decision_history_{column}", table_name="decision_history")
    op.drop_table("decision_history")
    op.drop_index("ix_runs_scenario_id", table_name="runs")
    op.drop_table("runs")
    op.drop_index("ix_scenarios_scenario_id", table_name="scenarios")
    op.drop_table("scenarios")
