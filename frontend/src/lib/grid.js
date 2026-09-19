/** Grid helpers shared by the components. A cell is 0..9, where 0 means empty. */

export const SIZE = 9
export const EMPTY = 0

export function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY))
}

export function cloneGrid(grid) {
  return grid.map((row) => [...row])
}

export function setCell(grid, row, col, value) {
  const next = cloneGrid(grid)
  next[row][col] = value
  return next
}

/** Cell keys ("r,c") that were filled in the source grid — the givens. */
export function givenKeys(grid) {
  const keys = new Set()
  grid.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value !== EMPTY) keys.add(`${r},${c}`)
    }),
  )
  return keys
}

export function countFilled(grid) {
  return grid.flat().filter((value) => value !== EMPTY).length
}

export function gridsEqual(a, b) {
  return a.every((row, r) => row.every((value, c) => value === b[r][c]))
}

/** Conflict payloads from the API, reduced to the cell keys to highlight. */
export function conflictKeys(conflicts = []) {
  return new Set(conflicts.map((conflict) => `${conflict.row},${conflict.col}`))
}
