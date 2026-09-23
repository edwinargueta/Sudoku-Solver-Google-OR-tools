/** The 9x9 board: one input per cell, with arrow-key navigation. */

import type { ChangeEvent, KeyboardEvent } from 'react'

import type { Grid } from '../api/types'
import type { CellKey } from '../lib/grid'
import { EMPTY, SIZE, cellKey } from '../lib/grid'

interface CellState {
  row: number
  col: number
  isGiven: boolean
  isSolved: boolean
  isConflicted: boolean
}

function cellClassName({ row, col, isGiven, isSolved, isConflicted }: CellState): string {
  return [
    'cell',
    col % 3 === 2 && col !== SIZE - 1 ? 'cell--box-right' : '',
    row % 3 === 2 && row !== SIZE - 1 ? 'cell--box-bottom' : '',
    isGiven ? 'cell--given' : '',
    isSolved ? 'cell--solved' : '',
    isConflicted ? 'cell--conflict' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function focusCell(row: number, col: number): void {
  const next = document.querySelector<HTMLInputElement>(`[data-cell="${cellKey(row, col)}"]`)
  if (next) {
    next.focus()
    next.select()
  }
}

interface SudokuGridProps {
  grid: Grid
  givens: Set<CellKey>
  conflictedCells: Set<CellKey>
  readOnly: boolean
  onChange: (row: number, col: number, value: number) => void
}

export default function SudokuGrid({
  grid,
  givens,
  conflictedCells,
  readOnly,
  onChange,
}: SudokuGridProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, row: number, col: number): void {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [row - 1, col],
      ArrowDown: [row + 1, col],
      ArrowLeft: [row, col - 1],
      ArrowRight: [row, col + 1],
    }
    const move = moves[event.key]
    if (move) {
      const [r, c] = move
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
        event.preventDefault()
        focusCell(r, c)
      }
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      onChange(row, col, EMPTY)
    }
  }

  // Typing replaces the cell rather than appending, so 5 then 7 leaves a 7.
  function handleChange(event: ChangeEvent<HTMLInputElement>, row: number, col: number): void {
    const typed = event.target.value.replace(/[^1-9]/g, '').slice(-1)
    onChange(row, col, typed === '' ? EMPTY : Number(typed))
  }

  return (
    <div className="grid" role="grid" aria-label="Sudoku board">
      {grid.map((cells, row) =>
        cells.map((value, col) => {
          const key = cellKey(row, col)
          return (
            <input
              key={key}
              data-cell={key}
              className={cellClassName({
                row,
                col,
                isGiven: givens.has(key),
                isSolved: !givens.has(key) && value !== EMPTY,
                isConflicted: conflictedCells.has(key),
              })}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              readOnly={readOnly}
              aria-label={`row ${row + 1} column ${col + 1}`}
              value={value === EMPTY ? '' : String(value)}
              onChange={(event) => handleChange(event, row, col)}
              onKeyDown={(event) => handleKeyDown(event, row, col)}
              onFocus={(event) => event.target.select()}
            />
          )
        }),
      )}
    </div>
  )
}
