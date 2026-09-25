/** The 9x9 board: one input per cell, with arrow-key navigation. */

import type { ChangeEvent, FocusEvent, KeyboardEvent } from 'react'
import { useState } from 'react'

import type { Grid } from '../api/types'
import type { Cell, CellKey } from '../lib/grid'
import { EMPTY, SIZE, cellKey, isPeer } from '../lib/grid'

interface CellState {
  row: number
  col: number
  isGiven: boolean
  isLocked: boolean
  isSolved: boolean
  isConflicted: boolean
  isSelected: boolean
  isPeerOfSelected: boolean
}

function cellClassName({
  row,
  col,
  isGiven,
  isLocked,
  isSolved,
  isConflicted,
  isSelected,
  isPeerOfSelected,
}: CellState): string {
  return [
    'cell',
    col % 3 === 2 && col !== SIZE - 1 ? 'cell--box-right' : '',
    row % 3 === 2 && row !== SIZE - 1 ? 'cell--box-bottom' : '',
    isGiven ? 'cell--given' : '',
    isLocked ? 'cell--locked' : '',
    isSolved ? 'cell--solved' : '',
    isConflicted ? 'cell--conflict' : '',
    isSelected ? 'cell--selected' : '',
    isPeerOfSelected ? 'cell--peer' : '',
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
  /** Painted as clues. After a solve this is whatever was typed, not the puzzle. */
  givens: Set<CellKey>
  /** The puzzle's own clues: focusable and readable, but not editable. */
  locked: Set<CellKey>
  conflictedCells: Set<CellKey>
  /** True while the solver runs, which freezes the whole board. */
  readOnly: boolean
  onChange: (row: number, col: number, value: number) => void
}

export default function SudokuGrid({
  grid,
  givens,
  locked,
  conflictedCells,
  readOnly,
  onChange,
}: SudokuGridProps) {
  // Which cell has the caret, so its row, column and box can be shaded. Local
  // to the board: nothing outside it cares where the cursor is.
  const [selected, setSelected] = useState<Cell | null>(null)

  function handleFocus(event: FocusEvent<HTMLInputElement>, row: number, col: number): void {
    event.target.select()
    setSelected({ row, col })
  }

  /** Stepping between cells keeps the shading; leaving the board drops it. */
  function handleBlur(event: FocusEvent<HTMLInputElement>): void {
    const next = event.relatedTarget as HTMLElement | null
    if (!next?.hasAttribute('data-cell')) setSelected(null)
  }

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
    // Arrow keys work anywhere; emptying a cell is an edit, so it obeys the
    // same locks that typing does.
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      if (readOnly || locked.has(cellKey(row, col))) return
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
                isLocked: locked.has(key),
                isSolved: !givens.has(key) && value !== EMPTY,
                isConflicted: conflictedCells.has(key),
                isSelected: selected?.row === row && selected.col === col,
                isPeerOfSelected: selected ? isPeer(selected, { row, col }) : false,
              })}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              readOnly={readOnly || locked.has(key)}
              aria-label={`row ${row + 1} column ${col + 1}`}
              value={value === EMPTY ? '' : String(value)}
              onChange={(event) => handleChange(event, row, col)}
              onKeyDown={(event) => handleKeyDown(event, row, col)}
              onFocus={(event) => handleFocus(event, row, col)}
              onBlur={handleBlur}
            />
          )
        }),
      )}
    </div>
  )
}
