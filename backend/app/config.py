"""Settings, read from the environment with a `SUDOKU_` prefix.

Copy `.env.example` to `.env` to override any of these locally.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the API."""

    model_config = SettingsConfigDict(
        env_prefix="SUDOKU_", env_file=".env", extra="ignore"
    )

    app_name: str = "Sudoku Solver (OR-Tools CP-SAT)"
    api_prefix: str = "/api"

    #: Origins allowed to call the API — the Vite dev server by default.
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    #: Ceiling CP-SAT is given for a single request, in seconds.
    solver_time_limit_s: float = 10.0

    #: Search workers for a single-solution solve.
    solver_workers: int = 8


@lru_cache
def get_settings() -> Settings:
    """Settings singleton; cached so the env is read once per process."""
    return Settings()
