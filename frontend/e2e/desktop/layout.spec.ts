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

// The button pressed is the one that goes busy. Disabling it would drop focus
// to the page, and the next Tab would start again from the top.
test('focus stays on the action while its request is out', async ({ board }) => {
  await board.deal('easy')
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await board.page.route('**/api/solve', async (route) => {
    await held
    await route.continue()
  })

  await board.action('Solve').focus()
  await board.page.keyboard.press('Enter')
  const solving = board.actions.getByRole('button', { name: 'Solving…' })
  await expect(solving).toBeFocused()
  await expect(solving).toHaveAttribute('aria-disabled', 'true')
  release()
  await expect(board.status).toHaveText(/^Solved in /)
  await expect(board.action('Solve')).toBeFocused()
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

  // A narrow window still has a keyboard; only a touch screen goes without.
  test('still says how to play with the keyboard', async ({ board }) => {
    await expect(board.page.getByText('Type 1–9, arrow keys to move')).toBeVisible()
  })
})

/**
 * How a digit in the cell reads against what is painted behind it: the tint
 * layered over the cell's own background, as the browser composites them.
 */
async function digitContrast(board: Board, row: number, col: number): Promise<number> {
  return board.cell(row, col).evaluate((cell) => {
    const rgba = (text: string) => (text.match(/[\d.]+/g) ?? []).map(Number)
    const style = getComputedStyle(cell)
    const [r, g, b] = rgba(style.color)
    const base = rgba(style.backgroundColor)
    const tint = rgba(style.backgroundImage.match(/rgba?\([^)]*\)/)?.[0] ?? 'rgba(0, 0, 0, 0)')
    const alpha = tint[3] ?? 1
    const behind = [0, 1, 2].map((i) => tint[i] * alpha + base[i] * (1 - alpha))
    const luminance = ([red, green, blue]: number[]) => {
      const [lr, lg, lb] = [red, green, blue].map((value) => {
        const v = value / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
    }
    const [light, dark] = [luminance([r, g, b]), luminance(behind)].sort((x, y) => y - x)
    return (light + 0.05) / (dark + 0.05)
  })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`in ${colorScheme} mode`, () => {
    test.use({ colorScheme })

    // Cell digits are at most 22.4px at weight 500, which WCAG counts as
    // normal text: 4.5:1, including on the tint of the cell being typed into.
    test('digits keep 4.5:1 in the selected cell, conflicted or not', async ({ board }) => {
      await board.deal('easy')
      await board.enter(1, 3, 4)
      expect(await digitContrast(board, 1, 3), 'typed, selected').toBeGreaterThanOrEqual(4.5)

      await board.enter(1, 3, 5)
      await board.press('Check Moves')
      await expect(board.cell(1, 3)).toHaveAttribute('aria-invalid', 'true')
      await board.choose(1, 3)
      expect(await digitContrast(board, 1, 3), 'in conflict, selected').toBeGreaterThanOrEqual(4.5)
      expect(await digitContrast(board, 1, 4), 'a peer').toBeGreaterThanOrEqual(4.5)
    })
  })
}

test.describe('in forced colors', () => {
  test.use({ forcedColors: 'active' })

  // Forced colors paint every cell the same and drop the tints, so a clash
  // and the selection each need a line that survives.
  test('a clash and the selected cell are still marked', async ({ board }) => {
    await board.deal('easy')
    await board.enter(1, 3, 5)
    await board.press('Check Moves')
    await expect(board.cell(1, 1)).toHaveCSS('outline-style', 'dashed')
    // The underline stays too, the one sign of a clash that is the same in every mode.
    await expect(board.cell(1, 1)).toHaveCSS('text-decoration-style', 'wavy')
    await board.choose(2, 2)
    await expect(board.cell(2, 2)).toHaveCSS('outline-style', 'solid')
    await expect(board.cell(2, 2)).toHaveCSS('outline-width', '3px')
  })
})
