/**
 * Thin wrapper over the FastAPI backend.
 *
 * Every function resolves to a parsed, typed body or throws ApiError, so
 * components can render a message instead of unpacking Response objects.
 */

import type { Grid, Health, Level, Puzzle, SolveResponse, ValidateResponse } from './types'

// `||` rather than `??`: an empty VITE_API_BASE_URL is a build arg left blank,
// not a request for the site root, where every call would get index.html.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')

// A little over the longest solve the server can be configured to run (60 s;
// 10 s by default). A request still out after this is stuck on the network,
// and the board would otherwise stay frozen until it settled.
export const TIMEOUT_MS = 65_000

interface ApiErrorOptions {
  status?: number
  detail?: unknown
}

export class ApiError extends Error {
  readonly status?: number
  readonly detail?: unknown

  constructor(message: string, { status, detail }: ApiErrorOptions = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/** One entry of FastAPI's 422 body: which field, and what was wrong with it. */
interface ValidationError {
  loc?: unknown[]
  msg?: string
}

/** FastAPI returns 422 detail as an array of per-field errors; flatten it. */
function describeDetail(detail: unknown): string | null {
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    return (detail as ValidationError[])
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : ''
        return field ? `${field}: ${item.msg}` : (item.msg ?? 'Invalid request')
      })
      .join('; ')
  }
  return null
}

// Only a developer running the dev server can act on the uvicorn hint; on the
// public site this means the visitor's own connection dropped.
const UNREACHABLE = import.meta.env.DEV
  ? 'Cannot reach the solver API — is uvicorn running?'
  : 'Cannot reach the solver API. Check your connection and try again.'

/**
 * The message for a failed response. A gateway status with nothing from
 * FastAPI to go on came from the proxy in front of the API, nginx or Traefik,
 * with the API behind it down. That is worth saying, since trying again may
 * well work.
 */
function describeFailure(status: number, detail: unknown): string {
  const described = describeDetail(detail)
  if (described) return described
  // Under `vite` the proxy is the dev server's own, which vite.config.ts has
  // answer 502 when uvicorn is not listening.
  if (import.meta.env.DEV && status === 502) return UNREACHABLE
  if (status === 502 || status === 503 || status === 504) {
    return `The solver is unavailable right now (HTTP ${status}). Try again shortly.`
  }
  return `Request failed (HTTP ${status}).`
}

/** A GET, or a POST of `body` as JSON when there is one. */
async function request<T>(path: string, body?: unknown): Promise<T> {
  // A plain AbortController, not AbortSignal.timeout: that needs Safari 16,
  // and the build targets older.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  let parsed = true
  let payload: unknown
  try {
    response = await fetch(
      `${BASE_URL}${path}`,
      // A bodiless GET sends no Content-Type: on a cross-origin API that
      // header alone would make every read wait for a CORS preflight.
      body === undefined
        ? { signal: controller.signal }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
    )
    payload = await response.json().catch((error: unknown) => {
      if (controller.signal.aborted) throw error
      parsed = false
      return undefined
    })
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new ApiError('The solver API did not answer in time. Try again.')
    }
    throw new ApiError(UNREACHABLE, {
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const detail = (payload as { detail?: unknown } | null | undefined)?.detail
    throw new ApiError(describeFailure(response.status, detail), {
      status: response.status,
      detail,
    })
  }
  // A 200 that is not JSON is some other server answering, such as a proxy's
  // SPA fallback handing back index.html. Resolving it as data would give the
  // caller null where it expects a puzzle.
  if (!parsed) {
    throw new ApiError('Unexpected response from the solver API.', { status: response.status })
  }
  return payload as T
}

/** GET /api/health — liveness plus the OR-Tools build in use. */
export function getHealth(): Promise<Health> {
  return request<Health>('/health')
}

/** GET /api/levels — the difficulty bands and how many puzzles each holds. */
export function listLevels(): Promise<Level[]> {
  return request<Level[]>('/levels')
}

/**
 * GET /api/levels/{key}/random — one puzzle drawn at random from a level,
 * never the one named by `exclude` while the level has another to offer.
 */
export function getRandomPuzzle(level: string, exclude?: string): Promise<Puzzle> {
  const query = exclude ? `?exclude=${encodeURIComponent(exclude)}` : ''
  return request<Puzzle>(`/levels/${encodeURIComponent(level)}/random${query}`)
}

interface SolveOptions {
  /** Ask for 2 to learn whether the puzzle is well-posed. */
  maxSolutions?: number
  timeLimitS?: number
}

/** POST /api/solve — run CP-SAT over a 9x9 grid. */
export function solvePuzzle(
  grid: Grid,
  { maxSolutions = 1, timeLimitS }: SolveOptions = {},
): Promise<SolveResponse> {
  return request<SolveResponse>('/solve', {
    grid,
    max_solutions: maxSolutions,
    ...(timeLimitS ? { time_limit_s: timeLimitS } : {}),
  })
}

/** POST /api/validate — duplicate givens, without solving. */
export function validateGrid(grid: Grid): Promise<ValidateResponse> {
  return request<ValidateResponse>('/validate', { grid })
}
