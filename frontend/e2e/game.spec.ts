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
import { RANDOM_DRAW, expect, test } from './fixtures'
import { EASY_1 } from './puzzles'

test('opens connected to the API, with the levels listed', { tag: ['@smoke', '@any-engine'] }, async ({ board }) => {
  await expect(board.badge).toHaveText(/^OR-Tools \d/)
  await expect(board.picker.getByRole('option', { name: /^Easy/ })).toBeAttached()
  // Nothing to solve on an empty board.
  await expect(board.action('Solve')).toBeDisabled()
  // A build is served with the API behind it, so the docs are on this origin.
  await expect(board.page.getByRole('link', { name: 'API docs' })).toHaveAttribute('href', '/docs')
})

test('dealing a level locks its clues against this device\'s input', { tag: '@smoke' }, async ({ board }) => {
  await board.deal('easy')
  await expect(board.status).toHaveText(`Loaded ${EASY_1.label} — ${EASY_1.givens} givens.`)
  await expect.poll(() => board.rows()).toEqual(EASY_1.puzzle)
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
  await expect.poll(() => board.rows()).toEqual(EASY_1.solution)
  await expect(board.cell(1, 1)).toHaveClass(LOCKED)
  await expect(board.page.getByText('SOLVED', { exact: true })).toBeVisible()
  // The solver's own answer has nothing for Check Moves to find.
  await expect(board.action('Check Moves')).toBeDisabled()
})

test('erasing a solved cell goes back to the player\'s board', async ({ board }) => {
  await board.deal('easy')
  await board.press('Solve')
  await expect(board.status).toHaveText(/^Solved in /)
  // r1c3 is empty in the puzzle; the solver put its 4 there.
  await expect(board.cell(1, 3)).toHaveValue('4')

  await board.empty(1, 3)
  await expect(board.cell(1, 3)).toHaveValue('')
  await expect(board.status).not.toHaveText(/^Solved in /)
  await expect.poll(() => board.rows()).toEqual(EASY_1.puzzle)
})

// Typed or tapped, a key for the digit already there changes nothing, so the
// solution stays up around it. The pad once took it as a move.
test('entering the digit the solver put in a cell keeps the solution', async ({ board }) => {
  await board.deal('easy')
  await board.press('Solve')
  await expect(board.status).toHaveText(/^Solved in /)

  await board.enter(1, 3, 4)
  await expect(board.status).toHaveText(/^Solved in /)
  await expect.poll(() => board.rows()).toEqual(EASY_1.solution)
  await expect(board.action('Undo')).toBeDisabled()
})

test('Check Moves marks both cells of a clash, and names the player\'s', async ({ board }) => {
  await board.deal('easy')
  // Row 1 already has a 5 at r1c1, in the same box too.
  await board.enter(1, 3, 5)
  await expect(board.cell(1, 3)).toHaveValue('5')
  await board.press('Check Moves')
  await expect(board.status).toHaveText('2 cells in conflict: r1c3=5 repeats in its row')
  for (const [row, col] of [[1, 1], [1, 3]] as const) {
    await expect(board.cell(row, col)).toHaveClass(CONFLICT)
    await expect(board.cell(row, col)).toHaveAttribute('aria-invalid', 'true')
  }
  await expect(board.cell(1, 2)).not.toHaveClass(CONFLICT)
})

// The backend once reported only the later cell of a clash in reading order,
// which here is the clue: the player's own mistake went unmarked.
test('a clash with a clue further along the row still marks the player\'s entry', async ({ board }) => {
  await board.deal('easy')
  // r1c5 is a 7 in the puzzle.
  await board.enter(1, 3, 7)
  await board.press('Check Moves')
  await expect(board.status).toHaveText('2 cells in conflict: r1c3=7 repeats in its row')
  await expect(board.cell(1, 3)).toHaveClass(CONFLICT)
  await expect(board.cell(1, 5)).toHaveClass(CONFLICT)
})

test('contradictory clues are named rather than solved', { tag: '@any-engine' }, async ({ board }) => {
  await board.deal('blank')
  await board.enter(1, 1, 5)
  await board.enter(1, 2, 5)
  await board.press('Solve')
  await expect(board.status).toHaveText(/^Contradictory givens: r1c1=5 repeats in its row/)
  await expect(board.cell(1, 1)).toHaveClass(CONFLICT)
  await expect(board.cell(1, 2)).toHaveClass(CONFLICT)
})

test.describe('before throwing moves away', () => {
  test('a new level asks first, and a no keeps the game and the level', async ({ board }) => {
    await board.deal('easy')
    await board.enter(1, 3, 4)

    const asked = board.answerNextDialog(false)
    await board.picker.selectOption('medium')
    expect(await asked).toMatch(/moves on this one will be lost/)
    await expect(board.picker).toHaveValue('easy')
    await expect(board.cell(1, 3)).toHaveValue('4')

    void board.answerNextDialog(true)
    await board.picker.selectOption('medium')
    await expect(board.status).toHaveText(/^Loaded Medium #1 /)
    await expect(board.picker).toHaveValue('medium')
  })

  test('Clear asks first, and a yes clears', async ({ board }) => {
    await board.deal('easy')
    await board.enter(1, 3, 4)

    void board.answerNextDialog(false)
    await board.press('Clear')
    await expect(board.cell(1, 3)).toHaveValue('4')

    void board.answerNextDialog(true)
    await board.press('Clear')
    await expect(board.cell(1, 3)).toHaveValue('')
    await expect(board.status).toHaveText('Cleared your moves; the givens are still there.')
  })

  test('nothing is asked with no moves to lose', async ({ board }) => {
    let asked = false
    board.page.on('dialog', (dialog) => {
      asked = true
      void dialog.dismiss()
    })
    await board.deal('easy')
    await board.deal('medium')
    await board.press('Clear')
    expect(asked).toBe(false)
  })
})

test.describe('with the random draw left alone', () => {
  test.use({ pinPuzzles: false })

  test('New puzzle deals a different puzzle from the level', async ({ board }) => {
    const dealt = board.page.waitForResponse(RANDOM_DRAW)
    await board.deal('easy')
    const first = await (await dealt).json()
    expect(first.key).toMatch(/^easy-\d+$/)
    await expect(board.status).toHaveText(`Loaded ${first.label} — ${first.givens} givens.`)

    const redealt = board.page.waitForResponse(RANDOM_DRAW)
    await board.page.getByRole('button', { name: 'New puzzle' }).click()
    const response = await redealt
    expect(new URL(response.url()).searchParams.get('exclude')).toBe(first.key)
    const next = await response.json()
    expect(next.key, 'never the puzzle already on the board').not.toBe(first.key)
    expect(next.key).toMatch(/^easy-\d+$/)

    // And it is the one on the board now.
    await expect(board.status).toHaveText(`Loaded ${next.label} — ${next.givens} givens.`)
    const rows = (next.grid as number[][]).map((row) => row.map((value) => value || '.').join(''))
    await expect.poll(() => board.rows()).toEqual(rows)
  })
})
