/** Grid helpers shared by the components. A cell is 0..9, where 0 means empty. */

import type { Conflict, Grid } from '../api/types'

export const SIZE = 9
export const EMPTY = 0

/** How a cell is addressed in the DOM and in the highlight sets. */
export type CellKey = `${number},${number}`

export function cellKey(row: number, col: number): CellKey {
  return `${row},${col}`
}

export function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(EMPTY))
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row])
}

export function setCell(grid: Grid, row: number, col: number, value: number): Grid {
  const next = cloneGrid(grid)
  next[row][col] = value
  return next
}

/** Cell keys that were filled in the source grid — the givens. */
export function givenKeys(grid: Grid): Set<CellKey> {
  const keys = new Set<CellKey>()
  grid.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value !== EMPTY) keys.add(cellKey(r, c))
    }),
  )
  return keys
}

export function countFilled(grid: Grid): number {
  return grid.flat().filter((value) => value !== EMPTY).length
}

export function gridsEqual(a: Grid, b: Grid): boolean {
  return a.every((row, r) => row.every((value, c) => value === b[r][c]))
}

/** Conflict payloads from the API, reduced to the cell keys to highlight. */
export function conflictKeys(conflicts: Conflict[] = []): Set<CellKey> {
  return new Set(conflicts.map((conflict) => cellKey(conflict.row, conflict.col)))
}
