# Database persistence and schema versions

PostgreSQL is the durable source of truth for live runs, scenarios, decisions, model versions, and audit entries. Database schema versioning uses Alembic revision IDs; `0001_initial` is the first released schema revision. Add a new revision for every schema change; do not edit a revision after it has been applied to a shared database. The frontend's `sessionStorage` snapshot is only an offline/demo resume cache and does not replace server records; snapshots carry `schemaVersion: 2`, accept unversioned version-1 snapshots, and discard snapshots from unsupported newer versions.

Start PostgreSQL from this directory with `docker compose up -d postgres`, then set `AEGIS_DATABASE_URL=postgresql+psycopg://aegis:aegis@localhost:5432/aegis` (the default) and run `alembic upgrade head`. To roll back one revision use `alembic downgrade -1`; to rebuild an empty database use `alembic downgrade base` followed by `alembic upgrade head`. Back up the PostgreSQL volume before production migrations; downgrades intentionally remove data in tables created by the reverted revision.

Run `pytest tests/test_migrations.py` to verify the initial migration upgrades and rolls back cleanly using an isolated SQLite database. Runtime persistence itself targets PostgreSQL.
