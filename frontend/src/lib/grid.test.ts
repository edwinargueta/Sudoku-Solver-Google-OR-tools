import { describe, expect, it } from 'vitest'

import type { Conflict } from '../api/types'
import {
  BOX,
  EMPTY,
  SIZE,
  boxIndex,
  cellKey,
  cloneGrid,
  conflictKeys,
  countFilled,
  emptyGrid,
  givenKeys,
  gridsEqual,
  isPeer,
  setCell,
} from './grid'

describe('emptyGrid', () => {
  it('is nine rows of nine zeroes', () => {
    const grid = emptyGrid()
    expect(grid).toHaveLength(SIZE)
    expect(grid.every((row) => row.length === SIZE)).toBe(true)
    expect(grid.flat().every((value) => value === EMPTY)).toBe(true)
  })

  it('gives every row its own array', () => {
    // Array(9).fill(row) would hand out nine references to one row, and
    // writing a single cell would light up a whole column.
    const grid = emptyGrid()
    grid[0][0] = 5
    expect(grid[1][0]).toBe(EMPTY)
  })
})

describe('cloneGrid', () => {
  it('copies the rows rather than aliasing them', () => {
    const original = emptyGrid()
    const copy = cloneGrid(original)
    copy[3][4] = 9
    expect(original[3][4]).toBe(EMPTY)
  })
})

describe('setCell', () => {
  it('returns a new grid with one cell changed', () => {
    const before = emptyGrid()
    const after = setCell(before, 2, 6, 4)
    expect(after[2][6]).toBe(4)
    expect(after).not.toBe(before)
  })

  it('leaves the grid it was given alone', () => {
    const before = emptyGrid()
    setCell(before, 0, 0, 7)
    expect(before[0][0]).toBe(EMPTY)
  })
})

describe('cellKey', () => {
  it('is row then column, comma separated', () => {
    expect(cellKey(0, 0)).toBe('0,0')
    expect(cellKey(8, 3)).toBe('8,3')
  })
})

describe('givenKeys', () => {
  it('names only the filled cells', () => {
    const grid = emptyGrid()
    grid[0][1] = 5
    grid[7][7] = 9
    expect(givenKeys(grid)).toEqual(new Set(['0,1', '7,7']))
  })

  it('is empty for an empty board', () => {
    expect(givenKeys(emptyGrid()).size).toBe(0)
  })
})

describe('countFilled', () => {
  it('counts non-zero cells', () => {
    const grid = emptyGrid()
    grid[0][0] = 1
    grid[1][1] = 2
    expect(countFilled(grid)).toBe(2)
    expect(countFilled(emptyGrid())).toBe(0)
  })
})

describe('gridsEqual', () => {
  it('compares cell by cell', () => {
    const a = emptyGrid()
    const b = emptyGrid()
    expect(gridsEqual(a, b)).toBe(true)
    b[4][4] = 1
    expect(gridsEqual(a, b)).toBe(false)
  })
})

describe('conflictKeys', () => {
  it('reduces conflicts to the cells to highlight', () => {
    const conflicts: Conflict[] = [
      { row: 0, col: 4, unit: 'row', value: 6, message: 'r1c5=6 repeats in its row' },
      { row: 8, col: 0, unit: 'box', value: 2, message: 'r9c1=2 repeats in its box' },
    ]
    expect(conflictKeys(conflicts)).toEqual(new Set(['0,4', '8,0']))
  })

  it('defaults to nothing highlighted', () => {
    expect(conflictKeys().size).toBe(0)
  })
})

describe('boxIndex', () => {
  it('numbers the boxes left to right, top to bottom', () => {
    expect(boxIndex(0, 0)).toBe(0)
    expect(boxIndex(0, 8)).toBe(2)
    expect(boxIndex(4, 4)).toBe(4)
    expect(boxIndex(8, 8)).toBe(8)
  })

  it('gives every cell of a box the same number', () => {
    const corner = boxIndex(3, 3)
    for (let r = 3; r < 3 + BOX; r += 1) {
      for (let c = 3; c < 3 + BOX; c += 1) {
        expect(boxIndex(r, c)).toBe(corner)
      }
    }
  })
})

describe('isPeer', () => {
  const selected = { row: 4, col: 4 }

  it('counts the rest of the row', () => {
    expect(isPeer(selected, { row: 4, col: 0 })).toBe(true)
    expect(isPeer(selected, { row: 4, col: 8 })).toBe(true)
  })

  it('counts the rest of the column', () => {
    expect(isPeer(selected, { row: 0, col: 4 })).toBe(true)
    expect(isPeer(selected, { row: 8, col: 4 })).toBe(true)
  })

  it('counts the rest of the box', () => {
    expect(isPeer(selected, { row: 3, col: 3 })).toBe(true)
    expect(isPeer(selected, { row: 5, col: 5 })).toBe(true)
  })

  it('leaves unrelated cells alone', () => {
    expect(isPeer(selected, { row: 0, col: 0 })).toBe(false)
    expect(isPeer(selected, { row: 8, col: 0 })).toBe(false)
    expect(isPeer(selected, { row: 2, col: 7 })).toBe(false)
  })

  it('does not make a cell its own peer', () => {
    expect(isPeer(selected, selected)).toBe(false)
  })

  it('is symmetric', () => {
    const a = { row: 1, col: 7 }
    const b = { row: 1, col: 2 }
    expect(isPeer(a, b)).toBe(isPeer(b, a))
  })
})
