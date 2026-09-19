"""Grid primitives: parsing, formatting, and conflict detection.

A board is a 9x9 list of lists of ints, where 0 marks an empty cell. Nothing
in this module knows about OR-Tools — it is the vocabulary the solver and the
API both speak.
"""

from __future__ import annotations

from dataclasses import dataclass

SIZE = 9
BOX = 3
EMPTY = 0
DIGITS = range(1, SIZE + 1)

Grid = list[list[int]]

#: Characters accepted for an empty cell when parsing a puzzle string.
BLANKS = frozenset({".", "0", "-", " ", "_"})


@dataclass(frozen=True, slots=True)
class Conflict:
    """Two givens that cannot coexist, and the unit that puts them in conflict."""

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
    """Read an 81-character puzzle string into a grid.

    Accepts '.', '0', '-', '_' and spaces as empty cells, and ignores newlines,
    pipes and plus signs so that pretty-printed puzzles round-trip.
    """
    cleaned = [ch for ch in text if ch not in "\n\r|+"]
    if len(cleaned) != SIZE * SIZE:
        raise ValueError(
            f"expected {SIZE * SIZE} cells, got {len(cleaned)}"
        )

    grid = empty_grid()
    for index, ch in enumerate(cleaned):
        row, col = divmod(index, SIZE)
        if ch in BLANKS:
            grid[row][col] = EMPTY
        elif ch.isdigit() and int(ch) in DIGITS:
            grid[row][col] = int(ch)
        else:
            raise ValueError(f"unexpected character {ch!r} at position {index}")
    return grid


def format_grid(grid: Grid, blank: str = ".") -> str:
    """Flatten a grid back into an 81-character string."""
    return "".join(
        blank if value == EMPTY else str(value) for row in grid for value in row
    )


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


def find_conflicts(grid: Grid) -> list[Conflict]:
    """Every given that duplicates another in its row, column or box.

    An empty list means the puzzle is *consistent*, not that it is solvable —
    only the solver can tell you that.
    """
    conflicts: list[Conflict] = []
    seen_rows: list[dict[int, int]] = [{} for _ in range(SIZE)]
    seen_cols: list[dict[int, int]] = [{} for _ in range(SIZE)]
    seen_boxes: list[dict[int, int]] = [{} for _ in range(SIZE)]

    for r in range(SIZE):
        for c in range(SIZE):
            value = grid[r][c]
            if value == EMPTY:
                continue
            for unit, table, key in (
                ("row", seen_rows[r], r),
                ("column", seen_cols[c], c),
                ("box", seen_boxes[box_index(r, c)], box_index(r, c)),
            ):
                if value in table:
                    conflicts.append(Conflict(row=r, col=c, unit=unit, value=value))
                else:
                    table[value] = key
    return conflicts


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
    from app.sudoku.puzzles import PUZZLES

    puzzle = parse_grid(PUZZLES["easy"].puzzle)
    print(render(puzzle))
    print(f"\ngivens: {count_givens(puzzle)}  consistent: {is_consistent(puzzle)}")
