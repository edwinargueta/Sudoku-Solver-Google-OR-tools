/**
 * The desktop layout, which only a real stylesheet can show.
 *
 * Geometry is compared element to element, never against fixed pixels: fonts
 * differ between macOS and the Linux CI runner, and moving an element by a few
 * pixels should not break a test that is about which way they line up.
 */

import type { Locator } from '@playwright/test'

import type { Board } from '../board'
import { expect, test } from '../fixtures'

async function actionBoxes(board: Board) {
  const buttons = await board.actions.getByRole('button').all()
  return Promise.all(buttons.map((button: Locator) => board.box(button)))
}

test('the four actions share one row under the board, one line each', async ({ board }) => {
  const grid = await board.box(board.grid)
  const actions = await board.box(board.actions)
  const boxes = await actionBoxes(board)

  expect(new Set(boxes.map((box) => Math.round(box.y))).size, 'one row').toBe(1)
  // A label that wraps makes its button taller than the 44px touch minimum.
  for (const box of boxes) expect(box.height).toBeLessThanOrEqual(45)
  expect(Math.abs(actions.width - grid.width), 'as wide as the board').toBeLessThanOrEqual(1)
  expect(actions.y).toBeGreaterThan(grid.y + grid.height)
})

test('the board holds still while a request is out', async ({ board }) => {
  // Solve reads "Solving…" until the answer arrives. The request is held open
  // here so the busy state lasts long enough to measure.
  await board.deal('easy')
  const idle = await board.box(board.grid)

  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await board.page.route('**/api/solve', async (route) => {
    await held
    await route.continue()
  })
  await board.press('Solve')
  await expect(board.actions.getByRole('button', { name: 'Solving…' })).toBeVisible()
  const busy = await board.box(board.grid)
  release()

  expect(busy.x, 'the board moved sideways while busy').toBeCloseTo(idle.x, 0)
  expect(busy.width).toBeCloseTo(idle.width, 0)
  await expect(board.status).toHaveText(/^Solved in /)
})

test('the settings sit beside the board, not under it', async ({ board }) => {
  const boardPanel = await board.box(board.page.getByRole('region', { name: 'Board' }))
  const controls = await board.box(board.page.getByRole('region', { name: 'Controls' }))
  expect(controls.x).toBeGreaterThanOrEqual(boardPanel.x + boardPanel.width)
  expect(Math.abs(controls.y - boardPanel.y)).toBeLessThanOrEqual(1)
})

test.describe('in a window as narrow as a phone', () => {
  test.use({ viewport: { width: 700, height: 900 } })

  test('the actions fold into two rows of two, and still no pad', async ({ board }) => {
    const boxes = await actionBoxes(board)
    expect(new Set(boxes.map((box) => Math.round(box.y))).size, 'two rows').toBe(2)
    expect(new Set(boxes.map((box) => Math.round(box.x))).size, 'two columns').toBe(2)
    await expect(board.pad).toHaveCount(0)
  })
})
