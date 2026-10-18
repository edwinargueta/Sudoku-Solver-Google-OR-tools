"""Settings, read from the environment with a `SUDOKU_` prefix.

Copy `.env.example` to `backend/.env` to override any of these locally. The
file is looked for next to the `app` package rather than in the working
directory, so it applies wherever uvicorn or pytest is started from.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.sudoku.solver import MAX_TIME_LIMIT_S

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def available_cpus() -> int:
    """How many CPUs this process may run on, and never fewer than one."""
    try:
        return max(1, len(os.sched_getaffinity(0)))
    except AttributeError:  # macOS and Windows have no affinity mask to read
        return os.cpu_count() or 1


class Settings(BaseSettings):
    """Runtime configuration for the API.

    Out-of-range values fail at startup: a typo in a ConfigMap should stop the
    rollout, not leave every solve quietly returning UNKNOWN.
    """

    model_config = SettingsConfigDict(env_prefix="SUDOKU_", env_file=ENV_FILE, extra="ignore")

    app_name: str = "Sudoku Solver (OR-Tools CP-SAT)"

    #: Origins allowed to call the API — the Vite dev server by default.
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    #: Seconds CP-SAT gets for a request, and the most a request may ask for.
    solver_time_limit_s: float = Field(default=10.0, gt=0, le=MAX_TIME_LIMIT_S)

    #: Search workers for a single-solution solve. One is the fastest on 9x9.
    solver_workers: int = Field(default=1, ge=1, le=16)

    #: Solves allowed to run at once; one more is turned away with a 503
    #: instead of queuing. Defaults to the CPUs the process may run on.
    solver_concurrency: int = Field(default_factory=available_cpus, ge=1)


@lru_cache
def get_settings() -> Settings:
    """Settings singleton; cached so the env is read once per process."""
    return Settings()
