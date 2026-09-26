/**
 * What the tests may assume about the boards they are dealt.
 *
 * The fixtures send every "random" puzzle to its level's first one, so a test
 * knows where each clue sits. These rows are copied from
 * backend/app/sudoku/puzzles.py, where easy-1 is written with 0 for an empty
 * cell; here, as on the board, an empty cell is '.'.
 */

export const EASY_1 = {
  label: 'Easy #1',
  givens: 30,
  // The canonical example from Wikipedia's Sudoku article.
  puzzle: [
    '53..7....',
    '6..195...',
    '.98....6.',
    '8...6...3',
    '4..8.3..1',
    '7...2...6',
    '.6....28.',
    '...419..5',
    '....8..79',
  ],
  // Its one solution.
  solution: [
    '534678912',
    '672195348',
    '198342567',
    '859761423',
    '426853791',
    '713924856',
    '961537284',
    '287419635',
    '345286179',
  ],
}
