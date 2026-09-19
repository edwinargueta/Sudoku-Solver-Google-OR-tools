/**
 * Thin wrapper over the FastAPI backend.
 *
 * Every function returns parsed JSON or throws ApiError, so components can
 * render a message instead of unpacking Response objects.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

export class ApiError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/** FastAPI returns 422 detail as an array of per-field errors; flatten it. */
function describeDetail(detail) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : ''
        return field ? `${field}: ${item.msg}` : item.msg
      })
      .join('; ')
  }
  return 'Request failed'
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch (cause) {
    throw new ApiError('Cannot reach the solver API — is uvicorn running?', { detail: cause.message })
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(describeDetail(body?.detail), { status: response.status, detail: body?.detail })
  }
  return body
}

/** GET /api/health — liveness plus the OR-Tools build in use. */
export function getHealth() {
  return request('/health')
}

/** GET /api/levels — the difficulty bands and how many puzzles each holds. */
export function listLevels() {
  return request('/levels')
}

/** GET /api/levels/{key}/random — one puzzle drawn at random from a level. */
export function getRandomPuzzle(level) {
  return request(`/levels/${encodeURIComponent(level)}/random`)
}

/**
 * POST /api/solve — run CP-SAT over a 9x9 grid.
 * Pass maxSolutions: 2 to learn whether the puzzle is well-posed.
 */
export function solvePuzzle(grid, { maxSolutions = 1, timeLimitS } = {}) {
  return request('/solve', {
    method: 'POST',
    body: JSON.stringify({
      grid,
      max_solutions: maxSolutions,
      ...(timeLimitS ? { time_limit_s: timeLimitS } : {}),
    }),
  })
}

/** POST /api/validate — duplicate givens, without solving. */
export function validateGrid(grid) {
  return request('/validate', { method: 'POST', body: JSON.stringify({ grid }) })
}
