"""Application settings loaded from environment variables."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables."""

    model_config = SettingsConfigDict(env_prefix="INTERVALS_", env_file=".env")

    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "info"
    data_dir: str = "~/.intervals"
    cors_origins: list[str] = ["http://localhost:5173"]


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
