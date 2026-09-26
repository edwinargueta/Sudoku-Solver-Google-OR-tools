/**
 * A game, start to finish.
 *
 * Moves go through the Board, so each of these types on a desktop and taps the
 * number pad on a phone. What they add over the unit tests is the real API:
 * the Vitest suite mocks fetch everywhere, so only here do the UI and the
 * FastAPI schemas have to agree. The @any-engine ones run on desktop and
 * iphone only.
 */

import { CONFLICT, LOCKED, SELECTED } from './board'
import { expect, test } from './fixtures'
import { EASY_1 } from './puzzles'

test('opens connected to the API, with the levels listed', { tag: ['@smoke', '@any-engine'] }, async ({ board }) => {
  await expect(board.badge).toHaveText(/^OR-Tools \d/)
  await expect(board.picker.getByRole('option', { name: /^Easy/ })).toBeAttached()
  // Nothing to solve on an empty board.
  await expect(board.action('Solve')).toBeDisabled()
})

test('dealing a level locks its clues against this device\'s input', { tag: '@smoke' }, async ({ board }) => {
  await board.deal('easy')
  await expect(board.status).toHaveText(`Loaded ${EASY_1.label} — ${EASY_1.givens} givens.`)
  expect(await board.rows()).toEqual(EASY_1.puzzle)
  await expect(board.grid.locator('input[readonly]')).toHaveCount(EASY_1.givens)

  // r1c1 is a 5 in the puzzle.
  await expect(board.cell(1, 1)).toHaveClass(LOCKED)
  await board.attempt(1, 1, 9)
  await expect(board.cell(1, 1)).toHaveValue('5')
  // Still chosen, so a refused key did not throw the player off the board.
  await expect(board.cell(1, 1)).toHaveClass(SELECTED)
})

test('Solve fills the board around the clues', { tag: ['@smoke', '@any-engine'] }, async ({ board }) => {
  await board.deal('easy')
  await board.press('Solve')
  await expect(board.status).toHaveText(/^Solved in .* · unique solution$/)
  expect(await board.rows()).toEqual(EASY_1.solution)
  await expect(board.cell(1, 1)).toHaveClass(LOCKED)
  await expect(board.page.getByText('SOLVED', { exact: true })).toBeVisible()
})

test('Check Moves catches a clash entered with this device\'s input', async ({ board }) => {
  await board.deal('easy')
  // Row 1 already has a 5, in the same box too.
  await board.enter(1, 3, 5)
  await expect(board.cell(1, 3)).toHaveValue('5')
  await board.press('Check Moves')
  await expect(board.status).toHaveText(/conflict\(s\): r1c3=5 repeats in its row/)
  await expect(board.cell(1, 3)).toHaveClass(CONFLICT)
  await expect(board.cell(1, 1)).not.toHaveClass(CONFLICT)
})

test('contradictory clues are named rather than solved', { tag: '@any-engine' }, async ({ board }) => {
  await board.deal('blank')
  await board.enter(1, 1, 5)
  await board.enter(1, 2, 5)
  await board.press('Solve')
  await expect(board.status).toHaveText(/^Contradictory givens: r1c2=5 repeats in its row/)
  await expect(board.cell(1, 2)).toHaveClass(CONFLICT)
})

test.describe('with the random draw left alone', () => {
  test.use({ pinPuzzles: false })

  test('New puzzle deals a real puzzle from the level', async ({ board }) => {
    const dealt = board.page.waitForResponse(/\/api\/levels\/easy\/random$/)
    await board.deal('easy')
    expect((await (await dealt).json()).key).toMatch(/^easy-\d+$/)
    await expect(board.status).toHaveText(/^Loaded Easy #\d+ — \d+ givens\.$/)

    const redealt = board.page.waitForResponse(/\/api\/levels\/easy\/random$/)
    await board.newPuzzle()
    expect((await redealt).ok()).toBe(true)
    await expect(board.grid.locator('input[readonly]')).not.toHaveCount(0)
  })
})
