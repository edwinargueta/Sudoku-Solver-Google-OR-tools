"""Board vocabulary: parsing, formatting, conflict detection."""

from __future__ import annotations

import random
import subprocess
import sys
from pathlib import Path

import pytest

from app.sudoku.board import (
    EMPTY,
    SIZE,
    box_index,
    count_givens,
    empty_grid,
    find_conflicts,
    format_grid,
    is_complete,
    is_consistent,
    parse_grid,
    render,
    validate_shape,
)
from app.sudoku.puzzles import (
    DEFAULT_KEY,
    DEFAULT_LEVEL,
    LEVELS,
    PUZZLES,
    get,
    keys,
    level_keys,
    random_puzzle,
)


class TestParseGrid:
    def test_reads_81_characters_into_9x9(self) -> None:
        grid = parse_grid(PUZZLES["easy-1"].puzzle)
        assert len(grid) == SIZE
        assert all(len(row) == SIZE for row in grid)
        assert grid[0][0] == 5
        assert grid[0][2] == EMPTY

    @pytest.mark.parametrize("blank", [".", "0", "_"])
    def test_every_blank_character_means_empty(self, blank: str) -> None:
        assert parse_grid(blank * 81) == empty_grid()

    def test_ignores_pretty_printing(self) -> None:
        pretty = "\n".join(["123456789"] * 9)
        assert parse_grid(pretty)[0] == [1, 2, 3, 4, 5, 6, 7, 8, 9]

    def test_what_render_prints_parses_back(self) -> None:
        grid = parse_grid(PUZZLES["easy-1"].puzzle)
        assert parse_grid(render(grid)) == grid

    def test_skips_spaces_tabs_and_crlf_between_cells(self) -> None:
        source = PUZZLES["medium-1"].puzzle
        rows = [" ".join(source[i : i + 9]) for i in range(0, 81, 9)]
        assert parse_grid("\r\n".join(rows)) == parse_grid(source)
        assert parse_grid("\t".join(source)) == parse_grid(source)

    @pytest.mark.parametrize("digit", ["٣", "３", "²"])
    def test_only_ascii_digits_count(self, digit: str) -> None:
        # str.isdigit() passes all three, and int() reads the first two as 3.
        with pytest.raises(ValueError, match="unexpected character"):
            parse_grid(digit + "." * 80)

    def test_wrong_length_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="expected 81 cells"):
            parse_grid("." * 80)

    def test_unexpected_character_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="unexpected character"):
            parse_grid("x" + "." * 80)


class TestFormatGrid:
    def test_round_trips(self) -> None:
        source = PUZZLES["hard-1"].puzzle
        assert format_grid(parse_grid(source)) == source

    def test_blank_character_is_configurable(self) -> None:
        assert format_grid(empty_grid(), blank="0") == "0" * 81


class TestValidateShape:
    def test_accepts_a_well_formed_grid(self) -> None:
        validate_shape(empty_grid())

    def test_rejects_wrong_row_count(self) -> None:
        with pytest.raises(ValueError, match="expected 9 rows"):
            validate_shape([[0] * 9] * 8)

    def test_rejects_short_row(self) -> None:
        grid = empty_grid()
        grid[4] = [0] * 8
        with pytest.raises(ValueError, match="row 4 has 8 cells"):
            validate_shape(grid)

    def test_rejects_out_of_range_value(self) -> None:
        grid = empty_grid()
        grid[0][0] = 10
        with pytest.raises(ValueError, match="expected 0-9"):
            validate_shape(grid)

    def test_rejects_bool_masquerading_as_int(self) -> None:
        grid = empty_grid()
        grid[0][0] = True  # type: ignore[assignment]
        with pytest.raises(ValueError, match="not an int"):
            validate_shape(grid)


class TestBoxIndex:
    @pytest.mark.parametrize(
        ("row", "col", "expected"),
        [(0, 0, 0), (0, 8, 2), (4, 4, 4), (8, 0, 6), (8, 8, 8), (2, 3, 1)],
    )
    def test_maps_cells_to_boxes(self, row: int, col: int, expected: int) -> None:
        assert box_index(row, col) == expected


class TestFindConflicts:
    def test_clean_puzzle_has_none(self) -> None:
        assert find_conflicts(parse_grid(PUZZLES["evil-1"].puzzle)) == []

    def test_empty_grid_has_none(self) -> None:
        assert is_consistent(empty_grid())

    def test_duplicate_in_row(self) -> None:
        grid = empty_grid()
        grid[0][0] = grid[0][5] = 4
        conflicts = find_conflicts(grid)
        assert [(c.row, c.col, c.unit) for c in conflicts] == [(0, 0, "row"), (0, 5, "row")]

    def test_duplicate_in_column(self) -> None:
        grid = empty_grid()
        grid[1][2] = grid[7][2] = 9
        assert [(c.row, c.unit) for c in find_conflicts(grid)] == [(1, "column"), (7, "column")]

    def test_duplicate_in_box_only(self) -> None:
        grid = empty_grid()
        grid[0][0] = grid[1][1] = 3  # same box, different row and column
        assert [c.unit for c in find_conflicts(grid)] == ["box", "box"]

    def test_reports_every_unit_a_cell_breaks(self) -> None:
        grid = empty_grid()
        grid[0][0] = grid[0][1] = 7  # same row *and* same box
        assert [(c.row, c.col, c.unit) for c in find_conflicts(grid)] == [
            (0, 0, "row"),
            (0, 0, "box"),
            (0, 1, "row"),
            (0, 1, "box"),
        ]

    def test_flags_an_entry_that_comes_before_the_clue_it_repeats(self) -> None:
        # easy-1 has a 7 at r1c5. A 7 typed at r1c3 is scanned first, and used
        # to go unmarked while the locked clue was flagged instead.
        grid = parse_grid(PUZZLES["easy-1"].puzzle)
        grid[0][2] = 7
        assert [(c.row, c.col, c.unit) for c in find_conflicts(grid)] == [
            (0, 2, "row"),
            (0, 4, "row"),
        ]

    def test_three_of_a_digit_list_each_cell_once(self) -> None:
        grid = empty_grid()
        grid[4][0] = grid[4][4] = grid[4][8] = 2
        assert [(c.col, c.unit) for c in find_conflicts(grid)] == [
            (0, "row"),
            (4, "row"),
            (8, "row"),
        ]

    def test_a_cell_in_two_clashes_is_listed_under_each_unit(self) -> None:
        grid = empty_grid()
        grid[0][0] = grid[0][8] = grid[8][0] = 6  # r1c1 clashes along its row and its column
        assert [(c.row, c.col, c.unit) for c in find_conflicts(grid)] == [
            (0, 0, "row"),
            (0, 0, "column"),
            (0, 8, "row"),
            (8, 0, "column"),
        ]

    def test_message_names_the_cell(self) -> None:
        grid = empty_grid()
        grid[2][3] = grid[2][4] = 1
        assert [c.describe() for c in find_conflicts(grid)] == [
            "r3c4=1 repeats in its row",
            "r3c4=1 repeats in its box",
            "r3c5=1 repeats in its row",
            "r3c5=1 repeats in its box",
        ]


class TestCompleteness:
    def test_empty_grid_is_not_complete(self) -> None:
        assert not is_complete(empty_grid())

    def test_puzzle_with_holes_is_not_complete(self) -> None:
        assert not is_complete(parse_grid(PUZZLES["easy-1"].puzzle))

    def test_filled_and_consistent_is_complete(self) -> None:
        solved = "534678912672195348198342567859761423426853791713924856961537284287419635345286179"
        assert is_complete(parse_grid(solved))

    def test_filled_but_contradictory_is_not_complete(self) -> None:
        assert not is_complete([[((r + c) % 9) + 1 for c in range(9)] for r in range(9)])


class TestCountGivens:
    def test_counts_prefilled_cells(self) -> None:
        assert count_givens(empty_grid()) == 0
        assert count_givens(parse_grid(PUZZLES["easy-1"].puzzle)) == 30


class TestPuzzleLibrary:
    @pytest.mark.parametrize("key", sorted(PUZZLES))
    def test_every_sample_is_81_cells_and_consistent(self, key: str) -> None:
        grid = parse_grid(PUZZLES[key].puzzle)
        validate_shape(grid)
        assert is_consistent(grid), f"{key} has contradictory givens"

    def test_no_two_samples_are_the_same_grid(self) -> None:
        grids = [puzzle.puzzle for puzzle in PUZZLES.values()]
        assert len(set(grids)) == len(grids)


class TestLevels:
    def test_each_difficulty_offers_ten_puzzles(self) -> None:
        assert list(LEVELS) == ["blank", "easy", "medium", "hard", "evil"]
        assert len(LEVELS["blank"].puzzles) == 1, "the empty board is the only blank"
        for key in ("easy", "medium", "hard", "evil"):
            assert len(LEVELS[key].puzzles) == 10, f"{key} should offer ten puzzles"

    def test_the_flat_index_and_the_levels_agree(self) -> None:
        assert len(PUZZLES) == sum(len(level.puzzles) for level in LEVELS.values())
        for level in LEVELS.values():
            for puzzle in level.puzzles:
                assert puzzle.level == level.key
                assert PUZZLES[puzzle.key] is puzzle

    def test_a_draw_stays_inside_the_level_it_asked_for(self) -> None:
        rng = random.Random(0)
        assert all(random_puzzle("hard", rng=rng).level == "hard" for _ in range(100))

    def test_enough_draws_reach_every_puzzle_in_a_level(self) -> None:
        rng = random.Random(0)
        drawn = {random_puzzle("evil", rng=rng).key for _ in range(200)}
        assert drawn == {puzzle.key for puzzle in LEVELS["evil"].puzzles}

    def test_a_seeded_rng_makes_the_draw_repeatable(self) -> None:
        def draw() -> list[str]:
            rng = random.Random(11)
            return [random_puzzle("medium", rng=rng).key for _ in range(5)]

        assert draw() == draw()

    def test_drawing_from_blank_returns_the_empty_board(self) -> None:
        assert random_puzzle("blank").puzzle == "." * 81

    def test_an_excluded_puzzle_is_never_drawn(self) -> None:
        rng = random.Random(0)
        drawn = {random_puzzle("easy", exclude="easy-3", rng=rng).key for _ in range(200)}
        assert drawn == {p.key for p in LEVELS["easy"].puzzles} - {"easy-3"}

    def test_excluding_the_only_puzzle_still_draws_it(self) -> None:
        assert random_puzzle("blank", exclude="blank").key == "blank"

    def test_an_exclude_from_elsewhere_is_ignored(self) -> None:
        rng = random.Random(0)
        drawn = {random_puzzle("hard", exclude="nope", rng=rng).key for _ in range(200)}
        assert drawn == {p.key for p in LEVELS["hard"].puzzles}

    def test_an_unknown_level_says_which_ones_exist(self) -> None:
        with pytest.raises(KeyError, match="unknown level"):
            random_puzzle("impossible")


class TestRunAsScript:
    @pytest.mark.parametrize("module", ["board", "puzzles", "solver"])
    def test_every_core_module_runs_on_its_own(self, module: str) -> None:
        backend = Path(__file__).resolve().parent.parent
        run = subprocess.run(
            [sys.executable, "-m", f"app.sudoku.{module}"],
            cwd=backend,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert run.returncode == 0, run.stderr
        assert run.stdout.strip()


class TestRender:
    def test_draws_box_separators_and_dots_for_blanks(self) -> None:
        lines = render(empty_grid()).splitlines()
        assert len(lines) == 11, "nine rows plus two separators"
        assert lines[0] == ". . . | . . . | . . ."
        assert lines[3] == "------+-------+------"
        assert lines[7] == "------+-------+------"

    def test_prints_the_digits_it_was_given(self) -> None:
        grid = empty_grid()
        grid[0][0] = 5
        grid[0][8] = 9
        assert render(grid).splitlines()[0] == "5 . . | . . . | . . 9"


class TestLookup:
    def test_finds_a_puzzle_by_key(self) -> None:
        puzzle = get("easy-1")
        assert puzzle.key == "easy-1"
        assert puzzle is PUZZLES["easy-1"]

    def test_an_unknown_key_lists_the_real_ones(self) -> None:
        with pytest.raises(KeyError, match="unknown puzzle"):
            get("easy-99")

    def test_keys_are_every_puzzle_in_definition_order(self) -> None:
        assert keys() == list(PUZZLES)
        assert keys()[0] == "blank", "the empty board comes first"

    def test_level_keys_run_easiest_first(self) -> None:
        assert level_keys() == ["blank", "easy", "medium", "hard", "evil"]

    def test_the_defaults_point_at_something_real(self) -> None:
        assert DEFAULT_KEY in PUZZLES
        assert DEFAULT_LEVEL in LEVELS
        assert PUZZLES[DEFAULT_KEY].level == DEFAULT_LEVEL
