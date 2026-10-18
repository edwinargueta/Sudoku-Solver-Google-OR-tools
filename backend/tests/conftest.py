"""Shared fixtures: a clean environment for every test, one TestClient for the
whole API suite, and a way to get another built with different settings."""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app


@pytest.fixture(scope="session", autouse=True)
def _clean_environment() -> Iterator[None]:
    """No SUDOKU_ variable from the shell reaches a test.

    Passing a field to Settings does not shield it: pydantic-settings decodes
    a list such as SUDOKU_CORS_ORIGINS before the argument replaces it, so a
    value that is not JSON fails every create_app. Session-scoped, because the
    session `client` is built before any per-test fixture runs; a test's own
    monkeypatch.setenv still applies, and is undone back to this.
    """
    with pytest.MonkeyPatch.context() as patch:
        for name in list(os.environ):
            if name.startswith("SUDOKU_"):
                patch.delenv(name)
        yield


@pytest.fixture(autouse=True)
def _fresh_settings() -> None:
    """get_settings is lru_cached; each test reads the environment it set up."""
    get_settings.cache_clear()


def make_settings(**overrides: Any) -> Settings:
    """Settings for a test app, every field spelt out.

    `_env_file=None` skips backend/.env, and `_clean_environment` has cleared
    every SUDOKU_ variable, so neither a local .env nor the shell can change
    what a test runs against.
    """
    values: dict[str, Any] = {
        "app_name": "Sudoku Solver (test)",
        "cors_origins": ["http://localhost:5173"],
        "solver_time_limit_s": 10.0,
        "solver_workers": 1,
        "solver_concurrency": 4,
    }
    return Settings(_env_file=None, **(values | overrides))


@pytest.fixture(scope="session")
def client() -> TestClient:
    """A client bound to an app built from explicit settings, not the environment."""
    return TestClient(create_app(make_settings()))


@pytest.fixture
def client_with() -> Callable[..., TestClient]:
    """A client for an app built with some settings changed, for one test.

    `raise_server_exceptions=False` turns an unhandled error into the 500 a
    real client would get, for tests that are about exactly that.
    """

    def build(*, raise_server_exceptions: bool = True, **overrides: Any) -> TestClient:
        app = create_app(make_settings(**overrides))
        return TestClient(app, raise_server_exceptions=raise_server_exceptions)

    return build
