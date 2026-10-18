"""Settings: the defaults, the SUDOKU_ prefix, the bounds, and the singleton.

`_env_file=None` everywhere on purpose, and conftest clears every SUDOKU_
variable for the whole run — neither a developer's `.env` nor their shell must
be able to change what these assert.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from app import config
from app.config import Settings, available_cpus, get_settings


class TestDefaults:
    def test_ships_usable_values_with_nothing_set(self) -> None:
        settings = Settings(_env_file=None)
        assert settings.solver_time_limit_s == 10.0
        assert settings.solver_workers == 1, "one worker is the fastest on 9x9"
        assert settings.solver_concurrency == available_cpus()
        assert "http://localhost:5173" in settings.cors_origins

    def test_the_api_prefix_is_not_a_setting(self) -> None:
        # /api is written into the probes, nginx, the ingress and the client,
        # so a setting that moved it would only break them.
        assert "api_prefix" not in Settings.model_fields


class TestAvailableCpus:
    def test_counts_the_cpus_the_process_may_run_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(os, "sched_getaffinity", lambda pid: {0, 2, 5}, raising=False)
        monkeypatch.setattr(os, "cpu_count", lambda: 64)
        assert available_cpus() == 3

    def test_falls_back_to_the_machine_without_an_affinity_mask(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delattr(os, "sched_getaffinity", raising=False)
        monkeypatch.setattr(os, "cpu_count", lambda: 6)
        assert available_cpus() == 6

    def test_is_never_less_than_one(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delattr(os, "sched_getaffinity", raising=False)
        monkeypatch.setattr(os, "cpu_count", lambda: None)
        assert available_cpus() == 1


class TestEnvFile:
    def test_is_looked_for_in_the_backend_folder(self) -> None:
        backend = Path(__file__).resolve().parent.parent
        assert config.ENV_FILE == backend / ".env"
        assert Settings.model_config["env_file"] == config.ENV_FILE

    def test_one_in_the_working_directory_is_not_read(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        (tmp_path / ".env").write_text("SUDOKU_APP_NAME=from-the-cwd\n")
        monkeypatch.chdir(tmp_path)
        assert Settings().app_name != "from-the-cwd"


class TestEnvironment:
    def test_reads_prefixed_variables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_WORKERS", "2")
        monkeypatch.setenv("SUDOKU_SOLVER_TIME_LIMIT_S", "1.5")
        settings = Settings(_env_file=None)
        assert settings.solver_workers == 2
        assert settings.solver_time_limit_s == 1.5

    def test_ignores_variables_without_the_prefix(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SOLVER_WORKERS", "4")
        assert Settings(_env_file=None).solver_workers == 1

    def test_parses_the_origins_list_as_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUDOKU_CORS_ORIGINS", '["https://example.test"]')
        assert Settings(_env_file=None).cors_origins == ["https://example.test"]

    def test_reads_the_concurrency_limit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_CONCURRENCY", "3")
        assert Settings(_env_file=None).solver_concurrency == 3

    def test_rejects_a_value_of_the_wrong_type(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_WORKERS", "not a number")
        with pytest.raises(ValueError):
            Settings(_env_file=None)


class TestBounds:
    """A typo in a ConfigMap has to stop the rollout, not every solve."""

    @pytest.mark.parametrize("value", ["0", "-1", "-2", "17", "100000"])
    def test_rejects_a_worker_count_cp_sat_would_refuse(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_WORKERS", value)
        with pytest.raises(ValueError, match="solver_workers"):
            Settings(_env_file=None)

    @pytest.mark.parametrize("value", ["1", "16"])
    def test_accepts_the_worker_counts_at_the_edges(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_WORKERS", value)
        assert Settings(_env_file=None).solver_workers == int(value)

    @pytest.mark.parametrize("value", ["0", "-5", "60.5", "nan", "inf"])
    def test_rejects_a_time_limit_outside_zero_to_sixty(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_TIME_LIMIT_S", value)
        with pytest.raises(ValueError, match="solver_time_limit_s"):
            Settings(_env_file=None)

    @pytest.mark.parametrize("value", ["0.01", "60"])
    def test_accepts_the_time_limits_at_the_edges(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_TIME_LIMIT_S", value)
        assert Settings(_env_file=None).solver_time_limit_s == float(value)

    @pytest.mark.parametrize("value", ["0", "-1"])
    def test_rejects_a_concurrency_below_one(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        monkeypatch.setenv("SUDOKU_SOLVER_CONCURRENCY", value)
        with pytest.raises(ValueError, match="solver_concurrency"):
            Settings(_env_file=None)


class TestSingleton:
    def test_hands_back_the_same_object_every_time(self) -> None:
        assert get_settings() is get_settings()


class TestSuiteIsolation:
    def test_an_exported_variable_cannot_break_the_suite(self) -> None:
        # A list is decoded as JSON before an argument can replace it, so a
        # comma-separated SUDOKU_CORS_ORIGINS in the shell used to fail every
        # app the tests built, the shared client's first.
        backend = Path(__file__).resolve().parent.parent
        env = os.environ | {
            "SUDOKU_CORS_ORIGINS": "http://a.test,http://b.test",
            "SUDOKU_SOLVER_WORKERS": "not a number",
        }
        run = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-p",
                "no:cacheprovider",
                "tests/test_api.py::TestCors::test_allows_the_vite_dev_server",
                "tests/test_api.py::TestAppFactory::test_every_route_reads_the_settings_it_was_built_with",
                "tests/test_config.py::TestDefaults::test_ships_usable_values_with_nothing_set",
            ],
            cwd=backend,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert run.returncode == 0, run.stdout + run.stderr
