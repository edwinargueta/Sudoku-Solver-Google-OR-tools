import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Grid } from '../api/types'
import type { CellKey } from '../lib/grid'
import SudokuGrid from './SudokuGrid'

function emptyBoard(): Grid {
  return Array.from({ length: 9 }, () => Array<number>(9).fill(0))
}

function renderGrid(overrides: Partial<Parameters<typeof SudokuGrid>[0]> = {}) {
  const onChange = vi.fn()
  const props = {
    grid: emptyBoard(),
    givens: new Set<CellKey>(),
    conflictedCells: new Set<CellKey>(),
    readOnly: false,
    onChange,
    ...overrides,
  }
  render(<SudokuGrid {...props} />)
  return { onChange }
}

/** The input for one cell, found the way the component labels it. */
function cell(row: number, col: number): HTMLInputElement {
  return screen.getByLabelText(`row ${row + 1} column ${col + 1}`) as HTMLInputElement
}

describe('rendering', () => {
  it('draws eighty-one cells', () => {
    renderGrid()
    expect(screen.getAllByRole('textbox')).toHaveLength(81)
  })

  it('shows a digit but leaves an empty cell blank', () => {
    const grid = emptyBoard()
    grid[0][0] = 4
    renderGrid({ grid })
    expect(cell(0, 0).value).toBe('4')
    expect(cell(0, 1).value).toBe('')
  })

  it('marks givens, solved cells and conflicts differently', () => {
    const grid = emptyBoard()
    grid[0][0] = 4 // a given
    grid[0][1] = 7 // filled but not given, so solved
    renderGrid({
      grid,
      givens: new Set<CellKey>(['0,0']),
      conflictedCells: new Set<CellKey>(['0,1']),
    })
    expect(cell(0, 0).className).toContain('cell--given')
    expect(cell(0, 1).className).toContain('cell--solved')
    expect(cell(0, 1).className).toContain('cell--conflict')
  })

  it('draws the box borders on the third and sixth columns', () => {
    renderGrid()
    expect(cell(0, 2).className).toContain('cell--box-right')
    expect(cell(0, 8).className).not.toContain('cell--box-right')
    expect(cell(2, 0).className).toContain('cell--box-bottom')
  })

  it('is read-only while a solve is running', () => {
    renderGrid({ readOnly: true })
    expect(cell(3, 3).readOnly).toBe(true)
  })
})

describe('typing', () => {
  it('reports the digit that was typed', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await user.type(cell(2, 3), '7')
    expect(onChange).toHaveBeenCalledWith(2, 3, 7)
  })

  it('ignores anything that is not 1 to 9', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await user.type(cell(0, 0), 'a')
    expect(onChange).toHaveBeenCalledWith(0, 0, 0)
  })

  it('keeps the last digit rather than appending', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 5
    const { onChange } = renderGrid({ grid })
    await user.type(cell(0, 0), '7')
    expect(onChange).toHaveBeenLastCalledWith(0, 0, 7)
  })

  it('clears the cell on Backspace', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[1][1] = 3
    const { onChange } = renderGrid({ grid })
    cell(1, 1).focus()
    await user.keyboard('{Backspace}')
    expect(onChange).toHaveBeenCalledWith(1, 1, 0)
  })
})

describe('arrow keys', () => {
  it('walk the board', async () => {
    const user = userEvent.setup()
    renderGrid()
    cell(4, 4).focus()

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(cell(4, 5))

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(cell(5, 5))

    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(cell(5, 4))

    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(cell(4, 4))
  })

  it('stop at the edges', async () => {
    const user = userEvent.setup()
    renderGrid()
    cell(0, 0).focus()
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(cell(0, 0))
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(cell(0, 0))
  })
})
