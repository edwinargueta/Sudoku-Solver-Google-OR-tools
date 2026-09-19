"""A library of sample puzzles, graded by the deduction each one demands.

Difficulty here is the human kind — how much work a person has to do. CP-SAT
solves every one of them in single-digit milliseconds, which is rather the
point of letting a constraint solver do it. Each level holds ten puzzles and
the library hands back a random one, so the same grid does not come up twice
in a row.
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Puzzle:
    """One sample puzzle as an 81-character string, '.' for an empty cell."""

    key: str
    label: str
    puzzle: str
    source: str
    level: str


@dataclass(frozen=True, slots=True)
class Level:
    """A difficulty band and the puzzles that sit in it."""

    key: str
    label: str
    description: str
    puzzles: tuple[Puzzle, ...]


BLANK = "." * 81

# A puzzle that came from somewhere quotable carries its own source; a bare
# string inherits the level's.
_Entry = str | tuple[str, str]
_Spec = tuple[str, str, str, str, tuple[_Entry, ...]]

_SPECS: tuple[_Spec, ...] = (
    (
        "blank",
        "Blank grid",
        "An empty board, for typing in a puzzle of your own.",
        "",
        (
            (
                BLANK,
                "Empty board — has 6,670,903,752,021,072,936,960 solutions.",
            ),
        ),
    ),
    (
        "easy",
        "Easy",
        "Fills in with naked singles — one candidate left in a cell.",
        "Generated with 180-degree symmetry; naked singles alone finish it.",
        (
            (
                "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
                "The canonical example puzzle from Wikipedia's Sudoku article.",
            ),
            ".563.1.89..8.....1123.8..7....4..8.239.2.8.155.2..6....3..9.1584.....3..86.1.792.",
            "3.41...75.67..54.259.7.2...1.8..4...93.....84...8..2.1...3.7.986.34..52.27...61.3",
            "..53.2....19.7...3.264..5..29875....6.4.1.2.5....49876..7..436.1...8.74....6.79..",
            "48.7...9..7.54986.2.....1..6..1.74..9.7.5.6.8..83.6..1..4.....7.65821.4..9...5.16",
            "7.651......3....8...24..7.95...76..36491538723..92...68.4..52...6....9......416.8",
            ".84.26....15....6.36..81......25.3.95.16348.78.2.17......84..71.2....68....36.95.",
            "9.1..632.8...3.91...7.9.45...527...4...968...7...152...83.5.6...79.8...3.463..8.1",
            ".517..6...7.5861496...4.2..5...9.8.....8.1.....7.3...4..3.5...6745268.9...9..472.",
            "92....8...6...5.7.1.5.9..42..28...14.58.1.72.71...96..83..7.4.6.7.1...9...9....87",
        ),
    ),
    (
        "medium",
        "Medium",
        "Needs hidden singles — the only home for a digit in its row, column or box.",
        "Generated with 180-degree symmetry; needs hidden singles.",
        (
            ".1..62.7.4........5.2.4.6.11..4.52...4362971...51.3..63.4.9.1.7........9.9.81..2.",
            "5..67...13.15..67..8.......1354.......8.3.1.......7253.......8..13..65.96...83..7",
            ".162......2..43.1.9....18.7..45......51.6.97......76..1.53....8.7.18..9......625.",
            "..4385...63..4..1.8.....3..3.256.....7.....6.....739.2..8.....7.9..3..81...8174..",
            "765.3.....4.72....3...15....2....497....5....814....2....57...1....92.6.....4.732",
            "27...9.14..1...2..635....9.76..1........3........7..25.2....168..6...3..58.1...72",
            "3..46......75...3.....93.5.47...5..2.5..3..4.2..6...81.8.75.....1...86......29..8",
            "..961..4.12...4.........3.6...19.5.7...7.3...8.2.56...7.4.........5...61.9..624..",
            ".1.2.3...3..7...1.....4...9134....6.57.....83.6....7949...3.....4...2..7...1.6.4.",
            ".....871.....6..52...739.....34.5...5.9...2.3...3.65.....681...26..7.....819.....",
        ),
    ),
    (
        "hard",
        "Hard",
        "Needs locked candidates, naked pairs or hidden pairs.",
        "Generated with 180-degree symmetry; needs locked candidates or pairs.",
        (
            (
                "4.....8.5.3..........7......2.....6.....8.4......1.......6.3.7.5..2.....1.4......",
                "Peter Norvig, 'Solving Every Sudoku Puzzle' — a hard case for search.",
            ),
            "...2.53.9..21..7.5.6...4.21..85......7..1..3......69..48.3...9.1.3..74..7.98.1...",
            ".6...85....8.51.265...26.8.6....5..4.........9..8....5.9.37...213.56.8....51...7.",
            ".9.7.83...7.........89..4.7.8...793.2.1...6.4.396...2.9.7..61.........4...63.1.5.",
            "....531..5.7.........794.85..4..6.12.........67.8..4..94.568.........9.4..347....",
            "....5...191.67.....5.4.1.73..6....9....3.2....8....1..49.8.5.6.....36.492...4....",
            "6..8....5.8..5..7.51.9....38....4.3.....3.....9.1....22....3.54.5..1..6.1....6..8",
            ".6..23..9.3...762.8..........1..6.43....3....49.2..8..........4.157...9.6..19..8.",
            "..5.....8..36.9...21...4...43.2...6...2...7...9...7.34...9...52...1.63..9.....4..",
            "4.5.2..1...6......18...59..5..6..3.....2.7.....2..9..5..94...31......6...2..6.4.8",
        ),
    ),
    (
        "evil",
        "Evil",
        "Singles and pairs run dry; finishing it means guessing and backtracking.",
        "Generated with 180-degree symmetry; no singles-and-pairs path to the end.",
        (
            (
                "1....7.9..3..2...8..96..5....53..9...1..8...26....4...3......1..4......7..7...3..",
                "'AI Escargot' by Arto Inkala, built to defeat human strategies.",
            ),
            (
                "..53.....8......2..7..1.5..4....53...1..7...6..32...8..6.5....9..4....3......97..",
                "Widely circulated sample puzzle; harder than its usual billing.",
            ),
            "..4.2....9..54.3..72..6..1....6...7.2.79.46.8.8...5....4..8..31..6.92..5....5.2..",
            ".1......4.......8..96..8371..1.8...984.7.3.627...9.5..6345..81..8.......9......2.",
            "...1..37.8..5..9.2....92..1..1....6.6..823..7.8....4..1..23....3.8..6..5.26..9...",
            "...9..14....6..2.9.....8..3.75.6.....9652143.....8.56.2..3.....6.1..7....43..2...",
            ".3.......89.27.4......1...2.725...3.14.....85.8...427.7...9......5.68.23.......4.",
            ".......6..42..9..55...8.9.3..4.6.5..8..3.2..1..1.7.3..6.8.3...44..8..15..2.......",
            ".7..1....4....3...6..2.87....7.316..23.....19..192.8....61.5..7...7....5....8..9.",
            "...1...9...5..923.934...6..89..7...6.........4...5..29..6...975.713..4...8...5...",
        ),
    ),
)


def _build() -> tuple[dict[str, Level], dict[str, Puzzle]]:
    """Expand the specs into levels and a flat key -> puzzle index."""
    levels: dict[str, Level] = {}
    index: dict[str, Puzzle] = {}
    for key, label, description, default_source, entries in _SPECS:
        solo = len(entries) == 1
        puzzles: list[Puzzle] = []
        for number, entry in enumerate(entries, start=1):
            text, source = entry if isinstance(entry, tuple) else (entry, default_source)
            puzzles.append(
                Puzzle(
                    key=key if solo else f"{key}-{number}",
                    label=label if solo else f"{label} #{number}",
                    puzzle=text,
                    source=source,
                    level=key,
                )
            )
        levels[key] = Level(
            key=key, label=label, description=description, puzzles=tuple(puzzles)
        )
        index.update({puzzle.key: puzzle for puzzle in puzzles})
    return levels, index


LEVELS, PUZZLES = _build()

DEFAULT_LEVEL = "easy"
DEFAULT_KEY = "easy-1"


def get(key: str) -> Puzzle:
    """Look up one puzzle by key; KeyError with the valid keys if it is unknown."""
    try:
        return PUZZLES[key]
    except KeyError:
        raise KeyError(f"unknown puzzle {key!r}; try one of {sorted(PUZZLES)}") from None


def keys() -> list[str]:
    """Every puzzle key, in the order they are defined."""
    return list(PUZZLES)


def get_level(key: str) -> Level:
    """Look up one level by key; KeyError with the valid keys if it is unknown."""
    try:
        return LEVELS[key]
    except KeyError:
        raise KeyError(f"unknown level {key!r}; try one of {sorted(LEVELS)}") from None


def level_keys() -> list[str]:
    """Every level key, easiest first."""
    return list(LEVELS)


def random_puzzle(level: str, *, rng: random.Random | None = None) -> Puzzle:
    """One puzzle picked at random from a level; pass `rng` to make it repeatable."""
    choices = get_level(level).puzzles
    return (rng or random).choice(choices)


if __name__ == "__main__":
    from app.sudoku.board import count_givens, parse_grid

    for band in LEVELS.values():
        print(f"{band.label} — {band.description}")
        for sample in band.puzzles:
            givens = count_givens(parse_grid(sample.puzzle))
            print(f"  {sample.key:<9} {givens:>2} givens  {sample.source}")
