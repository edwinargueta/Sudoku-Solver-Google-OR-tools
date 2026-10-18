"""The CP-SAT model: does it respect the givens, and is it honest about uniqueness?"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import pytest
from ortools.sat.python import cp_model

from app.sudoku import solver as solver_module
from app.sudoku.board import EMPTY, Grid, empty_grid, is_complete, parse_grid
from app.sudoku.puzzles import PUZZLES
from app.sudoku.solver import (
    MAX_SOLUTIONS_CAP,
    MAX_TIME_LIMIT_S,
    SolveStatus,
    build_model,
    count_solutions,
    has_unique_solution,
    solve,
)

SOLVABLE_KEYS = [k for k in PUZZLES if k != "blank"]


def easy_1_without(row: int, col: int) -> Grid:
    """easy-1 with one given taken out, which is no longer well-posed."""
    grid = parse_grid(PUZZLES["easy-1"].puzzle)
    grid[row][col] = EMPTY
    return grid


#: Two and three solutions exactly: easy-1 without its r3c8 or its r5c9.
TWO_SOLUTIONS = easy_1_without(2, 7)
THREE_SOLUTIONS = easy_1_without(4, 8)

Params = Callable[[cp_model.CpSolver], None]


def wrap_cp_solve(monkeypatch: pytest.MonkeyPatch, before: Params) -> None:
    """Run `before` on the solver's parameters, then the real CpSolver.solve.

    Stubbing the return value instead would not do: SolveResult reads the
    solver's wall time, which only a real solve sets.
    """
    real = cp_model.CpSolver.solve

    def wrapped(self: cp_model.CpSolver, model: Any, callback: Any = None) -> Any:
        before(self)
        return real(self, model, callback)

    monkeypatch.setattr(cp_model.CpSolver, "solve", wrapped)


def assert_extends(puzzle_key: str, solution: list[list[int]]) -> None:
    """A solution must be a complete grid that keeps every given in place."""
    puzzle = parse_grid(PUZZLES[puzzle_key].puzzle)
    assert is_complete(solution), "solution is not a valid completed grid"
    for r in range(9):
        for c in range(9):
            if puzzle[r][c] != EMPTY:
                assert solution[r][c] == puzzle[r][c], f"given at r{r + 1}c{c + 1} was overwritten"


class TestBuildModel:
    def test_creates_81_variables_and_27_all_different_constraints(self) -> None:
        model, cells = build_model(empty_grid())
        assert sum(len(row) for row in cells) == 81
        proto = model.proto
        assert len(proto.variables) == 81
        all_diffs = [c for c in proto.constraints if c.has_all_diff()]
        assert len(all_diffs) == 27, "9 rows + 9 columns + 9 boxes"
        assert all(len(c.all_diff.exprs) == 9 for c in all_diffs)

    def test_each_given_adds_one_more_constraint(self) -> None:
        empty_model, _ = build_model(empty_grid())
        puzzle = parse_grid(PUZZLES["easy-1"].puzzle)
        model, _ = build_model(puzzle)
        extra = len(model.proto.constraints) - len(empty_model.proto.constraints)
        assert extra == 30, "one equality per given"

    def test_rejects_a_malformed_grid(self) -> None:
        with pytest.raises(ValueError):
            build_model([[0] * 9] * 3)


class TestSolve:
    @pytest.mark.parametrize("key", SOLVABLE_KEYS)
    def test_solves_every_sample_puzzle(self, key: str) -> None:
        result = solve(parse_grid(PUZZLES[key].puzzle))
        assert result.status is SolveStatus.SOLVED
        assert result.solution is not None
        assert_extends(key, result.solution)

    def test_blank_grid_is_solvable(self) -> None:
        result = solve(empty_grid())
        assert result.status is SolveStatus.SOLVED
        assert is_complete(result.solution or [])

    def test_already_solved_grid_is_returned_unchanged(self) -> None:
        solved = solve(parse_grid(PUZZLES["easy-1"].puzzle)).solution
        assert solved is not None
        assert solve(solved).solution == solved

    def test_reports_stats(self) -> None:
        result = solve(parse_grid(PUZZLES["hard-1"].puzzle))
        assert result.wall_time_ms > 0
        assert result.branches >= 0

    def test_contradictory_givens_are_infeasible_and_named(self) -> None:
        grid = empty_grid()
        grid[0][0] = grid[0][8] = 5
        result = solve(grid)
        assert result.status is SolveStatus.INFEASIBLE
        assert result.solution is None
        assert [(c.col, c.unit) for c in result.given_conflicts] == [(0, "row"), (8, "row")]

    def test_consistent_but_unsatisfiable_is_infeasible(self) -> None:
        # No given repeats anywhere, yet r1c1 is squeezed out: its row needs a
        # 1 there, and its box already holds one. Only the solver can see this.
        grid = empty_grid()
        grid[0][1:9] = [2, 3, 4, 5, 6, 7, 8, 9]
        grid[1][1] = 1
        result = solve(grid)
        assert result.given_conflicts == [], "the givens themselves do not clash"
        assert result.status is SolveStatus.INFEASIBLE
        assert result.exhaustive is True, "no solution is a finished answer"
        assert result.truncated is False

    def test_does_not_mutate_the_input(self) -> None:
        grid = parse_grid(PUZZLES["medium-1"].puzzle)
        before = [row[:] for row in grid]
        solve(grid)
        assert grid == before

    def test_rejects_a_worker_count_below_one(self) -> None:
        with pytest.raises(ValueError, match="workers"):
            solve(empty_grid(), workers=0)

    def test_a_model_cp_sat_rejects_is_an_error_not_a_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A bad parameter makes CP-SAT answer MODEL_INVALID at once. Folded
        # into UNKNOWN it would read as 'hit the time limit'.
        wrap_cp_solve(monkeypatch, lambda s: setattr(s.parameters, "num_workers", -1))
        with pytest.raises(RuntimeError, match="num_workers"):
            solve(parse_grid(PUZZLES["easy-1"].puzzle))


class TestMultipleSolutions:
    def test_collects_up_to_the_cap(self) -> None:
        result = solve(empty_grid(), max_solutions=5)
        assert result.solution_count == 5
        assert result.truncated is True
        assert all(is_complete(s) for s in result.solutions)

    def test_collected_solutions_are_distinct(self) -> None:
        result = solve(empty_grid(), max_solutions=4)
        flattened = {tuple(v for row in s for v in row) for s in result.solutions}
        assert len(flattened) == result.solution_count

    def test_well_posed_puzzle_has_exactly_one(self) -> None:
        result = solve(parse_grid(PUZZLES["evil-1"].puzzle), max_solutions=2)
        assert result.solution_count == 1
        assert result.exhaustive is True
        assert result.truncated is False
        assert result.is_unique is True

    def test_single_solve_does_not_claim_uniqueness(self) -> None:
        # max_solutions=1 stops at the first grid, so it cannot know.
        result = solve(parse_grid(PUZZLES["evil-1"].puzzle), max_solutions=1)
        assert result.is_unique is False
        assert result.exhaustive is False
        assert result.truncated is True

    def test_a_search_that_finishes_under_the_limit_has_every_solution(self) -> None:
        result = solve(THREE_SOLUTIONS, max_solutions=5)
        assert result.solution_count == 3
        assert result.exhaustive is True
        assert result.truncated is False
        assert result.is_unique is False

    def test_stopping_at_the_limit_is_truncated_even_when_nothing_is_left(self) -> None:
        # The collector stops the search at the second solution, so nobody
        # looked for a third, although there is none.
        assert solve(TWO_SOLUTIONS, max_solutions=3).solution_count == 2
        result = solve(TWO_SOLUTIONS, max_solutions=2)
        assert result.solution_count == 2
        assert result.exhaustive is False
        assert result.truncated is True

    def test_asking_for_the_most_allowed_still_reports_truncation(self) -> None:
        # The blank grid has about 6.7e21 solutions; 1000 of them is not all.
        result = solve(empty_grid(), max_solutions=MAX_SOLUTIONS_CAP)
        assert result.solution_count == MAX_SOLUTIONS_CAP
        assert result.truncated is True
        assert result.exhaustive is False

    def test_max_solutions_is_clamped_to_at_least_one(self) -> None:
        assert solve(parse_grid(PUZZLES["easy-1"].puzzle), max_solutions=0).solution_count == 1

    def test_the_ceiling_holds_against_a_parallel_search(self) -> None:
        # With several workers, more than one can report before the search
        # stops. Once was enough to make this flaky.
        puzzle = parse_grid(PUZZLES["easy-1"].puzzle)
        counts = {solve(puzzle, max_solutions=1, workers=8).solution_count for _ in range(25)}
        assert counts == {1}, f"collected more than asked for: {sorted(counts)}"


class TestUniqueness:
    @pytest.mark.parametrize("key", SOLVABLE_KEYS)
    def test_every_sample_puzzle_is_well_posed(self, key: str) -> None:
        assert has_unique_solution(parse_grid(PUZZLES[key].puzzle)) is True

    def test_blank_grid_is_not_unique(self) -> None:
        assert has_unique_solution(empty_grid()) is False

    def test_two_solutions_are_not_unique(self) -> None:
        assert has_unique_solution(TWO_SOLUTIONS) is False

    def test_no_solution_is_not_unique(self) -> None:
        grid = empty_grid()
        grid[0][0] = grid[0][8] = 5
        assert has_unique_solution(grid) is False

    def test_count_solutions_stops_at_the_limit(self) -> None:
        assert count_solutions(empty_grid(), limit=3) == 3

    def test_removing_a_given_can_break_uniqueness(self) -> None:
        # Strip most of an easy puzzle and it stops being well-posed.
        grid = parse_grid(PUZZLES["easy-1"].puzzle)
        for r in range(9):
            for c in range(9):
                if (r + c) % 2:
                    grid[r][c] = EMPTY
        assert count_solutions(grid, limit=2) == 2


class TestTimeLimit:
    @pytest.fixture
    def slow_after_each_solution(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Let the time limit run out between the first solution and the second.

        That can happen on a loaded host. The real callback still runs, so the
        solutions are collected as usual.
        """
        real = solver_module._SolutionCollector.on_solution_callback

        def slow(self: Any) -> None:
            real(self)
            time.sleep(0.3)

        monkeypatch.setattr(solver_module._SolutionCollector, "on_solution_callback", slow)

    @pytest.mark.usefixtures("slow_after_each_solution")
    def test_a_search_cut_short_does_not_claim_uniqueness(self) -> None:
        # One solution found, and the limit ran out before the second. Not the
        # blank grid: its first solution takes enough search that a busy host
        # can spend the whole limit before it, and find none at all.
        result = solve(TWO_SOLUTIONS, max_solutions=2, time_limit_s=0.1)
        assert result.status is SolveStatus.SOLVED
        assert result.solution_count == 1
        assert result.is_unique is False
        assert result.exhaustive is False
        assert result.truncated is True

    @pytest.mark.usefixtures("slow_after_each_solution")
    def test_has_unique_solution_says_it_does_not_know(self) -> None:
        # The same cut: one found and the second never looked for, so the
        # search cannot tell unique from not.
        assert has_unique_solution(TWO_SOLUTIONS, time_limit_s=0.1) is None

    def test_no_time_at_all_is_unknown(self, monkeypatch: pytest.MonkeyPatch) -> None:
        wrap_cp_solve(monkeypatch, lambda s: setattr(s.parameters, "max_time_in_seconds", 0.0))
        for max_solutions in (1, 2):
            result = solve(parse_grid(PUZZLES["evil-1"].puzzle), max_solutions=max_solutions)
            assert result.status is SolveStatus.UNKNOWN
            assert result.solutions == []
            assert result.exhaustive is False
            assert result.truncated is False
            assert result.is_unique is False
        assert has_unique_solution(parse_grid(PUZZLES["evil-1"].puzzle)) is None

    @pytest.mark.parametrize(
        ("asked", "given"),
        [(10_000, MAX_TIME_LIMIT_S), (2.5, 2.5), (0, 0.01), (-5, 0.01)],
    )
    def test_the_limit_cp_sat_gets_is_clamped(
        self, monkeypatch: pytest.MonkeyPatch, asked: float, given: float
    ) -> None:
        seen: list[float] = []
        wrap_cp_solve(monkeypatch, lambda s: seen.append(s.parameters.max_time_in_seconds))
        solve(parse_grid(PUZZLES["easy-1"].puzzle), time_limit_s=asked)
        assert seen == [given]


class TestWorkers:
    @pytest.fixture
    def workers_used(self, monkeypatch: pytest.MonkeyPatch) -> list[int]:
        seen: list[int] = []
        wrap_cp_solve(monkeypatch, lambda s: seen.append(s.parameters.num_workers))
        return seen

    def test_a_single_solution_solve_runs_one_worker_by_default(
        self, workers_used: list[int]
    ) -> None:
        solve(parse_grid(PUZZLES["easy-1"].puzzle))
        assert workers_used == [1]

    def test_a_single_solution_solve_runs_the_workers_asked_for(
        self, workers_used: list[int]
    ) -> None:
        solve(parse_grid(PUZZLES["easy-1"].puzzle), workers=4)
        assert workers_used == [4]

    def test_enumeration_always_runs_one_worker(self, workers_used: list[int]) -> None:
        solve(parse_grid(PUZZLES["easy-1"].puzzle), max_solutions=2, workers=4)
        assert workers_used == [1]
