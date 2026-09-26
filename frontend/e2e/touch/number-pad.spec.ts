/**
 * The number pad, on an iPhone (WebKit) and an Android phone (Chromium).
 *
 * These use real taps: touchstart, touchend, then the mouse events a phone
 * makes up afterwards, in the order a phone sends them. jsdom has none of
 * that, and the pad's focus handling depends on all of it.
 *
 * What no browser here can show is the iPhone's own keyboard or edit menu.
 * These check the things those depend on; the README's iPhone checklist
 * covers the rest by hand.
 */

import { SELECTED } from '../board'
import { expect, test } from '../fixtures'

test('the board asks for no keyboard, and the pad sits right under it', async ({ board }) => {
  await expect(board.grid.locator('input[inputmode="none"]')).toHaveCount(81)

  const grid = await board.box(board.grid)
  const pad = await board.box(board.pad)
  expect(pad.y - (grid.y + grid.height), 'straight under the board').toBeGreaterThanOrEqual(0)
  expect(pad.y - (grid.y + grid.height)).toBeLessThanOrEqual(12)
  expect(Math.abs(pad.width - grid.width), 'as wide as the board').toBeLessThanOrEqual(1)

  // One row: all ten keys share a top.
  await expect(board.pad.getByRole('button')).toHaveCount(10)
  const keys = await board.pad.getByRole('button').all()
  const tops = await Promise.all(keys.map(async (key) => Math.round((await board.box(key)).y)))
  expect(new Set(tops).size).toBe(1)

  // Quick taps are two digits, not a zoom, even between the keys.
  for (const target of [board.grid, board.pad, board.key(5)]) {
    await expect(target).toHaveCSS('touch-action', 'manipulation')
  }
  await expect(board.page.getByText('Type 1–9, arrow keys to move')).toBeHidden()
})

test('a key writes into the chosen cell and leaves it chosen', { tag: '@smoke' }, async ({ board }) => {
  await board.deal('easy')
  await board.choose(1, 3)
  await board.key(7).tap()
  await expect(board.cell(1, 3)).toHaveValue('7')
  // On Chromium this is the only check that catches a key taking focus: the
  // digit still lands and the shading stays, but the next key would have
  // nowhere to write.
  await expect(board.cell(1, 3)).toBeFocused()
  await expect(board.cell(1, 3)).toHaveClass(SELECTED)
  await expect(board.announcer).toHaveText('Row 1 column 3 set to 7')

  await board.erase.tap()
  await expect(board.cell(1, 3)).toHaveValue('')
  await expect(board.cell(1, 3)).toBeFocused()
  await expect(board.announcer).toHaveText('Row 1 column 3 cleared')
})

test('the keys only wake for a cell that can be written', async ({ board }) => {
  await board.deal('easy')
  await expect(board.key(5)).toHaveAttribute('aria-disabled', 'true')

  await board.choose(1, 3)
  await expect(board.key(5)).toHaveAttribute('aria-disabled', 'false')

  // r1c1 is a clue. Tapping a switched-off key must leave it chosen: a
  // disabled button would swallow the touch and blur the cell, which is why
  // the keys use aria-disabled instead.
  await board.choose(1, 1)
  await expect(board.key(5)).toHaveAttribute('aria-disabled', 'true')
  await board.tapAnyway(board.key(5))
  await expect(board.cell(1, 1)).toBeFocused()
  await expect(board.cell(1, 1)).toHaveClass(SELECTED)
  await expect(board.cell(1, 1)).toHaveValue('5')
})

test('a second tap on the chosen cell is swallowed', async ({ board }) => {
  // On an iPhone that tap would raise the Paste and AutoFill menu over the
  // board. Here it shows as a tap that produces no click.
  const { page } = board
  await page.evaluate(() => {
    const counted = window as unknown as { clicks: number }
    counted.clicks = 0
    document.addEventListener('click', () => counted.clicks++, true)
  })
  const clicks = () => page.evaluate(() => (window as unknown as { clicks: number }).clicks)

  await board.choose(1, 3)
  expect(await clicks()).toBe(1)
  await board.choose(1, 3)
  expect(await clicks()).toBe(1)

  await expect(board.cell(1, 3)).toBeFocused()
  const selection = await board
    .cell(1, 3)
    .evaluate((input) => [(input as HTMLInputElement).selectionStart, (input as HTMLInputElement).selectionEnd])
  expect(selection[0], 'nothing selected, so no selection handles either').toBe(selection[1])
})
