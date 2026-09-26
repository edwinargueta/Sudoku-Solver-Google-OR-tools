/**
 * Where things live on the page.
 *
 * The only test that renders the composed layout. It exists to stop the board
 * actions drifting back into the Controls panel, which is what put them below
 * the fold on a phone in the first place.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const LEVELS = [{ key: 'easy', label: 'Easy', description: 'Naked singles.', count: 10 }]
const HEALTH = { status: 'ok', app_name: 'Sudoku Solver', ortools_version: '9.15.6755' }

beforeEach(() => {
  // App mounts BackendBadge (/health) and useSudoku (/levels) on load.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(String(url).includes('/levels') ? LEVELS : HEALTH),
      } as Response),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Render and wait for both mount requests to settle, so no act warnings. */
async function mountApp() {
  render(<App />)
  await waitFor(() => expect(screen.getByRole('option', { name: /Easy/ })).toBeDefined())
}

describe('the board region', () => {
  it('holds the actions, so they sit with the puzzle rather than below it', async () => {
    await mountApp()
    const board = screen.getByRole('region', { name: 'Board' })
    expect(within(board).getByRole('group', { name: 'Board actions' })).toBeDefined()
  })

  it('holds the status line, which is the only response some actions have', async () => {
    await mountApp()
    const board = screen.getByRole('region', { name: 'Board' })
    expect(within(board).getByRole('status')).toBeDefined()
  })

  it('holds the difficulty picker, so it is visible before you scroll', async () => {
    await mountApp()
    const board = screen.getByRole('region', { name: 'Board' })
    expect(within(board).getByRole('combobox', { name: 'Difficulty' })).toBeDefined()
  })

  it('puts the picker above the board and the actions below it', async () => {
    await mountApp()
    const board = screen.getByRole('region', { name: 'Board' })
    const order = Array.from(board.children).map((child) => child.className.split(' ')[0])
    expect(order.slice(0, 3)).toEqual(['level-picker', 'grid', 'board-actions'])
  })

  it('on a touch screen, puts the number pad straight under the board', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    await mountApp()
    const board = screen.getByRole('region', { name: 'Board' })
    const order = Array.from(board.children).map((child) => child.className.split(' ')[0])
    expect(order.slice(0, 4)).toEqual(['level-picker', 'grid', 'number-pad', 'board-actions'])
  })

  it('leaves only the solver settings in the Controls region', async () => {
    await mountApp()
    const controls = screen.getByRole('region', { name: 'Controls' })
    expect(within(controls).getByRole('checkbox')).toBeDefined()
    expect(within(controls).queryByRole('group', { name: 'Board actions' })).toBeNull()
    expect(within(controls).queryByRole('combobox')).toBeNull()
  })
})

describe('the action names', () => {
  it('each resolve exactly once on the whole page', async () => {
    await mountApp()
    for (const name of ['Solve', 'Check Moves', 'Undo', 'Clear']) {
      expect(screen.getAllByRole('button', { name })).toHaveLength(1)
    }
  })
})
