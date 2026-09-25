import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  getHealth,
  getRandomPuzzle,
  listLevels,
  solvePuzzle,
  validateGrid,
} from './client'
import type { Grid } from './types'

/** Stand in for fetch, resolving to a body and status of the test's choosing. */
function mockFetch(body: unknown, { ok = true, status = 200 } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The request body the last call sent, parsed back out of JSON. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
  return JSON.parse(String(options.body)) as Record<string, unknown>
}

const GRID: Grid = Array.from({ length: 9 }, () => Array<number>(9).fill(0))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading endpoints', () => {
  it('asks for health and hands back the parsed body', async () => {
    const fetchMock = mockFetch({ status: 'ok', app_name: 'Sudoku', ortools_version: '9.15' })
    await expect(getHealth()).resolves.toEqual({
      status: 'ok',
      app_name: 'Sudoku',
      ortools_version: '9.15',
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/health')
  })

  it('lists levels', async () => {
    const levels = [{ key: 'easy', label: 'Easy', description: 'singles', count: 10 }]
    mockFetch(levels)
    await expect(listLevels()).resolves.toEqual(levels)
  })

  it('escapes the level on its way into the path', async () => {
    const fetchMock = mockFetch({})
    await getRandomPuzzle('odd/level')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/levels/odd%2Flevel/random')
  })
})

describe('solvePuzzle', () => {
  it('asks for one solution by default', async () => {
    const fetchMock = mockFetch({ status: 'SOLVED' })
    await solvePuzzle(GRID)
    expect(sentBody(fetchMock)).toEqual({ grid: GRID, max_solutions: 1 })
  })

  it('passes the uniqueness check through', async () => {
    const fetchMock = mockFetch({ status: 'SOLVED' })
    await solvePuzzle(GRID, { maxSolutions: 2 })
    expect(sentBody(fetchMock).max_solutions).toBe(2)
  })

  it('leaves the time limit out unless one was given', async () => {
    const fetchMock = mockFetch({ status: 'SOLVED' })
    await solvePuzzle(GRID)
    expect(sentBody(fetchMock)).not.toHaveProperty('time_limit_s')

    vi.unstubAllGlobals()
    const withLimit = mockFetch({ status: 'SOLVED' })
    await solvePuzzle(GRID, { timeLimitS: 2.5 })
    expect(sentBody(withLimit).time_limit_s).toBe(2.5)
  })

  it('posts as JSON', async () => {
    const fetchMock = mockFetch({ status: 'SOLVED' })
    await solvePuzzle(GRID)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })
})

describe('validateGrid', () => {
  it('sends the grid on its own', async () => {
    const fetchMock = mockFetch({ consistent: true, complete: false, givens: 0, conflicts: [] })
    await validateGrid(GRID)
    expect(sentBody(fetchMock)).toEqual({ grid: GRID })
  })
})

describe('failures', () => {
  it('surfaces a plain string detail', async () => {
    mockFetch({ detail: "unknown level 'nope'" }, { ok: false, status: 404 })
    await expect(getHealth()).rejects.toMatchObject({
      name: 'ApiError',
      message: "unknown level 'nope'",
      status: 404,
    })
  })

  it('flattens the per-field errors FastAPI returns with a 422', async () => {
    mockFetch(
      {
        detail: [
          { loc: ['body', 'grid'], msg: 'grid must be 9x9' },
          { loc: ['body', 'max_solutions'], msg: 'must be >= 1' },
        ],
      },
      { ok: false, status: 422 },
    )
    await expect(solvePuzzle(GRID)).rejects.toThrow(
      'grid: grid must be 9x9; max_solutions: must be >= 1',
    )
  })

  it('falls back when the body carries no detail it understands', async () => {
    mockFetch({ something: 'else' }, { ok: false, status: 500 })
    await expect(getHealth()).rejects.toThrow('Request failed')
  })

  it('explains an unreachable API rather than leaking the fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await getHealth().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('Cannot reach the solver API — is uvicorn running?')
    expect((error as ApiError).detail).toBe('Failed to fetch')
  })
})
