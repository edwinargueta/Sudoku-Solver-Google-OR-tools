"""The CP-SAT model: does it respect the givens, and is it honest about uniqueness?"""

from __future__ import annotations

import pytest

from app.sudoku.board import EMPTY, empty_grid, is_complete, parse_grid
from app.sudoku.puzzles import PUZZLES
from app.sudoku.solver import (
    SolveStatus,
    build_model,
    count_solutions,
    has_unique_solution,
    solve,
)

SOLVABLE_KEYS = [k for k in PUZZLES if k != "blank"]


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
        assert [c.unit for c in result.given_conflicts] == ["row"]

    def test_consistent_but_unsatisfiable_is_infeasible(self) -> None:
        # No given repeats anywhere, yet r1c1 is squeezed out: its row needs a
        # 1 there, and its box already holds one. Only the solver can see this.
        grid = empty_grid()
        grid[0][1:9] = [2, 3, 4, 5, 6, 7, 8, 9]
        grid[1][1] = 1
        result = solve(grid)
        assert result.given_conflicts == [], "the givens themselves do not clash"
        assert result.status is SolveStatus.INFEASIBLE

    def test_does_not_mutate_the_input(self) -> None:
        grid = parse_grid(PUZZLES["medium-1"].puzzle)
        before = [row[:] for row in grid]
        solve(grid)
        assert grid == before


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
        assert result.truncated is False
        assert result.is_unique is True

    def test_single_solve_does_not_claim_uniqueness(self) -> None:
        # max_solutions=1 stops at the first grid, so it cannot know.
        assert solve(empty_grid(), max_solutions=1).is_unique is False

    def test_max_solutions_is_clamped_to_at_least_one(self) -> None:
        assert solve(parse_grid(PUZZLES["easy-1"].puzzle), max_solutions=0).solution_count == 1


class TestUniqueness:
    @pytest.mark.parametrize("key", SOLVABLE_KEYS)
    def test_every_sample_puzzle_is_well_posed(self, key: str) -> None:
        assert has_unique_solution(parse_grid(PUZZLES[key].puzzle))

    def test_blank_grid_is_not_unique(self) -> None:
        assert not has_unique_solution(empty_grid())

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
    def test_tiny_limit_still_returns_a_result(self) -> None:
        result = solve(empty_grid(), time_limit_s=0.01)
        assert result.status in {SolveStatus.SOLVED, SolveStatus.UNKNOWN}

    def test_limit_is_clamped_to_the_ceiling(self) -> None:
        result = solve(parse_grid(PUZZLES["easy-1"].puzzle), time_limit_s=10_000)
        assert result.status is SolveStatus.SOLVED
