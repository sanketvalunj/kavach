from enum import StrEnum

from pydantic_settings import BaseSettings, SettingsConfigDict


class BackendMode(StrEnum):
    SIMULATION = "SIMULATION"
    DATASET_REPLAY = "DATASET_REPLAY"
    LIVE = "LIVE"


class PolicyMode(StrEnum):
    DETERMINISTIC = "DETERMINISTIC"
    TRAINED = "TRAINED"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AEGIS_", env_file=".env", extra="ignore")

    app_name: str = "Aegis EW Command Backend"
    app_version: str = "0.1.0"
    backend_mode: BackendMode = BackendMode.SIMULATION
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    policy_mode: PolicyMode = PolicyMode.DETERMINISTIC
    policy_checkpoint: str = "app/ml/checkpoints/ppo_ablations/complete_smart_scan/final.zip"
    database_url: str = "postgresql+psycopg://aegis:aegis@localhost:5432/aegis"
    jwt_secret: str = ""
    jwt_expiration_minutes: int = 60
    operator_username: str = ""
    operator_password: str = ""
    researcher_username: str = ""
    researcher_password: str = ""
    inference_timeout_seconds: float = 2.0


settings = Settings()
