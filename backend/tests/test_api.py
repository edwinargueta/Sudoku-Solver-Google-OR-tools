"""HTTP contract: status codes, payload shapes, and validation errors."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.sudoku.board import empty_grid, parse_grid
from app.sudoku.puzzles import LEVELS, PUZZLES

EASY = PUZZLES["easy-1"].puzzle


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
        assert "unknown puzzle" in response.json()["detail"]


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
        assert "unknown level" in response.json()["detail"]


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

    def test_reports_uniqueness_when_asked_for_two(self, client: TestClient) -> None:
        body = client.post("/api/solve", json={"puzzle": EASY, "max_solutions": 2}).json()
        assert body["solution_count"] == 1
        assert body["unique"] is True
        assert body["truncated"] is False

    def test_blank_grid_is_not_unique(self, client: TestClient) -> None:
        body = client.post(
            "/api/solve", json={"grid": empty_grid(), "max_solutions": 2}
        ).json()
        assert body["solution_count"] == 2
        assert body["unique"] is False
        assert body["truncated"] is True

    def test_includes_search_statistics(self, client: TestClient) -> None:
        body = client.post("/api/solve", json={"puzzle": EASY}).json()
        assert body["wall_time_ms"] > 0
        assert "branches" in body

    def test_contradictory_givens_return_conflicts_not_an_error(
        self, client: TestClient
    ) -> None:
        grid = empty_grid()
        grid[0][0] = grid[0][4] = 6
        response = client.post("/api/solve", json={"grid": grid})
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "INFEASIBLE"
        assert body["solution"] is None
        assert body["conflicts"][0]["unit"] == "row"
        assert body["conflicts"][0]["message"].startswith("r1c5=6")

    def test_requires_exactly_one_of_grid_or_puzzle(self, client: TestClient) -> None:
        assert client.post("/api/solve", json={}).status_code == 422
        both = {"puzzle": EASY, "grid": parse_grid(EASY)}
        assert client.post("/api/solve", json=both).status_code == 422

    def test_rejects_a_short_puzzle_string(self, client: TestClient) -> None:
        assert client.post("/api/solve", json={"puzzle": "." * 80}).status_code == 422

    def test_rejects_a_malformed_grid(self, client: TestClient) -> None:
        assert client.post("/api/solve", json={"grid": [[0] * 9] * 8}).status_code == 422

    def test_rejects_an_out_of_range_cell(self, client: TestClient) -> None:
        grid = empty_grid()
        grid[3][3] = 42
        assert client.post("/api/solve", json={"grid": grid}).status_code == 422

    def test_rejects_an_out_of_range_time_limit(self, client: TestClient) -> None:
        payload = {"puzzle": EASY, "time_limit_s": 999}
        assert client.post("/api/solve", json=payload).status_code == 422


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
        assert body["conflicts"][0]["unit"] == "box"

    def test_requires_a_grid(self, client: TestClient) -> None:
        assert client.post("/api/validate", json={}).status_code == 422


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
