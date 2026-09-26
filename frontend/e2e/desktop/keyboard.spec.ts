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

test('the browser\'s own undo takes back a typed digit', async ({ board }) => {
  await board.deal('easy')
  await board.enter(1, 3, 4)
  await board.page.keyboard.press('ControlOrMeta+z')
  await expect(board.cell(1, 3)).toHaveValue('')
})

test('there is no number pad, and the cells ask for the numeric keyboard', async ({ board }) => {
  await expect(board.pad).toHaveCount(0)
  await expect(board.cell(1, 1)).toHaveAttribute('inputmode', 'numeric')
  await expect(board.page.getByText('Type 1–9, arrow keys to move')).toBeVisible()
})
