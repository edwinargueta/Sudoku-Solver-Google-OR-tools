/**
 * Where things live on the page.
 *
 * The only test that renders the composed layout. It exists to stop the board
 * actions drifting back into the Controls panel, which is what put them below
 * the fold on a phone in the first place.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App, { HEALTH_RETRY_MS } from './App'

const LEVELS = [{ key: 'easy', label: 'Easy', description: 'Naked singles.', count: 10 }]
const HEALTH = { status: 'ok', app_name: 'Sudoku Solver', ortools_version: '9.15.6755' }

function answer(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
}

/** What a proxy says for an API that is not there. */
function unavailable(): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status: 503,
    json: () => Promise.reject(new SyntaxError('not JSON')),
  } as Response)
}

// App mounts BackendBadge (/health) and useSudoku (/levels) on load.
const fetchMock = vi.fn((url: string) => answer(String(url).includes('/levels') ? LEVELS : HEALTH))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
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

describe('the backend badge', () => {
  it('says the API is offline when the health check fails', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/health') ? unavailable() : answer(LEVELS),
    )
    await mountApp()
    expect(await screen.findByText('API offline')).toBeDefined()
  })

  it('comes back when the network does', async () => {
    fetchMock.mockImplementationOnce(() => unavailable())
    await mountApp()
    expect(await screen.findByText('API offline')).toBeDefined()

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('OR-Tools 9.15.6755')).toBeDefined()
  })

  it('goes offline when the API does, once the page is looked at again', async () => {
    await mountApp()
    expect(await screen.findByText('OR-Tools 9.15.6755')).toBeDefined()

    fetchMock.mockImplementationOnce(() => unavailable())
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByText('API offline')).toBeDefined()
  })

  it('keeps asking while the API is down', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/health') ? unavailable() : answer(LEVELS),
    )
    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('API offline')).toBeDefined()

    fetchMock.mockImplementation((url: string) =>
      answer(String(url).includes('/levels') ? LEVELS : HEALTH),
    )
    await act(() => vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS))
    expect(screen.getByText('OR-Tools 9.15.6755')).toBeDefined()
  })
})

describe('when the levels fail to load', () => {
  it('offers a retry that fills the picker', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/levels') ? unavailable() : answer(HEALTH),
    )
    render(<App />)
    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(screen.getByRole('option', { name: 'Could not load the levels' })).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe(
      'The solver is unavailable right now (HTTP 503). Try again shortly.',
    )

    fetchMock.mockImplementation((url: string) =>
      answer(String(url).includes('/levels') ? LEVELS : HEALTH),
    )
    await user.click(retry)
    expect(await screen.findByRole('option', { name: /Easy/ })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Difficulty' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('status').textContent).toBe('Type a puzzle, or pick a difficulty.')
  })
})

describe('the API docs link', () => {
  // The Vite dev server proxies /api only, so there the docs are uvicorn's own.
  it('points at uvicorn under the dev server', async () => {
    await mountApp()
    expect(screen.getByRole('link', { name: 'API docs' }).getAttribute('href')).toBe(
      'http://127.0.0.1:8000/docs',
    )
  })

  it('points at /docs on the same origin in a build', async () => {
    vi.stubEnv('DEV', false)
    vi.resetModules()
    const { default: BuiltApp } = await import('./App')
    render(<BuiltApp />)
    await waitFor(() => expect(screen.getByRole('option', { name: /Easy/ })).toBeDefined())
    expect(screen.getByRole('link', { name: 'API docs' }).getAttribute('href')).toBe('/docs')
  })
})
