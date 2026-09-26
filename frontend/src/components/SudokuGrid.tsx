/**
 * The 9x9 board: one input per cell, with arrow-key navigation.
 *
 * On a touch screen the cells ask for no keyboard at all, and the number pad
 * under the board does the typing: a phone's own keyboard would cover the
 * bottom of the puzzle while you choose what goes in it.
 */

import type { ChangeEvent, FocusEvent, KeyboardEvent, MouseEvent, TouchEvent } from 'react'
import { useState } from 'react'

import type { Grid } from '../api/types'
import { useCoarsePointer } from '../hooks/useCoarsePointer'
import type { Cell, CellKey } from '../lib/grid'
import { EMPTY, SIZE, cellKey, isPeer } from '../lib/grid'
import NumberPad from './NumberPad'

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

/** On a touch screen the page is left where it is; see handleMouseDown. */
function focusCell(row: number, col: number, touch: boolean): void {
  const next = document.querySelector<HTMLInputElement>(`[data-cell="${cellKey(row, col)}"]`)
  if (next) {
    next.focus({ preventScroll: touch })
    if (!touch) next.select()
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
  // What the last pad key did, read out by a screen reader, which stays on the
  // key and so never hears the cell itself change.
  const [announcement, setAnnouncement] = useState('')
  const touch = useCoarsePointer()

  // The pad writes the whole cell, so there is nothing to select for it, and
  // on iOS a selection brings up handles and a menu over the board.
  function handleFocus(event: FocusEvent<HTMLInputElement>, row: number, col: number): void {
    if (!touch) event.target.select()
    setSelected({ row, col })
  }

  /** Stepping between cells, or onto the pad, keeps the shading; leaving the board drops it. */
  function handleBlur(event: FocusEvent<HTMLElement>): void {
    const next = event.relatedTarget
    if (!next?.closest('[data-cell], [data-number-pad]')) setSelected(null)
  }

  // An iPhone scrolls a focused text field to the middle of the screen, keyboard
  // or not, which can push the top rows or the pad out of view. Focusing the
  // cell ourselves, with preventScroll, is the one way to keep the page still.
  function handleMouseDown(event: MouseEvent<HTMLInputElement>): void {
    if (!touch) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
  }

  // A second tap on the cell that is already chosen has nothing left to do, and
  // iOS answers it with its edit menu (Paste, AutoFill) drawn over the board.
  function handleTouchEnd(event: TouchEvent<HTMLInputElement>): void {
    if (touch && event.currentTarget === document.activeElement) event.preventDefault()
  }

  const selectedKey = selected ? cellKey(selected.row, selected.col) : null
  const canWriteSelected = selectedKey !== null && !readOnly && !locked.has(selectedKey)

  function handlePad(value: number): void {
    if (!selected || !canWriteSelected) return
    onChange(selected.row, selected.col, value)
    const where = `Row ${selected.row + 1} column ${selected.col + 1}`
    setAnnouncement(value === EMPTY ? `${where} cleared` : `${where} set to ${value}`)
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
        focusCell(r, c, touch)
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

  // Typing replaces the cell rather than appending, so 5 then 7 leaves a 7,
  // whichever side of the 5 the caret was on. That cannot be left to the
  // selection made on focus: a touch screen makes none, and Safari's mouse-up
  // can undo it and leave the caret in front of the old digit. Anything that
  // is not 1-9 is ignored, and the cell keeps what it had.
  function handleChange(event: ChangeEvent<HTMLInputElement>, row: number, col: number): void {
    const text = event.target.value
    if (text === '') {
      onChange(row, col, EMPTY)
      return
    }
    const before = grid[row][col] === EMPTY ? '' : String(grid[row][col])
    const typed = text.replace(before, '').replace(/[^1-9]/g, '').slice(-1)
    if (typed !== '') onChange(row, col, Number(typed))
  }

  return (
    <>
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
                inputMode={touch ? 'none' : 'numeric'}
                autoComplete="off"
                maxLength={2}
                readOnly={readOnly || locked.has(key)}
                aria-label={`row ${row + 1} column ${col + 1}`}
                value={value === EMPTY ? '' : String(value)}
                onChange={(event) => handleChange(event, row, col)}
                onKeyDown={(event) => handleKeyDown(event, row, col)}
                onFocus={(event) => handleFocus(event, row, col)}
                onBlur={handleBlur}
                onMouseDown={handleMouseDown}
                onTouchEnd={handleTouchEnd}
              />
            )
          }),
        )}
      </div>
      {touch ? (
        <NumberPad
          disabled={!canWriteSelected}
          announcement={announcement}
          onPress={handlePad}
          onBlur={handleBlur}
        />
      ) : null}
    </>
  )
}
