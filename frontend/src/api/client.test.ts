import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  TIMEOUT_MS,
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

/** A response whose body is not JSON: a proxy's error page, or index.html. */
function mockFetchText({ ok = true, status = 200 } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
  } as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The options the last call passed to fetch. */
function sentOptions(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  const [, options] = fetchMock.mock.lastCall as [string, RequestInit]
  return options
}

/** The request body the last call sent, parsed back out of JSON. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse(String(sentOptions(fetchMock).body)) as Record<string, unknown>
}

const GRID: Grid = Array.from({ length: 9 }, () => Array<number>(9).fill(0))

afterEach(() => {
  vi.useRealTimers()
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

  it('names the puzzle to leave out of the draw, when there is one', async () => {
    const fetchMock = mockFetch({})
    await getRandomPuzzle('easy', 'easy-3')
    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/levels/easy/random?exclude=easy-3')
    await getRandomPuzzle('easy')
    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/levels/easy/random')
  })

  // A Content-Type of application/json is not one a browser sends on its own,
  // so on a cross-origin API it would make every read wait for a preflight.
  it('sends a bodiless GET, with no Content-Type', async () => {
    const fetchMock = mockFetch([])
    await listLevels()
    const options = sentOptions(fetchMock)
    expect(options.method ?? 'GET').toBe('GET')
    expect(options.body).toBeUndefined()
    expect(options.headers).toBeUndefined()
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

    await solvePuzzle(GRID, { timeLimitS: 2.5 })
    expect(sentBody(fetchMock).time_limit_s).toBe(2.5)
  })

  it('posts as JSON', async () => {
    const fetchMock = mockFetch({ status: 'SOLVED' })
    await solvePuzzle(GRID)
    const options = sentOptions(fetchMock)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
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

  it('shows a busy solver\'s own words', async () => {
    mockFetch({ detail: 'The solver is busy. Try again in a moment.' }, { ok: false, status: 503 })
    await expect(solvePuzzle(GRID)).rejects.toMatchObject({
      message: 'The solver is busy. Try again in a moment.',
      status: 503,
    })
  })

  it('falls back to the status when the body carries no detail it understands', async () => {
    mockFetch({ something: 'else' }, { ok: false, status: 500 })
    await expect(getHealth()).rejects.toThrow('Request failed (HTTP 500).')
  })

  it('says the solver is unavailable when a proxy answers for it', async () => {
    // nginx and Traefik answer with a page of their own, not JSON, while the
    // API behind them is down: Traefik's is a 503 when no pod is ready.
    mockFetchText({ ok: false, status: 503 })
    await expect(listLevels()).rejects.toMatchObject({
      name: 'ApiError',
      message: 'The solver is unavailable right now (HTTP 503). Try again shortly.',
      status: 503,
    })
  })

  it('points a developer at uvicorn when the dev server finds nothing behind its proxy', async () => {
    // The dev server's proxy answers an empty 502 then; see vite.config.ts.
    mockFetchText({ ok: false, status: 502 })
    await expect(listLevels()).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Cannot reach the solver API — is uvicorn running?',
      status: 502,
    })
  })

  it('names the status of any other failure that is not JSON', async () => {
    mockFetchText({ ok: false, status: 500 })
    await expect(listLevels()).rejects.toThrow('Request failed (HTTP 500).')
  })

  it('refuses a success that is not JSON, rather than hand back null', async () => {
    // What a misrouted API base gets: the SPA's index.html, with a 200.
    mockFetchText()
    await expect(listLevels()).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Unexpected response from the solver API.',
      status: 200,
    })
  })

  it('explains an unreachable API rather than leaking the fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await getHealth().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('Cannot reach the solver API — is uvicorn running?')
    expect((error as ApiError).detail).toBe('Failed to fetch')
  })

  it('gives up on a request that never answers', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, { signal }: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    const pending = solvePuzzle(GRID).catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1)
    let settled = false
    void pending.then(() => (settled = true))
    await Promise.resolve()
    expect(settled, 'still waiting just short of the limit').toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const error = await pending
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('The solver API did not answer in time. Try again.')
  })
})

describe('in a production build', () => {
  // The module reads its environment once, when it loads.
  async function freshClient() {
    vi.resetModules()
    return import('./client')
  }

  it('does not tell a visitor to start uvicorn', async () => {
    vi.stubEnv('DEV', false)
    const client = await freshClient()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(client.getHealth()).rejects.toThrow(
      'Cannot reach the solver API. Check your connection and try again.',
    )
  })

  it('says a 502 from nginx is the solver being unavailable, not uvicorn being stopped', async () => {
    vi.stubEnv('DEV', false)
    const client = await freshClient()
    mockFetchText({ ok: false, status: 502 })
    await expect(client.listLevels()).rejects.toThrow(
      'The solver is unavailable right now (HTTP 502). Try again shortly.',
    )
  })

  it('treats an empty API base as unset, not as the site root', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const client = await freshClient()
    const fetchMock = mockFetch([])
    await client.listLevels()
    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/levels')
  })

  it('drops a trailing slash from the API base', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/api/')
    const client = await freshClient()
    const fetchMock = mockFetch([])
    await client.listLevels()
    expect(fetchMock.mock.lastCall?.[0]).toBe('https://api.example.test/api/levels')
  })
})
