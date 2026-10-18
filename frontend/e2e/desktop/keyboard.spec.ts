/**
 * Playing with a mouse and keyboard, in Chrome and Safari.
 *
 * The unit tests drive the same handlers through jsdom; these are here for
 * what jsdom does not have — a real caret, a real click, the browser's own
 * undo — and for Safari, whose mouse-up behaves differently from Chrome's.
 */

import { LOCKED } from '../board'
import { expect, test } from '../fixtures'

test('the keyboard plays the board', async ({ board }) => {
  const { page } = board
  await board.deal('easy')

  // r1c3 is empty; r1c1 and r1c2 are clues.
  await board.choose(1, 3)
  await page.keyboard.press('4')
  await expect(board.cell(1, 3)).toHaveValue('4')
  await page.keyboard.press('7')
  await expect(board.cell(1, 3), 'a second digit replaces the first').toHaveValue('7')
  // Arriving by arrow selects the digit, so a letter would type over it.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('a')
  await expect(board.cell(1, 3), 'a letter is ignored').toHaveValue('7')

  // The arrows walk through clues, which refuse digits and Backspace alike.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(board.cell(1, 1)).toBeFocused()
  await expect(board.cell(1, 1)).toHaveClass(LOCKED)
  await page.keyboard.press('9')
  await page.keyboard.press('Backspace')
  await expect(board.cell(1, 1)).toHaveValue('5')

  // And stop at the edge.
  await page.keyboard.press('ArrowUp')
  await expect(board.cell(1, 1)).toBeFocused()

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Delete')
  await expect(board.cell(1, 3)).toHaveValue('')
})

// Safari's mouse-up can undo the selection made on focus. A click near the
// left edge of a filled cell then leaves the caret in front of the digit.
for (const [side, fraction] of [['left edge', 0.1], ['centre', 0.5], ['right edge', 0.9]] as const) {
  test(`typing into a filled cell replaces its digit, clicked at its ${side}`, async ({ board }) => {
    await board.deal('easy')
    await board.enter(1, 3, 4)
    await board.choose(2, 2)

    const { width, height } = await board.box(board.cell(1, 3))
    await board.cell(1, 3).click({ position: { x: width * fraction, y: height / 2 } })
    await board.page.keyboard.press('7')
    await expect(board.cell(1, 3)).toHaveValue('7')
  })
}

// The browser's own undo knows only the one input, and used to be recorded as
// a new move, which the Undo button then put back. The shortcut is Undo now.
test('Ctrl+Z or Cmd+Z is the game\'s Undo', async ({ board }) => {
  await board.deal('easy')
  await board.enter(1, 3, 4)
  await board.enter(1, 4, 6)

  await board.page.keyboard.press('ControlOrMeta+z')
  await expect(board.cell(1, 4)).toHaveValue('')
  await expect(board.cell(1, 3), 'one move at a time').toHaveValue('4')

  // The button carries on from there, rather than putting the 6 back.
  await board.press('Undo')
  await expect(board.cell(1, 3)).toHaveValue('')
  await expect(board.cell(1, 4)).toHaveValue('')
  await expect(board.action('Undo')).toBeDisabled()
})

test('the board is one stop in the Tab order', async ({ board }) => {
  const { page } = board
  await board.deal('easy')
  await board.choose(5, 5)
  await page.keyboard.press('ArrowRight')
  await expect(board.cell(5, 6)).toBeFocused()

  // One Tab leaves the board, wherever on it the player was.
  await page.keyboard.press('Tab')
  await expect(board.grid.locator(':focus')).toHaveCount(0)
  // And one back returns to the cell they left.
  await page.keyboard.press('Shift+Tab')
  await expect(board.cell(5, 6)).toBeFocused()
})

test('the board reads as nine rows of nine cells', async ({ board }) => {
  const rows = board.grid.getByRole('row')
  await expect(rows).toHaveCount(9)
  await expect(rows.nth(4).getByRole('gridcell')).toHaveCount(9)
  await expect(rows.nth(4).getByRole('gridcell').nth(2).getByRole('textbox')).toHaveAccessibleName(
    'row 5 column 3',
  )
})

test('there is no number pad, and the cells ask for the numeric keyboard', async ({ board }) => {
  await expect(board.pad).toHaveCount(0)
  await expect(board.cell(1, 1)).toHaveAttribute('inputmode', 'numeric')
  await expect(board.page.getByText('Type 1–9, arrow keys to move')).toBeVisible()
})
