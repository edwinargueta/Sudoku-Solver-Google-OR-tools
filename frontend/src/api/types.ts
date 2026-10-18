/**
 * The wire contract, mirroring the Pydantic models in `app/models/schemas.py`.
 *
 * A grid is always a 9x9 array of ints with 0 for an empty cell, in both
 * directions — the 81-character string form is an input convenience only.
 */

export type Grid = number[][]

/** What CP-SAT concluded, flattened to the cases the UI cares about. */
export type SolveStatus = 'SOLVED' | 'INFEASIBLE' | 'UNKNOWN'

/**
 * A given that repeats inside its row, column or box. Every cell of a clash is
 * reported, once for each unit it repeats in.
 */
export interface Conflict {
  row: number
  col: number
  unit: string
  value: number
  message: string
}

export interface Puzzle {
  key: string
  label: string
  level: string
  puzzle: string
  grid: Grid
  givens: number
  source: string
}

export interface Level {
  key: string
  label: string
  description: string
  count: number
}

export interface SolveResponse {
  status: SolveStatus
  solution: Grid | null
  solutions: Grid[]
  solution_count: number
  /** The search ran to the end and found exactly one solution. */
  unique: boolean
  /** The search ran to the end, so solution_count is every solution there is. */
  exhaustive: boolean
  /** The search stopped early, at max_solutions or the time limit. */
  truncated: boolean
  wall_time_ms: number
  branches: number
  conflicts: Conflict[]
}

export interface ValidateResponse {
  consistent: boolean
  complete: boolean
  givens: number
  conflicts: Conflict[]
}

export interface Health {
  status: string
  app_name: string
  ortools_version: string
}
