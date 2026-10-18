"""Grid primitives: parsing, formatting, and conflict detection.

A board is a 9x9 list of lists of ints, where 0 marks an empty cell. Nothing
in this module knows about OR-Tools — it is the vocabulary the solver and the
API both speak.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

SIZE = 9
BOX = 3
EMPTY = 0
DIGITS = range(1, SIZE + 1)

Grid = list[list[int]]

#: Characters accepted for an empty cell when parsing a puzzle string.
BLANKS = frozenset({".", "0", "_"})

#: Box separators that parse_grid skips, along with any whitespace: what
#: render() draws between the cells.
LAYOUT = frozenset({"|", "-", "+"})


@dataclass(frozen=True, slots=True)
class Conflict:
    """A given that repeats a digit in one of its units.

    A clash involves at least two cells, and each of them gets a Conflict of
    its own for every unit the repeat happens in.
    """

    row: int
    col: int
    unit: str  # "row" | "column" | "box"
    value: int

    def describe(self) -> str:
        return f"r{self.row + 1}c{self.col + 1}={self.value} repeats in its {self.unit}"


def empty_grid() -> Grid:
    """A 9x9 grid of zeros."""
    return [[EMPTY] * SIZE for _ in range(SIZE)]


def clone(grid: Grid) -> Grid:
    """A deep copy that is safe to mutate."""
    return [row[:] for row in grid]


def parse_grid(text: str) -> Grid:
    """Read an 81-cell puzzle string into a grid.

    Accepts '.', '0' and '_' as empty cells, and skips whitespace, pipes,
    dashes and plus signs, so render()'s pretty-printed output round-trips.
    """
    cleaned = [ch for ch in text if not ch.isspace() and ch not in LAYOUT]
    if len(cleaned) != SIZE * SIZE:
        raise ValueError(f"expected {SIZE * SIZE} cells, got {len(cleaned)}")

    grid = empty_grid()
    for index, ch in enumerate(cleaned):
        row, col = divmod(index, SIZE)
        if ch in BLANKS:
            grid[row][col] = EMPTY
        elif ch in "123456789":  # not isdigit(), which also passes '٣' and '²'
            grid[row][col] = int(ch)
        else:
            raise ValueError(f"unexpected character {ch!r} at position {index}")
    return grid


def format_grid(grid: Grid, blank: str = ".") -> str:
    """Flatten a grid back into an 81-character string."""
    return "".join(blank if value == EMPTY else str(value) for row in grid for value in row)


def render(grid: Grid) -> str:
    """Pretty-print a grid with box separators, for logs and the __main__ demo."""
    lines: list[str] = []
    for r, row in enumerate(grid):
        if r % BOX == 0 and r:
            lines.append("------+-------+------")
        cells = [("." if v == EMPTY else str(v)) for v in row]
        lines.append(
            " ".join(cells[0:3]) + " | " + " ".join(cells[3:6]) + " | " + " ".join(cells[6:9])
        )
    return "\n".join(lines)


def validate_shape(grid: Grid) -> None:
    """Raise ValueError unless the grid is 9x9 with every value in 0..9."""
    if len(grid) != SIZE:
        raise ValueError(f"expected {SIZE} rows, got {len(grid)}")
    for r, row in enumerate(grid):
        if len(row) != SIZE:
            raise ValueError(f"row {r} has {len(row)} cells, expected {SIZE}")
        for c, value in enumerate(row):
            if not isinstance(value, int) or isinstance(value, bool):
                raise ValueError(f"cell r{r + 1}c{c + 1} is not an int")
            if value != EMPTY and value not in DIGITS:
                raise ValueError(f"cell r{r + 1}c{c + 1} holds {value}, expected 0-9")


def box_index(row: int, col: int) -> int:
    """The 0..8 index of the 3x3 box containing a cell, reading left to right."""
    return (row // BOX) * BOX + (col // BOX)


def _units(row: int, col: int) -> tuple[tuple[str, int], ...]:
    """The three units a cell belongs to, in the order conflicts are listed."""
    return (("row", row), ("column", col), ("box", box_index(row, col)))


def find_conflicts(grid: Grid) -> list[Conflict]:
    """Every given that repeats a digit in its row, column or box.

    Every cell of a repeat is listed, not just the later one: a grid does not
    say which cells are the puzzle's clues, so which one is wrong is the
    caller's call. The list runs cell by cell, then row, column, box.

    An empty list means the puzzle is *consistent*, not that it is solvable —
    only the solver can tell you that.
    """
    filled = [(r, c, grid[r][c]) for r in range(SIZE) for c in range(SIZE) if grid[r][c] != EMPTY]
    counts = Counter((unit, index, value) for r, c, value in filled for unit, index in _units(r, c))
    return [
        Conflict(row=r, col=c, unit=unit, value=value)
        for r, c, value in filled
        for unit, index in _units(r, c)
        if counts[unit, index, value] > 1
    ]


def is_consistent(grid: Grid) -> bool:
    """True when no given repeats inside a row, column or box."""
    return not find_conflicts(grid)


def is_complete(grid: Grid) -> bool:
    """True when every cell is filled and no unit repeats a digit."""
    return all(v != EMPTY for row in grid for v in row) and is_consistent(grid)


def count_givens(grid: Grid) -> int:
    """How many cells are pre-filled."""
    return sum(1 for row in grid for v in row if v != EMPTY)


if __name__ == "__main__":
    from app.sudoku.puzzles import DEFAULT_KEY, get

    puzzle = parse_grid(get(DEFAULT_KEY).puzzle)
    print(render(puzzle))
    print(f"\ngivens: {count_givens(puzzle)}  consistent: {is_consistent(puzzle)}")
