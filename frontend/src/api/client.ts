/**
 * Thin wrapper over the FastAPI backend.
 *
 * Every function resolves to a parsed, typed body or throws ApiError, so
 * components can render a message instead of unpacking Response objects.
 */

import type { Grid, Health, Level, Puzzle, SolveResponse, ValidateResponse } from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

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
function describeDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return (detail as ValidationError[])
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : ''
        return field ? `${field}: ${item.msg}` : (item.msg ?? 'Invalid request')
      })
      .join('; ')
  }
  return 'Request failed'
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch (cause) {
    throw new ApiError('Cannot reach the solver API — is uvicorn running?', {
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail
    throw new ApiError(describeDetail(detail), { status: response.status, detail })
  }
  return body as T
}

/** GET /api/health — liveness plus the OR-Tools build in use. */
export function getHealth(): Promise<Health> {
  return request<Health>('/health')
}

/** GET /api/levels — the difficulty bands and how many puzzles each holds. */
export function listLevels(): Promise<Level[]> {
  return request<Level[]>('/levels')
}

/** GET /api/levels/{key}/random — one puzzle drawn at random from a level. */
export function getRandomPuzzle(level: string): Promise<Puzzle> {
  return request<Puzzle>(`/levels/${encodeURIComponent(level)}/random`)
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
    method: 'POST',
    body: JSON.stringify({
      grid,
      max_solutions: maxSolutions,
      ...(timeLimitS ? { time_limit_s: timeLimitS } : {}),
    }),
  })
}

/** POST /api/validate — duplicate givens, without solving. */
export function validateGrid(grid: Grid): Promise<ValidateResponse> {
  return request<ValidateResponse>('/validate', {
    method: 'POST',
    body: JSON.stringify({ grid }),
  })
}
