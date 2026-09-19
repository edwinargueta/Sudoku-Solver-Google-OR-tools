"""API routes.

The solve handlers are deliberately plain `def`, not `async def`: CP-SAT is
blocking CPU work, and FastAPI runs sync handlers in a worker thread instead of
stalling the event loop.
"""

from __future__ import annotations

from importlib.metadata import version

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings, get_settings
from app.models.schemas import (
    ConflictModel,
    HealthResponse,
    LevelModel,
    PuzzleModel,
    SolveRequest,
    SolveResponse,
    ValidateRequest,
    ValidateResponse,
)
from app.sudoku import puzzles as puzzle_library
from app.sudoku.board import count_givens, find_conflicts, is_complete
from app.sudoku.solver import solve as solve_grid

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["meta"])
def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    """Liveness check that also reports which OR-Tools build is loaded."""
    return HealthResponse(app_name=settings.app_name, ortools_version=version("ortools"))


@router.get("/puzzles", response_model=list[PuzzleModel], tags=["puzzles"])
def list_puzzles() -> list[PuzzleModel]:
    """Every sample puzzle in the built-in library."""
    return [PuzzleModel.from_puzzle(p) for p in puzzle_library.PUZZLES.values()]


@router.get("/puzzles/{key}", response_model=PuzzleModel, tags=["puzzles"])
def get_puzzle(key: str) -> PuzzleModel:
    """One sample puzzle by key; 404 if there is no such key."""
    try:
        return PuzzleModel.from_puzzle(puzzle_library.get(key))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/levels", response_model=list[LevelModel], tags=["puzzles"])
def list_levels() -> list[LevelModel]:
    """Every difficulty band, easiest first."""
    return [LevelModel.from_level(level) for level in puzzle_library.LEVELS.values()]


@router.get("/levels/{key}/random", response_model=PuzzleModel, tags=["puzzles"])
def random_puzzle(key: str) -> PuzzleModel:
    """One puzzle drawn at random from a level; 404 if there is no such level."""
    try:
        return PuzzleModel.from_puzzle(puzzle_library.random_puzzle(key))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/solve", response_model=SolveResponse, tags=["solve"])
def solve(
    request: SolveRequest, settings: Settings = Depends(get_settings)
) -> SolveResponse:
    """Solve a puzzle with CP-SAT, collecting up to `max_solutions` grids."""
    result = solve_grid(
        request.to_grid(),
        max_solutions=request.max_solutions,
        time_limit_s=request.time_limit_s or settings.solver_time_limit_s,
        workers=settings.solver_workers,
    )
    return SolveResponse.from_result(result)


@router.post("/validate", response_model=ValidateResponse, tags=["solve"])
def validate(request: ValidateRequest) -> ValidateResponse:
    """Report duplicate givens without solving — cheap enough to call on edit."""
    grid = request.grid
    conflicts = find_conflicts(grid)
    return ValidateResponse(
        consistent=not conflicts,
        complete=is_complete(grid),
        givens=count_givens(grid),
        conflicts=[ConflictModel.from_conflict(c) for c in conflicts],
    )
