/**
 * The board and the number pad on screen together, which is the point of the
 * pad: a phone's own keyboard used to cover the bottom of the puzzle.
 *
 * Positions are compared with each other and with the window, never with fixed
 * pixels, so a change of font or a few pixels of spacing does not break them.
 */

import { devices } from '@playwright/test'

import type { Board } from '../board'
import { expect, test } from '../fixtures'

/** Grid top and pad bottom, relative to the window, and the window's height. */
async function span(board: Board) {
  const grid = await board.box(board.grid)
  const pad = await board.box(board.pad)
  const height = await board.page.evaluate(() => window.innerHeight)
  return { gridTop: grid.y, gridHeight: grid.height, padBottom: pad.y + pad.height, height }
}

/** Scroll so the board's top edge meets the window's, as a player would. */
async function scrollBoardToTop(board: Board) {
  await board.grid.evaluate((grid) => window.scrollBy(0, grid.getBoundingClientRect().top))
}

async function actionBoxes(board: Board) {
  const buttons = await board.actions.getByRole('button').all()
  return Promise.all(buttons.map((button) => board.box(button)))
}

test('the board and the pad fit on this phone without scrolling', { tag: '@smoke' }, async ({ board }) => {
  const { gridTop, padBottom, height } = await span(board)
  expect(gridTop).toBeGreaterThanOrEqual(0)
  expect(padBottom, `pad bottom ${padBottom} of a ${height}px window`).toBeLessThanOrEqual(height)
})

// Other iPhones. Sizes only, so they run on the iPhone project alone.
for (const name of ['iPhone 13 Mini', 'iPhone 17 Pro Max'] as const) {
  test.describe(name, () => {
    test.use({ viewport: devices[name].viewport })

    test('fits the board and the pad without scrolling', { tag: '@any-engine' }, async ({ board }) => {
      const { gridTop, padBottom, height } = await span(board)
      expect(gridTop).toBeGreaterThanOrEqual(0)
      expect(padBottom).toBeLessThanOrEqual(height)
    })
  })

  test.describe(`${name} on its side`, () => {
    test.use({ viewport: devices[`${name} landscape`].viewport })

    // About 330-390px tall: the board is capped so the pad still fits under it
    // once the header has scrolled away.
    test('fits the board and the pad once the board is scrolled up', { tag: '@any-engine' }, async ({ board }) => {
      await scrollBoardToTop(board)
      const { gridTop, gridHeight, padBottom, height } = await span(board)
      expect(gridHeight).toBeLessThanOrEqual(height - 72 + 1)
      expect(padBottom - gridTop, `board and pad span ${padBottom - gridTop}px of ${height}px`).toBeLessThanOrEqual(height)
    })
  })
}

test.describe('an iPad on its side', () => {
  test.use({ viewport: devices['iPad Pro 11 landscape'].viewport })

  // Wide enough for the desktop layout, but still a finger: the pad stays.
  test('keeps the pad, with the actions in one row', { tag: '@any-engine' }, async ({ board }) => {
    await expect(board.pad).toBeVisible()
    const boxes = await actionBoxes(board)
    expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1)
  })
})

test('the actions are two rows of two, all one height and big enough to hit', async ({ board }) => {
  const boxes = await actionBoxes(board)
  expect(new Set(boxes.map((box) => Math.round(box.y))).size, 'two rows').toBe(2)
  expect(new Set(boxes.map((box) => Math.round(box.x))).size, 'two columns').toBe(2)
  // A label that wraps makes its button taller than the others.
  const heights = boxes.map((box) => box.height)
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)
})

test('the board fills the width of its panel', async ({ board }) => {
  // The phone rules override earlier ones, so they only work while they come
  // last in the stylesheet; when they did not, the board sat 16px narrower.
  const content = await board.page.getByRole('region', { name: 'Board' }).evaluate((panel) => {
    const style = getComputedStyle(panel)
    return panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  })
  const grid = await board.box(board.grid)
  expect(Math.abs(grid.width - content)).toBeLessThanOrEqual(1)
})

test('nothing scrolls sideways', async ({ board }) => {
  const overflow = await board.page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test.describe('at the width where the phone layout ends', () => {
  for (const [width, rows] of [[820, 2], [821, 1]] as const) {
    test.describe(`${width}px`, () => {
      test.use({ viewport: { width, height: 1100 } })

      test(`the actions sit in ${rows === 1 ? 'one row' : 'two rows'}`, { tag: '@any-engine' }, async ({ board }) => {
        const boxes = await actionBoxes(board)
        expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(rows)
      })
    })
  }
})
