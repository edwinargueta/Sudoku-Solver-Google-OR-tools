"""The CP-SAT model: 81 integer variables and 27 all-different constraints.

The whole of Sudoku is expressible as a constraint satisfaction problem, so
there is no search code here at all. We state the rules, hand them to CP-SAT,
and read the assignment back out.

Enumerating more than one solution forces CP-SAT into single-threaded search,
which is how uniqueness checking is done: ask for two solutions and see whether
a second one comes back.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from ortools.sat.python import cp_model

from app.sudoku.board import (
    BOX,
    DIGITS,
    EMPTY,
    SIZE,
    Conflict,
    Grid,
    find_conflicts,
    validate_shape,
)

DEFAULT_TIME_LIMIT_S = 10.0
MAX_TIME_LIMIT_S = 60.0
MAX_SOLUTIONS_CAP = 1_000


class SolveStatus(StrEnum):
    """What CP-SAT concluded, flattened to the four cases the UI cares about."""

    SOLVED = "SOLVED"
    INFEASIBLE = "INFEASIBLE"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class SolveResult:
    """The outcome of one solve, plus enough stats to show the work."""

    status: SolveStatus
    solutions: list[Grid] = field(default_factory=list)
    wall_time_ms: float = 0.0
    branches: int = 0
    given_conflicts: list[Conflict] = field(default_factory=list)
    truncated: bool = False  # stopped at max_solutions, more may exist

    @property
    def solution(self) -> Grid | None:
        """The first solution found, or None if there is none."""
        return self.solutions[0] if self.solutions else None

    @property
    def solution_count(self) -> int:
        """How many solutions were collected (bounded by max_solutions)."""
        return len(self.solutions)

    @property
    def is_unique(self) -> bool:
        """True only when the search was exhaustive and found exactly one solution."""
        return self.solution_count == 1 and not self.truncated


def build_model(grid: Grid) -> tuple[cp_model.CpModel, list[list[cp_model.IntVar]]]:
    """Encode a puzzle as a CP-SAT model and return it with its cell variables.

    One variable per cell over 1..9, an AllDifferent per row, column and box,
    and an equality constraint pinning each given.
    """
    validate_shape(grid)

    model = cp_model.CpModel()
    cells = [
        [model.new_int_var(DIGITS.start, DIGITS.stop - 1, f"r{r}c{c}") for c in range(SIZE)]
        for r in range(SIZE)
    ]

    for r in range(SIZE):
        model.add_all_different(cells[r])
    for c in range(SIZE):
        model.add_all_different([cells[r][c] for r in range(SIZE)])
    for box_row in range(0, SIZE, BOX):
        for box_col in range(0, SIZE, BOX):
            model.add_all_different(
                [
                    cells[box_row + dr][box_col + dc]
                    for dr in range(BOX)
                    for dc in range(BOX)
                ]
            )

    for r in range(SIZE):
        for c in range(SIZE):
            if grid[r][c] != EMPTY:
                model.add(cells[r][c] == grid[r][c])

    return model, cells


class _SolutionCollector(cp_model.CpSolverSolutionCallback):
    """Collects assignments as CP-SAT finds them, stopping at a ceiling."""

    def __init__(self, cells: list[list[cp_model.IntVar]], limit: int) -> None:
        super().__init__()
        self._cells = cells
        self._limit = limit
        self.solutions: list[Grid] = []
        self.hit_limit = False

    def on_solution_callback(self) -> None:
        # stop_search() is a request, not a guarantee: the single-solution
        # path runs eight workers, and another can report before the search
        # winds up. Without this guard the ceiling is exceeded now and then.
        if len(self.solutions) >= self._limit:
            return
        self.solutions.append([[int(self.value(cell)) for cell in row] for row in self._cells])
        if len(self.solutions) >= self._limit:
            self.hit_limit = True
            self.stop_search()


def solve(
    grid: Grid,
    *,
    max_solutions: int = 1,
    time_limit_s: float = DEFAULT_TIME_LIMIT_S,
    workers: int = 8,
) -> SolveResult:
    """Solve a puzzle, collecting up to `max_solutions` distinct grids.

    Contradictory givens short-circuit to INFEASIBLE with the offending cells
    listed, so the caller can point at them instead of reporting 'no solution'.
    """
    validate_shape(grid)
    max_solutions = max(1, min(int(max_solutions), MAX_SOLUTIONS_CAP))
    time_limit_s = max(0.01, min(float(time_limit_s), MAX_TIME_LIMIT_S))

    conflicts = find_conflicts(grid)
    if conflicts:
        return SolveResult(status=SolveStatus.INFEASIBLE, given_conflicts=conflicts)

    model, cells = build_model(grid)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s

    if max_solutions > 1:
        # Enumeration is only supported by the sequential search.
        solver.parameters.enumerate_all_solutions = True
        solver.parameters.num_workers = 1
    else:
        solver.parameters.num_workers = workers

    collector = _SolutionCollector(cells, max_solutions)
    status = solver.solve(model, collector)

    if collector.solutions:
        resolved = SolveStatus.SOLVED
    elif status == cp_model.INFEASIBLE:
        resolved = SolveStatus.INFEASIBLE
    else:
        resolved = SolveStatus.UNKNOWN

    return SolveResult(
        status=resolved,
        solutions=collector.solutions,
        wall_time_ms=solver.wall_time * 1000.0,
        branches=solver.num_branches,
        truncated=collector.hit_limit and max_solutions < MAX_SOLUTIONS_CAP,
    )


def count_solutions(
    grid: Grid, *, limit: int = 2, time_limit_s: float = DEFAULT_TIME_LIMIT_S
) -> int:
    """Count solutions up to `limit`; 2 is enough to answer 'is this unique?'."""
    return solve(grid, max_solutions=limit, time_limit_s=time_limit_s).solution_count


def has_unique_solution(grid: Grid, *, time_limit_s: float = DEFAULT_TIME_LIMIT_S) -> bool:
    """True when exactly one grid satisfies the givens — a well-posed puzzle."""
    return count_solutions(grid, limit=2, time_limit_s=time_limit_s) == 1


if __name__ == "__main__":
    from app.sudoku.board import parse_grid, render
    from app.sudoku.puzzles import LEVELS, random_puzzle

    for level in LEVELS.values():
        if level.key == "blank":
            continue
        puzzle = random_puzzle(level.key)
        result = solve(parse_grid(puzzle.puzzle), max_solutions=2)
        unique = "unique" if result.is_unique else f"{result.solution_count}+ solutions"
        print(f"\n=== {puzzle.label} ({unique}, {result.wall_time_ms:.1f} ms) ===")
        if result.solution:
            print(render(result.solution))
