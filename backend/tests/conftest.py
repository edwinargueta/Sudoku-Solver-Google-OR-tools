"""Shared fixtures: one TestClient for the whole API suite."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture(scope="session")
def client() -> TestClient:
    """A client bound to an app built from explicit settings, not the environment."""
    app = create_app(Settings(cors_origins=["http://localhost:5173"]))
    return TestClient(app)
