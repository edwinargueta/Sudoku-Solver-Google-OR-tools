"""API routes.

The solve handlers are deliberately plain `def`, not `async def`: CP-SAT is
blocking CPU work, and FastAPI runs sync handlers in a worker thread instead of
stalling the event loop. Health is the exception. It is `async` and needs no
thread at all, so a probe is still answered while every thread is solving.
"""

from __future__ import annotations

from importlib.metadata import version
from threading import BoundedSemaphore
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.config import Settings
from app.models.schemas import (
    ConflictModel,
    ErrorResponse,
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

#: Read once: it cannot change under a running process.
ORTOOLS_VERSION = version("ortools")

SOLVER_BUSY = "The solver is busy. Try again in a moment."

NOT_FOUND: dict[int | str, dict[str, Any]] = {404: {"model": ErrorResponse}}
TOO_LARGE: dict[int | str, dict[str, Any]] = {413: {"model": ErrorResponse}}

router = APIRouter()


async def app_settings(request: Request) -> Settings:
    """The settings the app was built with, not a fresh read of the environment."""
    return request.app.state.settings


async def solve_slots(request: Request) -> BoundedSemaphore:
    """The app's cap on solves running at once."""
    return request.app.state.solve_slots


@router.get("/health", response_model=HealthResponse, tags=["meta"])
async def health(settings: Settings = Depends(app_settings)) -> HealthResponse:
    """Liveness check that also reports which OR-Tools build is loaded."""
    return HealthResponse(app_name=settings.app_name, ortools_version=ORTOOLS_VERSION)


@router.get("/puzzles", response_model=list[PuzzleModel], tags=["puzzles"])
def list_puzzles() -> list[PuzzleModel]:
    """Every sample puzzle in the built-in library."""
    return [PuzzleModel.from_puzzle(p) for p in puzzle_library.PUZZLES.values()]


@router.get("/puzzles/{key}", response_model=PuzzleModel, tags=["puzzles"], responses=NOT_FOUND)
def get_puzzle(key: str) -> PuzzleModel:
    """One sample puzzle by key; 404 if there is no such key."""
    try:
        return PuzzleModel.from_puzzle(puzzle_library.get(key))
    except KeyError as exc:
        # str() of a KeyError is the repr of its message, quotes and all.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.args[0]) from exc


@router.get("/levels", response_model=list[LevelModel], tags=["puzzles"])
def list_levels() -> list[LevelModel]:
    """Every difficulty band, easiest first."""
    return [LevelModel.from_level(level) for level in puzzle_library.LEVELS.values()]


@router.get(
    "/levels/{key}/random", response_model=PuzzleModel, tags=["puzzles"], responses=NOT_FOUND
)
def random_puzzle(
    key: str,
    exclude: str | None = Query(
        default=None, description="A puzzle key not to draw, such as the one on the board"
    ),
) -> PuzzleModel:
    """One puzzle drawn at random from a level; 404 if there is no such level.

    An `exclude` that names no puzzle in the level is ignored, not an error.
    """
    try:
        return PuzzleModel.from_puzzle(puzzle_library.random_puzzle(key, exclude=exclude))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.args[0]) from exc


@router.post(
    "/solve",
    response_model=SolveResponse,
    tags=["solve"],
    responses={**TOO_LARGE, 503: {"model": ErrorResponse, "description": "The solver is busy"}},
)
def solve(
    request: SolveRequest,
    settings: Settings = Depends(app_settings),
    slots: BoundedSemaphore = Depends(solve_slots),
) -> SolveResponse:
    """Solve a puzzle with CP-SAT, collecting up to `max_solutions` grids.

    503 when the solver is already running as many solves as it may. Turning
    the request away at once beats queuing it behind CP-SAT, where a burst
    would only pile up until everything in the queue timed out.
    """
    # The setting is a ceiling as well as the default: a request may ask for
    # less time than the operator allows, never more.
    time_limit_s = settings.solver_time_limit_s
    if request.time_limit_s is not None:
        time_limit_s = min(time_limit_s, request.time_limit_s)

    if not slots.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=SOLVER_BUSY,
            headers={"Retry-After": "1"},
        )
    try:
        result = solve_grid(
            request.to_grid(),
            max_solutions=request.max_solutions,
            time_limit_s=time_limit_s,
            workers=settings.solver_workers,
        )
    finally:
        slots.release()
    return SolveResponse.from_result(result)


@router.post("/validate", response_model=ValidateResponse, tags=["solve"], responses=TOO_LARGE)
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
