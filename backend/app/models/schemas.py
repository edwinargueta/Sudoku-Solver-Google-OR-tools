"""Request and response shapes for the API.

These are the contract the React client codes against: a grid is always a 9x9
array of ints with 0 for an empty cell, both on the way in and on the way out.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.sudoku.board import Conflict, Grid, count_givens, parse_grid, validate_shape
from app.sudoku.puzzles import Level, Puzzle
from app.sudoku.solver import MAX_SOLUTIONS_CAP, MAX_TIME_LIMIT_S, SolveResult, SolveStatus


def _validated_grid(value: list[list[int]]) -> list[list[int]]:
    """Field validator: 9x9, every cell 0-9. Raises ValueError -> HTTP 422."""
    validate_shape(value)
    return value


GridField = Annotated[
    list[list[int]],
    Field(description="9x9 grid, 0 for an empty cell"),
]

EXAMPLE_PUZZLE = (
    "530070000600195000098000060800060003400803001700020006060000280000419005000080079"
)


class SolveRequest(BaseModel):
    """A puzzle to solve, given either as a grid or as an 81-character string."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"puzzle": EXAMPLE_PUZZLE, "max_solutions": 2}]
        }
    )

    grid: GridField | None = None
    puzzle: str | None = Field(
        default=None, description="81 characters, '.' or '0' for an empty cell"
    )
    max_solutions: int = Field(
        default=1,
        ge=1,
        le=MAX_SOLUTIONS_CAP,
        description="Ask for 2 to find out whether the puzzle is well-posed",
    )
    time_limit_s: float | None = Field(
        default=None, gt=0, le=MAX_TIME_LIMIT_S, description="Defaults to the server setting"
    )

    @field_validator("grid")
    @classmethod
    def _check_grid(cls, value: list[list[int]] | None) -> list[list[int]] | None:
        return None if value is None else _validated_grid(value)

    @field_validator("puzzle")
    @classmethod
    def _check_puzzle(cls, value: str | None) -> str | None:
        if value is not None:
            parse_grid(value)  # raises ValueError, surfaced as a 422
        return value

    @model_validator(mode="after")
    def _exactly_one_source(self) -> SolveRequest:
        if (self.grid is None) == (self.puzzle is None):
            raise ValueError("provide exactly one of 'grid' or 'puzzle'")
        return self

    def to_grid(self) -> Grid:
        """The request's puzzle as a grid, whichever form it arrived in."""
        return self.grid if self.grid is not None else parse_grid(self.puzzle or "")


class ConflictModel(BaseModel):
    """A given that repeats inside its row, column or box."""

    row: int = Field(description="0-indexed row")
    col: int = Field(description="0-indexed column")
    unit: str = Field(description="row | column | box")
    value: int
    message: str

    @classmethod
    def from_conflict(cls, conflict: Conflict) -> ConflictModel:
        return cls(
            row=conflict.row,
            col=conflict.col,
            unit=conflict.unit,
            value=conflict.value,
            message=conflict.describe(),
        )


class SolveResponse(BaseModel):
    """The solved grid plus the search statistics behind it."""

    status: SolveStatus
    solution: list[list[int]] | None = None
    solutions: list[list[list[int]]] = Field(default_factory=list)
    solution_count: int = 0
    unique: bool = Field(
        default=False,
        description="Exactly one solution exists (only meaningful when max_solutions > 1)",
    )
    truncated: bool = Field(
        default=False, description="Search stopped at max_solutions; more may exist"
    )
    wall_time_ms: float = 0.0
    branches: int = 0
    conflicts: list[ConflictModel] = Field(default_factory=list)

    @classmethod
    def from_result(cls, result: SolveResult) -> SolveResponse:
        return cls(
            status=result.status,
            solution=result.solution,
            solutions=result.solutions,
            solution_count=result.solution_count,
            unique=result.is_unique,
            truncated=result.truncated,
            wall_time_ms=round(result.wall_time_ms, 3),
            branches=result.branches,
            conflicts=[ConflictModel.from_conflict(c) for c in result.given_conflicts],
        )


class ValidateRequest(BaseModel):
    """A grid to check for contradictions among its givens."""

    grid: GridField

    @field_validator("grid")
    @classmethod
    def _check_grid(cls, value: list[list[int]]) -> list[list[int]]:
        return _validated_grid(value)


class ValidateResponse(BaseModel):
    """Whether a grid is internally consistent, and whether it is finished."""

    consistent: bool
    complete: bool
    givens: int
    conflicts: list[ConflictModel] = Field(default_factory=list)


class PuzzleModel(BaseModel):
    """One sample puzzle from the built-in library."""

    key: str
    label: str
    level: str
    puzzle: str
    grid: list[list[int]]
    givens: int
    source: str

    @classmethod
    def from_puzzle(cls, puzzle: Puzzle) -> PuzzleModel:
        grid = parse_grid(puzzle.puzzle)
        return cls(
            key=puzzle.key,
            label=puzzle.label,
            level=puzzle.level,
            puzzle=puzzle.puzzle,
            grid=grid,
            givens=count_givens(grid),
            source=puzzle.source,
        )


class LevelModel(BaseModel):
    """One difficulty band, as the picker needs it."""

    key: str
    label: str
    description: str
    count: int = Field(description="How many puzzles the level can hand out")

    @classmethod
    def from_level(cls, level: Level) -> LevelModel:
        return cls(
            key=level.key,
            label=level.label,
            description=level.description,
            count=len(level.puzzles),
        )


class HealthResponse(BaseModel):
    """Liveness payload, including the OR-Tools build actually loaded."""

    status: str = "ok"
    app_name: str
    ortools_version: str


class ErrorResponse(BaseModel):
    """The body returned with a 4xx from this API."""

    detail: str | Any
