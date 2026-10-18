"""HTTP contract: status codes, payload shapes, and validation errors."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import anyio
import pytest
from fastapi.responses import PlainTextResponse
from fastapi.testclient import TestClient
from ortools.sat.python import cp_model
from starlette.types import Message, Receive, Scope, Send

from app.api import routes
from app.main import MAX_BODY_BYTES, BodySizeLimit
from app.sudoku.board import empty_grid, parse_grid, render
from app.sudoku.puzzles import LEVELS, PUZZLES
from app.sudoku.solver import MAX_SOLUTIONS_CAP
from app.sudoku.solver import solve as real_solve

EASY = PUZZLES["easy-1"].puzzle
JSON = {"content-type": "application/json"}
BUSY = "The solver is busy. Try again in a moment."

ClientFactory = Callable[..., TestClient]


def spy_on_solve(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Record the keyword arguments each /solve hands the solver."""
    calls: list[dict[str, Any]] = []

    def spy(grid: Any, **kwargs: Any) -> Any:
        calls.append(kwargs)
        return real_solve(grid, **kwargs)

    monkeypatch.setattr(routes, "solve_grid", spy)
    return calls


class TestMeta:
    def test_root_points_at_the_docs(self, client: TestClient) -> None:
        body = client.get("/").json()
        assert body["docs"] == "/docs"
        assert body["api"] == "/api"

    def test_health_reports_the_ortools_build(self, client: TestClient) -> None:
        response = client.get("/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["ortools_version"].count(".") >= 2

    def test_openapi_schema_is_served(self, client: TestClient) -> None:
        assert client.get("/openapi.json").status_code == 200

    def test_health_answers_while_every_worker_thread_is_taken(
        self, client_with: ClientFactory
    ) -> None:
        # Probes must not queue behind solves: once they time out, the pod is
        # pulled from the Service and then restarted.
        holder = object()
        with client_with() as client:

            async def take_every_thread() -> int:
                limiter = anyio.to_thread.current_default_thread_limiter()
                total = int(limiter.total_tokens)
                limiter.total_tokens = 1
                await limiter.acquire_on_behalf_of(holder)
                return total

            async def give_them_back(total: int) -> None:
                limiter = anyio.to_thread.current_default_thread_limiter()
                limiter.release_on_behalf_of(holder)
                limiter.total_tokens = total

            def call(path: str, into: list[int]) -> threading.Thread:
                thread = threading.Thread(target=lambda: into.append(client.get(path).status_code))
                thread.start()
                return thread

            total = client.portal.call(take_every_thread)
            try:
                levels: list[int] = []
                queued = call("/api/levels", levels)
                queued.join(0.3)
                assert levels == [], "a sync route should be waiting for a thread"

                health: list[int] = []
                call("/api/health", health).join(5)
                assert health == [200]
            finally:
                client.portal.call(give_them_back, total)
            queued.join(5)
            assert levels == [200]


class TestAppFactory:
    def test_every_route_reads_the_settings_it_was_built_with(
        self, client_with: ClientFactory, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUDOKU_APP_NAME", "from the environment")
        monkeypatch.setenv("SUDOKU_SOLVER_WORKERS", "3")
        client = client_with(app_name="Injected", solver_workers=2)
        calls = spy_on_solve(monkeypatch)

        assert client.get("/").json()["name"] == "Injected"
        assert client.get("/api/health").json()["app_name"] == "Injected"
        client.post("/api/solve", json={"puzzle": EASY})
        assert calls[0]["workers"] == 2

    def test_importing_the_module_reads_no_settings(self) -> None:
        # The app uvicorn serves is built on first use, so a broken value in
        # the environment cannot stop the test suite from importing create_app.
        backend = Path(__file__).resolve().parent.parent
        env = os.environ | {"SUDOKU_SOLVER_WORKERS": "not a number"}
        importing = subprocess.run(
            [sys.executable, "-c", "from app.main import create_app"],
            cwd=backend,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert importing.returncode == 0, importing.stderr

        serving = subprocess.run(
            [sys.executable, "-c", "from app.main import app"],
            cwd=backend,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert "solver_workers" in serving.stderr, "the served app does read them"


class TestPuzzleRoutes:
    def test_lists_every_sample(self, client: TestClient) -> None:
        body = client.get("/api/puzzles").json()
        assert {p["key"] for p in body} == set(PUZZLES)

    def test_each_entry_carries_both_representations(self, client: TestClient) -> None:
        entry = next(p for p in client.get("/api/puzzles").json() if p["key"] == "easy-1")
        assert entry["puzzle"] == EASY
        assert entry["grid"] == parse_grid(EASY)
        assert entry["givens"] == 30

    def test_fetches_one_by_key(self, client: TestClient) -> None:
        response = client.get("/api/puzzles/evil-1")
        assert response.status_code == 200
        assert response.json()["label"] == "Evil #1"

    def test_unknown_key_is_404(self, client: TestClient) -> None:
        response = client.get("/api/puzzles/impossible")
        assert response.status_code == 404
        # The message itself, not str(KeyError), which wraps it in quotes.
        assert response.json() == {
            "detail": f"unknown puzzle 'impossible'; try one of {sorted(PUZZLES)}"
        }


class TestLevelRoutes:
    def test_lists_every_level_with_its_size(self, client: TestClient) -> None:
        body = client.get("/api/levels").json()
        assert [level["key"] for level in body] == list(LEVELS)
        assert {level["key"]: level["count"] for level in body} == {
            key: len(level.puzzles) for key, level in LEVELS.items()
        }

    def test_random_draws_from_the_level_asked_for(self, client: TestClient) -> None:
        keys = {PUZZLES[k].key for k in PUZZLES if PUZZLES[k].level == "medium"}
        drawn = set()
        for _ in range(60):
            body = client.get("/api/levels/medium/random").json()
            assert body["level"] == "medium"
            drawn.add(body["key"])
        assert drawn <= keys
        assert len(drawn) > 1, "60 draws should not keep returning the same puzzle"

    def test_random_carries_the_full_puzzle_payload(self, client: TestClient) -> None:
        body = client.get("/api/levels/easy/random").json()
        assert body["grid"] == parse_grid(body["puzzle"])
        assert body["givens"] == sum(cell != 0 for row in body["grid"] for cell in row)

    def test_unknown_level_is_404(self, client: TestClient) -> None:
        response = client.get("/api/levels/impossible/random")
        assert response.status_code == 404
        assert response.json() == {
            "detail": f"unknown level 'impossible'; try one of {sorted(LEVELS)}"
        }

    def test_random_never_redeals_the_excluded_puzzle(self, client: TestClient) -> None:
        drawn = set()
        for _ in range(60):
            response = client.get("/api/levels/easy/random", params={"exclude": "easy-1"})
            assert response.status_code == 200
            drawn.add(response.json()["key"])
        assert "easy-1" not in drawn
        assert len(drawn) > 1

    def test_an_exclude_from_another_level_is_ignored(self, client: TestClient) -> None:
        response = client.get("/api/levels/hard/random", params={"exclude": "nope"})
        assert response.status_code == 200
        assert response.json()["level"] == "hard"

    def test_excluding_the_blank_board_still_deals_it(self, client: TestClient) -> None:
        response = client.get("/api/levels/blank/random", params={"exclude": "blank"})
        assert response.json()["key"] == "blank"


class TestSolveRoute:
    def test_solves_from_a_puzzle_string(self, client: TestClient) -> None:
        response = client.post("/api/solve", json={"puzzle": EASY})
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "SOLVED"
        assert body["solution"][0] == [5, 3, 4, 6, 7, 8, 9, 1, 2]

    def test_solves_from_a_grid(self, client: TestClient) -> None:
        response = client.post("/api/solve", json={"grid": parse_grid(EASY)})
        assert response.status_code == 200
        assert response.json()["status"] == "SOLVED"

    def test_solves_a_pretty_printed_puzzle_string(self, client: TestClient) -> None:
        response = client.post("/api/solve", json={"puzzle": render(parse_grid(EASY))})
        assert response.status_code == 200
        assert response.json()["solution"][0] == [5, 3, 4, 6, 7, 8, 9, 1, 2]

    def test_reports_uniqueness_when_asked_for_two(self, client: TestClient) -> None:
        body = client.post("/api/solve", json={"puzzle": EASY, "max_solutions": 2}).json()
        assert body["solution_count"] == 1
        assert body["unique"] is True
        assert body["exhaustive"] is True
        assert body["truncated"] is False

    def test_blank_grid_is_not_unique(self, client: TestClient) -> None:
        body = client.post("/api/solve", json={"grid": empty_grid(), "max_solutions": 2}).json()
        assert body["solution_count"] == 2
        assert body["unique"] is False
        assert body["exhaustive"] is False
        assert body["truncated"] is True

    def test_a_single_solve_is_never_exhaustive(self, client: TestClient) -> None:
        body = client.post("/api/solve", json={"puzzle": EASY}).json()
        assert body["unique"] is False
        assert body["exhaustive"] is False
        assert body["truncated"] is True

    def test_the_most_solutions_allowed_is_still_truncated(self, client: TestClient) -> None:
        payload = {"grid": empty_grid(), "max_solutions": MAX_SOLUTIONS_CAP}
        body = client.post("/api/solve", json=payload).json()
        assert body["solution_count"] == MAX_SOLUTIONS_CAP
        assert body["truncated"] is True

    def test_includes_search_statistics(self, client: TestClient) -> None:
        body = client.post("/api/solve", json={"puzzle": EASY}).json()
        assert body["wall_time_ms"] > 0
        assert "branches" in body

    def test_contradictory_givens_return_conflicts_not_an_error(self, client: TestClient) -> None:
        grid = empty_grid()
        grid[0][0] = grid[0][4] = 6
        response = client.post("/api/solve", json={"grid": grid})
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "INFEASIBLE"
        assert body["solution"] is None
        assert [c["message"] for c in body["conflicts"]] == [
            "r1c1=6 repeats in its row",
            "r1c5=6 repeats in its row",
        ]

    def test_requires_exactly_one_of_grid_or_puzzle(self, client: TestClient) -> None:
        assert client.post("/api/solve", json={}).status_code == 422
        both = {"puzzle": EASY, "grid": parse_grid(EASY)}
        assert client.post("/api/solve", json=both).status_code == 422

    def test_rejects_a_short_puzzle_string(self, client: TestClient) -> None:
        assert client.post("/api/solve", json={"puzzle": "." * 80}).status_code == 422

    def test_rejects_a_puzzle_string_past_the_length_bound(self, client: TestClient) -> None:
        response = client.post("/api/solve", json={"puzzle": EASY + " " * 1_000})
        assert response.status_code == 422
        assert response.json()["detail"][0]["type"] == "string_too_long"

    def test_rejects_a_digit_from_another_script(self, client: TestClient) -> None:
        # '٣' is an Arabic-Indic 3; str.isdigit() would have let it through.
        assert client.post("/api/solve", json={"puzzle": "٣" + "." * 80}).status_code == 422

    def test_rejects_a_malformed_grid(self, client: TestClient) -> None:
        assert client.post("/api/solve", json={"grid": [[0] * 9] * 8}).status_code == 422

    def test_rejects_an_out_of_range_cell(self, client: TestClient) -> None:
        grid = empty_grid()
        grid[3][3] = 42
        assert client.post("/api/solve", json={"grid": grid}).status_code == 422

    @pytest.mark.parametrize("cell", [True, False, "5", 5.0, 5.5, None])
    def test_a_cell_must_be_a_json_integer(self, client: TestClient, cell: Any) -> None:
        grid: list[list[Any]] = empty_grid()
        grid[0][1] = cell
        for path in ("/api/solve", "/api/validate"):
            response = client.post(path, json={"grid": grid})
            assert response.status_code == 422, f"{path} took {cell!r}"
            assert response.json()["detail"][0]["loc"] == ["body", "grid", 0, 1]

    @pytest.mark.parametrize("value", [0, 1001, -1, True, "2", 2.0])
    def test_rejects_a_bad_max_solutions(self, client: TestClient, value: Any) -> None:
        payload = {"puzzle": EASY, "max_solutions": value}
        assert client.post("/api/solve", json=payload).status_code == 422

    @pytest.mark.parametrize("value", [0, -1, 60.5, 999, "1", True])
    def test_rejects_a_bad_time_limit(self, client: TestClient, value: Any) -> None:
        payload = {"puzzle": EASY, "time_limit_s": value}
        assert client.post("/api/solve", json=payload).status_code == 422

    @pytest.mark.parametrize("value", [1, 0.5, 60])
    def test_accepts_a_time_limit_as_an_int_or_a_float(
        self, client: TestClient, value: float
    ) -> None:
        payload = {"puzzle": EASY, "time_limit_s": value}
        assert client.post("/api/solve", json=payload).status_code == 200

    def test_a_misspelt_field_is_an_error_not_a_default(self, client: TestClient) -> None:
        response = client.post("/api/solve", json={"puzzle": EASY, "max_solution": 2})
        assert response.status_code == 422
        assert response.json()["detail"] == [
            {
                "type": "extra_forbidden",
                "loc": ["body", "max_solution"],
                "msg": "Extra inputs are not permitted",
            }
        ]


class TestSolveLimits:
    def test_the_server_limit_applies_when_the_request_names_none(
        self, client_with: ClientFactory, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client = client_with(solver_time_limit_s=2.0, solver_workers=3)
        calls = spy_on_solve(monkeypatch)
        client.post("/api/solve", json={"puzzle": EASY})
        assert calls[0]["time_limit_s"] == 2.0
        assert calls[0]["workers"] == 3

    @pytest.mark.parametrize(("asked", "given"), [(0.5, 0.5), (2.0, 2.0), (30, 2.0)])
    def test_a_request_may_ask_for_less_time_but_not_more(
        self,
        client_with: ClientFactory,
        monkeypatch: pytest.MonkeyPatch,
        asked: float,
        given: float,
    ) -> None:
        client = client_with(solver_time_limit_s=2.0)
        calls = spy_on_solve(monkeypatch)
        client.post("/api/solve", json={"puzzle": EASY, "time_limit_s": asked})
        assert calls[0]["time_limit_s"] == given

    def test_turns_a_solve_away_when_every_slot_is_taken(self, client_with: ClientFactory) -> None:
        client = client_with(solver_concurrency=1)
        slots = client.app.state.solve_slots
        assert slots.acquire(blocking=False), "the one slot should be free"
        try:
            response = client.post("/api/solve", json={"puzzle": EASY})
        finally:
            slots.release()
        assert response.status_code == 503
        assert response.headers["retry-after"] == "1"
        assert response.json() == {"detail": BUSY}

        assert client.post("/api/solve", json={"puzzle": EASY}).status_code == 200

    def test_the_other_routes_do_not_wait_for_a_slot(self, client_with: ClientFactory) -> None:
        client = client_with(solver_concurrency=1)
        slots = client.app.state.solve_slots
        slots.acquire()
        try:
            assert client.get("/api/health").status_code == 200
            assert client.post("/api/validate", json={"grid": empty_grid()}).status_code == 200
        finally:
            slots.release()

    def test_a_solver_fault_is_a_500_and_gives_its_slot_back(
        self, client_with: ClientFactory, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A parameter CP-SAT rejects must not pass for a time limit (UNKNOWN).
        client = client_with(solver_concurrency=1, raise_server_exceptions=False)
        real = cp_model.CpSolver.solve

        def invalid(self: cp_model.CpSolver, model: Any, callback: Any = None) -> Any:
            self.parameters.num_workers = -1
            return real(self, model, callback)

        with monkeypatch.context() as patch:
            patch.setattr(cp_model.CpSolver, "solve", invalid)
            assert client.post("/api/solve", json={"puzzle": EASY}).status_code == 500
        assert client.post("/api/solve", json={"puzzle": EASY}).status_code == 200


class TestValidateRoute:
    def test_clean_puzzle_is_consistent_and_incomplete(self, client: TestClient) -> None:
        body = client.post("/api/validate", json={"grid": parse_grid(EASY)}).json()
        assert body == {
            "consistent": True,
            "complete": False,
            "givens": 30,
            "conflicts": [],
        }

    def test_solved_grid_is_complete(self, client: TestClient) -> None:
        solution = client.post("/api/solve", json={"puzzle": EASY}).json()["solution"]
        body = client.post("/api/validate", json={"grid": solution}).json()
        assert body["complete"] is True
        assert body["givens"] == 81

    def test_names_each_conflict(self, client: TestClient) -> None:
        grid = empty_grid()
        grid[0][0] = grid[1][1] = 8  # same box
        body = client.post("/api/validate", json={"grid": grid}).json()
        assert body["consistent"] is False
        assert [(c["row"], c["col"], c["unit"]) for c in body["conflicts"]] == [
            (0, 0, "box"),
            (1, 1, "box"),
        ]

    def test_flags_the_entry_as_well_as_the_clue_it_repeats(self, client: TestClient) -> None:
        # easy-1 has a 7 at r1c5; a 7 typed at r1c3 comes first in the scan.
        grid = parse_grid(EASY)
        grid[0][2] = 7
        body = client.post("/api/validate", json={"grid": grid}).json()
        assert [c["message"] for c in body["conflicts"]] == [
            "r1c3=7 repeats in its row",
            "r1c5=7 repeats in its row",
        ]

    def test_requires_a_grid(self, client: TestClient) -> None:
        assert client.post("/api/validate", json={}).status_code == 422

    def test_rejects_a_field_it_does_not_know(self, client: TestClient) -> None:
        payload = {"grid": empty_grid(), "puzzle": EASY}
        assert client.post("/api/validate", json=payload).status_code == 422


class TestValidationErrors:
    def test_say_what_was_wrong_without_repeating_the_input(self, client: TestClient) -> None:
        response = client.post("/api/solve", json={"grid": [[0] * 9] * 8})
        assert response.status_code == 422
        assert response.json() == {
            "detail": [
                {
                    "type": "too_short",
                    "loc": ["body", "grid"],
                    "msg": "List should have at least 9 items after validation, not 8",
                }
            ]
        }

    def test_a_validator_message_loses_the_value_error_prefix(self, client: TestClient) -> None:
        response = client.post("/api/solve", json={"puzzle": "." * 80})
        assert response.json()["detail"][0]["msg"] == "expected 81 cells, got 80"

    def test_an_oversized_grid_gets_a_small_answer(self, client: TestClient) -> None:
        # Under the body limit, but far past 9x9: FastAPI's own handler would
        # have sent all of it back as each error's `input`.
        grid = [[0] * 700] * 9
        response = client.post("/api/validate", json={"grid": grid})
        assert response.status_code == 422
        assert len(response.content) < 2_000, "about 12 KB came in"
        assert all(set(error) == {"type", "loc", "msg"} for error in response.json()["detail"])

    @pytest.mark.parametrize(
        "body",
        [
            '{"puzzle": "%s", "time_limit_s": NaN}',
            '{"puzzle": "%s", "time_limit_s": Infinity}',
            '{"puzzle": "%s", "time_limit_s": -Infinity}',
            '{"puzzle": "%s", "max_solutions": NaN}',
            '{"puzzle": "%s", "unknown": NaN}',
        ],
    )
    def test_nan_and_infinity_are_a_422_not_a_500(
        self, client_with: ClientFactory, body: str
    ) -> None:
        # Python's json module reads these non-standard literals, and an error
        # carrying NaN as its input cannot be written back out as JSON.
        client = client_with(raise_server_exceptions=False)
        response = client.post("/api/solve", content=body % EASY, headers=JSON)
        assert response.status_code == 422
        assert response.json()["detail"]

    def test_nan_in_a_grid_cell_is_a_422(self, client_with: ClientFactory) -> None:
        client = client_with(raise_server_exceptions=False)
        rows = ["[" + ",".join(["0"] * 9) + "]"] * 8 + ["[NaN" + ",0" * 8 + "]"]
        body = '{"grid": [' + ",".join(rows) + "]}"
        response = client.post("/api/validate", content=body, headers=JSON)
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "grid", 8, 0]


class TestBodyLimit:
    def test_a_declared_length_over_the_limit_is_refused(self, client: TestClient) -> None:
        body = b'{"puzzle": "' + b"." * MAX_BODY_BYTES + b'"}'
        response = client.post("/api/solve", content=body, headers=JSON)
        assert response.status_code == 413
        assert response.json() == {"detail": "Request body too large."}

    def test_a_chunked_body_is_counted_as_it_arrives(self, client: TestClient) -> None:
        def chunks() -> Any:
            yield b'{"grid": ['
            yield b"[0,0,0,0,0,0,0,0,0]," * (MAX_BODY_BYTES // 20 + 1)
            yield b"]}"

        response = client.post("/api/validate", content=chunks(), headers=JSON)
        assert response.status_code == 413
        assert response.json() == {"detail": "Request body too large."}

    def test_a_body_right_at_the_limit_goes_through(self, client: TestClient) -> None:
        start = f'{{"puzzle": "{EASY}"'.encode()
        body = start + b" " * (MAX_BODY_BYTES - len(start) - 1) + b"}"
        assert len(body) == MAX_BODY_BYTES
        response = client.post("/api/solve", content=body, headers=JSON)
        assert response.status_code == 200
        assert response.json()["status"] == "SOLVED"

    def test_a_chunked_body_under_the_limit_reaches_the_route_whole(
        self, client: TestClient
    ) -> None:
        def chunks() -> Any:
            yield b'{"puzzle": "'
            yield EASY.encode()
            yield b'", "max_solutions": 2}'

        response = client.post("/api/solve", content=chunks(), headers=JSON)
        assert response.status_code == 200
        assert response.json()["unique"] is True

    def test_a_413_still_carries_the_cors_headers(self, client: TestClient) -> None:
        body = b"x" * (MAX_BODY_BYTES + 1)
        headers = JSON | {"Origin": "http://localhost:5173"}
        response = client.post("/api/solve", content=body, headers=headers)
        assert response.status_code == 413
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def through_body_limit(
    limit: int, chunks: list[bytes], content_length: int | None = None
) -> tuple[int, list[bytes] | None, int]:
    """Feed a request to BodySizeLimit one ASGI message per chunk.

    Returns the status sent back, the chunks the wrapped app read (None when it
    was never called), and how many times the middleware called receive().
    """
    pending: list[Message] = [
        {"type": "http.request", "body": chunk, "more_body": n < len(chunks) - 1}
        for n, chunk in enumerate(chunks)
    ]
    sent: list[Message] = []
    reads = 0
    seen: list[bytes] | None = None

    async def receive() -> Message:
        nonlocal reads
        reads += 1
        return pending.pop(0) if pending else {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        sent.append(message)

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        nonlocal seen
        seen = []
        while True:
            message = await receive()
            seen.append(message["body"])
            if not message["more_body"]:
                break
        await PlainTextResponse("ok")(scope, receive, send)

    headers = [] if content_length is None else [(b"content-length", b"%d" % content_length)]
    scope = {"type": "http", "method": "POST", "path": "/", "headers": headers}
    anyio.run(BodySizeLimit(app, limit), scope, receive, send)
    return sent[0]["status"], seen, reads


class TestBodySizeLimitMiddleware:
    def test_a_declared_length_over_the_limit_is_refused_unread(self) -> None:
        status, seen, reads = through_body_limit(10, [b"x" * 11], content_length=11)
        assert (status, seen, reads) == (413, None, 0)

    def test_chunks_are_counted_until_they_pass_the_limit(self) -> None:
        status, seen, reads = through_body_limit(10, [b"abcd", b"efgh", b"ijkl", b"mnop"])
        assert (status, seen) == (413, None)
        assert reads == 3, "it stops reading at the chunk that crossed the limit"

    def test_a_body_that_fits_is_handed_on_chunk_for_chunk(self) -> None:
        status, seen, _ = through_body_limit(10, [b"abcd", b"efgh", b"ij"])
        assert (status, seen) == (200, [b"abcd", b"efgh", b"ij"])


@pytest.fixture(scope="module")
def schema(client: TestClient) -> dict[str, Any]:
    return client.get("/openapi.json").json()


class TestOpenApi:
    def test_documents_the_9x9_shape_of_a_grid(self, schema: dict[str, Any]) -> None:
        grid = schema["components"]["schemas"]["ValidateRequest"]["properties"]["grid"]
        assert (grid["minItems"], grid["maxItems"]) == (9, 9)
        row = grid["items"]
        assert (row["minItems"], row["maxItems"]) == (9, 9)
        assert (row["items"]["type"], row["items"]["minimum"], row["items"]["maximum"]) == (
            "integer",
            0,
            9,
        )

    def test_a_solve_response_always_says_whether_it_is_exhaustive(
        self, schema: dict[str, Any]
    ) -> None:
        assert "exhaustive" in schema["components"]["schemas"]["SolveResponse"]["required"]

    def test_documents_the_error_responses(self, schema: dict[str, Any]) -> None:
        paths = schema["paths"]
        assert "404" in paths["/api/puzzles/{key}"]["get"]["responses"]
        assert "404" in paths["/api/levels/{key}/random"]["get"]["responses"]
        assert {"413", "422", "503"} <= set(paths["/api/solve"]["post"]["responses"])
        assert {"413", "422"} <= set(paths["/api/validate"]["post"]["responses"])


class TestCors:
    def test_allows_the_vite_dev_server(self, client: TestClient) -> None:
        response = client.options(
            "/api/solve",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert "access-control-allow-credentials" not in response.headers

    def test_turns_away_an_origin_it_does_not_list(self, client: TestClient) -> None:
        response = client.options(
            "/api/solve",
            headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "POST"},
        )
        assert response.status_code == 400
        assert "access-control-allow-origin" not in response.headers

    def test_allows_content_type_and_no_other_custom_header(self, client: TestClient) -> None:
        def preflight(header: str) -> int:
            return client.options(
                "/api/solve",
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": header,
                },
            ).status_code

        assert preflight("content-type") == 200
        assert preflight("x-api-key") == 400

    def test_allows_only_the_methods_the_api_has(self, client: TestClient) -> None:
        response = client.options(
            "/api/solve",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT"},
        )
        assert response.status_code == 400

    def test_a_wildcard_origin_never_means_credentialed_access(
        self, client_with: ClientFactory
    ) -> None:
        client = client_with(cors_origins=["*"])
        response = client.get("/api/health", headers={"Origin": "https://evil.test"})
        assert response.headers["access-control-allow-origin"] == "*"
        assert "access-control-allow-credentials" not in response.headers
