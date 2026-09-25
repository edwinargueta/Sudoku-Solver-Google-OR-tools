"""Settings: the defaults, the SUDOKU_ prefix, and the cached singleton.

`_env_file=None` everywhere on purpose — a developer's `.env` must not be
able to change what these assert.
"""

from __future__ import annotations

import pytest

from app.config import Settings, get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    """get_settings is lru_cached, so a test's environment must not leak."""
    get_settings.cache_clear()


class TestDefaults:
    def test_ships_usable_values_with_nothing_set(self) -> None:
        settings = Settings(_env_file=None)
        assert settings.api_prefix == "/api"
        assert settings.solver_time_limit_s == 10.0
        assert settings.solver_workers == 8
        assert "http://localhost:5173" in settings.cors_origins


class TestEnvironment:
    def test_reads_prefixed_variables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_WORKERS", "2")
        monkeypatch.setenv("SUDOKU_SOLVER_TIME_LIMIT_S", "1.5")
        settings = Settings(_env_file=None)
        assert settings.solver_workers == 2
        assert settings.solver_time_limit_s == 1.5

    def test_ignores_variables_without_the_prefix(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SOLVER_WORKERS", "99")
        assert Settings(_env_file=None).solver_workers == 8

    def test_parses_the_origins_list_as_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUDOKU_CORS_ORIGINS", '["https://example.test"]')
        assert Settings(_env_file=None).cors_origins == ["https://example.test"]

    def test_rejects_a_value_of_the_wrong_type(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_WORKERS", "not a number")
        with pytest.raises(ValueError):
            Settings(_env_file=None)


class TestSingleton:
    def test_hands_back_the_same_object_every_time(self) -> None:
        assert get_settings() is get_settings()
