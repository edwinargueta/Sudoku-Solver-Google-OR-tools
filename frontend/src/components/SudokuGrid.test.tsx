import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Grid } from '../api/types'
import type { CellKey } from '../lib/grid'
import { setCell } from '../lib/grid'
import SudokuGrid from './SudokuGrid'

type Props = Parameters<typeof SudokuGrid>[0]

function emptyBoard(): Grid {
  return Array.from({ length: 9 }, () => Array<number>(9).fill(0))
}

function renderGrid(overrides: Partial<Props> = {}) {
  const onChange = vi.fn()
  const onUndo = vi.fn()
  const props = {
    grid: emptyBoard(),
    givens: new Set<CellKey>(),
    locked: new Set<CellKey>(),
    conflictedCells: new Set<CellKey>(),
    readOnly: false,
    onChange,
    onUndo,
    ...overrides,
  }
  render(<SudokuGrid {...props} />)
  return { onChange, onUndo }
}

/**
 * A board that keeps what is typed into it, as the app's does. With a bare
 * mock the input snaps back after every key, so a second digit never meets
 * the first.
 */
function Playable({ start }: { start: Grid }) {
  const [grid, setGrid] = useState(start)
  return (
    <SudokuGrid
      grid={grid}
      givens={new Set<CellKey>()}
      locked={new Set<CellKey>()}
      conflictedCells={new Set<CellKey>()}
      readOnly={false}
      onChange={(row, col, value) => setGrid((current) => setCell(current, row, col, value))}
      onUndo={() => {}}
    />
  )
}

function renderPlayable(start = emptyBoard()): void {
  render(<Playable start={start} />)
}

/** The input for one cell, found the way the component labels it. */
function cell(row: number, col: number): HTMLInputElement {
  return screen.getByLabelText(`row ${row + 1} column ${col + 1}`) as HTMLInputElement
}

/** Pretend the primary pointer is a finger, which is what brings out the pad. */
function useTouchScreen(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
}

function padKey(name: string): HTMLButtonElement {
  const pad = screen.getByRole('group', { name: 'Number pad' })
  return within(pad).getByRole('button', { name }) as HTMLButtonElement
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

  // Colour alone says nothing to a screen reader, or in forced colours.
  it('tells assistive tech which cells are in conflict', () => {
    const grid = emptyBoard()
    grid[0][0] = 4
    grid[0][1] = 4
    renderGrid({ grid, conflictedCells: new Set<CellKey>(['0,0', '0,1']) })
    expect(cell(0, 0).getAttribute('aria-invalid')).toBe('true')
    expect(cell(0, 1).getAttribute('aria-invalid')).toBe('true')
    expect(cell(0, 2).hasAttribute('aria-invalid')).toBe(false)
  })

  it('draws the box borders on the third and sixth columns', () => {
    renderGrid()
    expect(cell(0, 2).className).toContain('cell--box-right')
    expect(cell(0, 8).className).not.toContain('cell--box-right')
    expect(cell(2, 0).className).toContain('cell--box-bottom')
  })

  it('marks the last column and row, which stop at the frame', () => {
    renderGrid()
    expect(cell(3, 8).className).toContain('cell--last-col')
    expect(cell(3, 7).className).not.toContain('cell--last-col')
    expect(cell(8, 3).className).toContain('cell--last-row')
    expect(cell(7, 3).className).not.toContain('cell--last-row')
  })

  it('is read-only while a solve is running', () => {
    renderGrid({ readOnly: true })
    expect(cell(3, 3).readOnly).toBe(true)
  })
})

describe('as an ARIA grid', () => {
  it('is nine rows of nine cells, each holding its input', () => {
    renderGrid()
    const board = screen.getByRole('grid', { name: 'Sudoku board' })
    const rows = within(board).getAllByRole('row')
    expect(rows).toHaveLength(9)
    rows.forEach((row, r) => {
      const cells = within(row).getAllByRole('gridcell')
      expect(cells).toHaveLength(9)
      cells.forEach((gridcell, c) => {
        // The input keeps its own textbox role, so it is still announced as editable.
        expect(within(gridcell).getByRole('textbox')).toBe(cell(r, c))
      })
    })
  })

  it('is one stop in the Tab order, at the first cell to begin with', () => {
    renderGrid()
    const stops = screen.getAllByRole('textbox').filter((input) => input.tabIndex === 0)
    expect(stops).toEqual([cell(0, 0)])
  })

  it('moves that stop to the cell last chosen, and keeps it there once focus leaves', async () => {
    const user = userEvent.setup()
    render(<button type="button">elsewhere</button>)
    renderGrid()
    await user.click(cell(4, 4))
    await user.keyboard('{ArrowRight}')
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    const stops = screen.getAllByRole('textbox').filter((input) => input.tabIndex === 0)
    expect(stops).toEqual([cell(4, 5)])
  })

  it('is left by a single Tab, and returned to by a single Shift+Tab', async () => {
    const user = userEvent.setup()
    renderGrid()
    render(<button type="button">after</button>)
    await user.click(cell(2, 2))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(cell(2, 2))
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
    await user.type(cell(0, 0), 'a0')
    expect(onChange).not.toHaveBeenCalled()
    expect(cell(0, 0).value).toBe('')
  })

  it('keeps the digit when a letter is typed over it', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 5
    const { onChange } = renderGrid({ grid })
    await user.type(cell(0, 0), 'a')
    expect(onChange).not.toHaveBeenCalled()
    expect(cell(0, 0).value).toBe('5')
  })

  // Safari's mouse-up can undo the selection made on focus and leave the caret
  // in front of the digit, so the new digit arrives first: 7 typed before a 5.
  it('replaces the digit when the caret sits in front of it', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 5
    const { onChange } = renderGrid({ grid })
    act(() => cell(0, 0).focus())
    cell(0, 0).setSelectionRange(0, 0)
    await user.keyboard('7')
    expect(onChange).toHaveBeenLastCalledWith(0, 0, 7)
  })

  it('keeps the last digit rather than appending', async () => {
    const user = userEvent.setup()
    renderPlayable()
    await user.click(cell(0, 0))
    await user.keyboard('4')
    expect(cell(0, 0).value).toBe('4')
    await user.keyboard('7')
    expect(cell(0, 0).value).toBe('7')
  })

  // What a click that leaves the caret after the digit, rather than selecting
  // it, hands the input: the old digit with the new one appended.
  it('replaces the digit when the caret sits after it', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 5
    renderPlayable(grid)
    act(() => cell(0, 0).focus())
    cell(0, 0).setSelectionRange(1, 1)
    await user.keyboard('7')
    expect(cell(0, 0).value).toBe('7')
  })

  // With the caret beside the digit rather than over it, retyping the digit
  // arrives as a second copy of it. The cell shows it already, so there is
  // nothing to report, as from the pad: reporting it would take down a
  // solution shown there.
  it('ignores the digit the cell already shows, on either side of the caret', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][2] = 4
    const { onChange } = renderGrid({ grid })
    act(() => cell(0, 2).focus())
    for (const caret of [0, 1]) {
      cell(0, 2).setSelectionRange(caret, caret)
      await user.keyboard('4')
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(cell(0, 2).value).toBe('4')
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

  // A cell emptied mid-solve would have the answer land over it.
  it('leaves the cell alone on Backspace or Delete while a solve is running', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[1][1] = 3
    const { onChange } = renderGrid({ grid, readOnly: true })
    cell(1, 1).focus()
    await user.keyboard('{Backspace}{Delete}')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('undo', () => {
  it('is the game\'s Undo on Ctrl+Z or Cmd+Z, not the browser\'s', () => {
    const { onUndo, onChange } = renderGrid()
    act(() => cell(0, 0).focus())
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.keyDown(cell(0, 0), { key: 'z', ctrlKey: true })).toBe(false)
    expect(fireEvent.keyDown(cell(0, 0), { key: 'z', metaKey: true })).toBe(false)
    expect(onUndo).toHaveBeenCalledTimes(2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('swallows redo, which the game does not have', () => {
    const { onUndo } = renderGrid()
    act(() => cell(0, 0).focus())
    expect(fireEvent.keyDown(cell(0, 0), { key: 'Z', metaKey: true, shiftKey: true })).toBe(false)
    expect(fireEvent.keyDown(cell(0, 0), { key: 'y', ctrlKey: true })).toBe(false)
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does nothing while a solve is running', () => {
    const { onUndo } = renderGrid({ readOnly: true })
    act(() => cell(0, 0).focus())
    fireEvent.keyDown(cell(0, 0), { key: 'z', ctrlKey: true })
    expect(onUndo).not.toHaveBeenCalled()
  })

  // Undo from the Edit menu arrives as an input event, with no key to catch.
  it('ignores the browser\'s own undo when it arrives some other way', () => {
    const grid = emptyBoard()
    grid[0][0] = 4
    const { onChange } = renderGrid({ grid })
    fireEvent.input(cell(0, 0), { target: { value: '' }, inputType: 'historyUndo' })
    expect(onChange).not.toHaveBeenCalled()
    expect(cell(0, 0).value).toBe('4')
  })
})

describe('the puzzle\'s own clues', () => {
  it('are shaded so they read as part of the puzzle', () => {
    const grid = emptyBoard()
    grid[0][0] = 4
    renderGrid({ grid, locked: new Set<CellKey>(['0,0']) })
    expect(cell(0, 0).className).toContain('cell--locked')
    expect(cell(0, 1).className).not.toContain('cell--locked')
  })

  it('keep that shading after a solve rewrites the styling set', () => {
    const grid = emptyBoard()
    grid[0][0] = 4
    grid[1][1] = 7
    // `givens` grows to cover what was typed; `locked` does not.
    renderGrid({
      grid,
      givens: new Set<CellKey>(['0,0', '1,1']),
      locked: new Set<CellKey>(['0,0']),
    })
    expect(cell(0, 0).className).toContain('cell--locked')
    expect(cell(1, 1).className).toContain('cell--given')
    expect(cell(1, 1).className).not.toContain('cell--locked')
  })

  it('cannot be typed over', () => {
    const grid = emptyBoard()
    grid[0][0] = 4
    renderGrid({ grid, locked: new Set<CellKey>(['0,0']) })
    expect(cell(0, 0).readOnly).toBe(true)
    expect(cell(0, 1).readOnly).toBe(false)
  })

  it('ignores a digit typed at them', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 4
    const { onChange } = renderGrid({ grid, locked: new Set<CellKey>(['0,0']) })
    await user.type(cell(0, 0), '9')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('cannot be emptied with Backspace either', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 4
    const { onChange } = renderGrid({ grid, locked: new Set<CellKey>(['0,0']) })
    cell(0, 0).focus()
    await user.keyboard('{Backspace}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('can still be moved through with the arrow keys', async () => {
    const user = userEvent.setup()
    renderGrid({ locked: new Set<CellKey>(['0,0']) })
    cell(0, 0).focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(cell(0, 1))
  })

  it('leaves every other cell editable', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGrid({ locked: new Set<CellKey>(['0,0']) })
    await user.type(cell(4, 4), '6')
    expect(onChange).toHaveBeenCalledWith(4, 4, 6)
  })
})

describe('the constraint highlight', () => {
  it('shades the row, the column and the box of the selected cell', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(4, 4))

    expect(cell(4, 0).className).toContain('cell--peer') // same row
    expect(cell(0, 4).className).toContain('cell--peer') // same column
    expect(cell(3, 3).className).toContain('cell--peer') // same box
    expect(cell(5, 5).className).toContain('cell--peer')
  })

  it('marks the selected cell itself as selected, not as a peer', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(4, 4))
    expect(cell(4, 4).className).toContain('cell--selected')
    expect(cell(4, 4).className).not.toContain('cell--peer')
  })

  it('leaves cells that constrain nothing alone', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(4, 4))
    expect(cell(0, 0).className).not.toContain('cell--peer')
    expect(cell(8, 0).className).not.toContain('cell--peer')
    expect(cell(2, 7).className).not.toContain('cell--peer')
  })

  it('shades nothing before a cell is chosen', () => {
    renderGrid()
    expect(document.querySelectorAll('.cell--peer')).toHaveLength(0)
    expect(document.querySelectorAll('.cell--selected')).toHaveLength(0)
  })

  it('shades exactly the twenty cells a digit could clash with', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(4, 4))
    // 8 along the row + 8 down the column + 4 left over in the box.
    expect(document.querySelectorAll('.cell--peer')).toHaveLength(20)
  })

  it('follows the caret from one cell to the next', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(0, 0))
    expect(cell(0, 8).className).toContain('cell--peer')

    await user.keyboard('{ArrowDown}')
    expect(cell(1, 0).className).toContain('cell--selected')
    expect(cell(0, 8).className).not.toContain('cell--peer')
  })

  it('shades a locked clue like any other cell', async () => {
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[4][0] = 7
    renderGrid({ grid, locked: new Set<CellKey>(['4,0']) })
    await user.click(cell(4, 4))
    expect(cell(4, 0).className).toContain('cell--peer')
  })

  it('clears when focus leaves the board', async () => {
    const user = userEvent.setup()
    render(<button type="button">elsewhere</button>)
    renderGrid()
    await user.click(cell(4, 4))
    expect(document.querySelectorAll('.cell--peer')).toHaveLength(20)

    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(document.querySelectorAll('.cell--peer')).toHaveLength(0)
  })

  it('still selects the text so typing replaces the digit', () => {
    const grid = emptyBoard()
    grid[0][0] = 5
    renderGrid({ grid })
    cell(0, 0).focus()
    expect(cell(0, 0).selectionStart).toBe(0)
    expect(cell(0, 0).selectionEnd).toBe(1)
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

describe('with a mouse and keyboard', () => {
  it('asks for the numeric keyboard and draws no pad', () => {
    renderGrid()
    expect(cell(0, 0).inputMode).toBe('numeric')
    expect(screen.queryByRole('group', { name: 'Number pad' })).toBeNull()
  })

  // A touch laptop reports a fine pointer; its taps must still reach the cell,
  // or tapping the focused cell could not bring the on-screen keyboard back.
  it('leaves taps and clicks on a cell alone', () => {
    renderGrid()
    act(() => cell(4, 4).focus())
    // fireEvent returns true when nothing called preventDefault.
    expect(fireEvent.touchEnd(cell(4, 4))).toBe(true)
    expect(fireEvent.mouseDown(cell(4, 4))).toBe(true)
  })

  it('leaves digits to the browser, whose input event carries them', () => {
    renderGrid()
    act(() => cell(0, 0).focus())
    expect(fireEvent.keyDown(cell(0, 0), { key: '7' })).toBe(true)
  })
})

describe('on a touch screen', () => {
  it('asks for no keyboard at all, so nothing slides up over the board', () => {
    useTouchScreen()
    renderGrid()
    for (const input of screen.getAllByRole('textbox')) {
      expect((input as HTMLInputElement).inputMode).toBe('none')
    }
  })

  it('draws the number pad instead', () => {
    useTouchScreen()
    renderGrid()
    expect(screen.getByRole('group', { name: 'Number pad' })).toBeDefined()
  })

  it('keeps the pad switched off until a cell is chosen', () => {
    useTouchScreen()
    renderGrid()
    expect(padKey('5').getAttribute('aria-disabled')).toBe('true')
  })

  // An iPhone otherwise scrolls a focused field to mid-screen, pushing the top
  // rows or the pad out of view.
  it('focuses a tapped cell without scrolling the page', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    renderGrid()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.mouseDown(cell(8, 8))).toBe(false)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })

    await user.click(cell(0, 0))
    expect(document.activeElement).toBe(cell(0, 0))
    expect(cell(0, 0).className).toContain('cell--selected')
  })

  it('moves with the arrow keys without scrolling the page either', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    renderGrid()
    act(() => cell(4, 4).focus())
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(cell(5, 4))
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('writes the pressed digit into the chosen cell', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await user.click(cell(2, 3))
    await user.click(padKey('7'))
    expect(onChange).toHaveBeenCalledWith(2, 3, 7)
  })

  it('reads out what the key did, for a screen reader left on the key', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    renderPlayable()
    await user.click(cell(2, 3))
    await user.click(padKey('7'))
    expect(screen.getByText('Row 3 column 4 set to 7')).toBeDefined()
    await user.click(padKey('Erase'))
    expect(screen.getByText('Row 3 column 4 cleared')).toBeDefined()
  })

  it('does not claim to have cleared a cell that was empty already', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await user.click(cell(2, 3))
    await user.click(padKey('Erase'))
    expect(screen.getByText('Row 3 column 4 already empty')).toBeDefined()
    expect(onChange).not.toHaveBeenCalled()
  })

  // As retyping it from a keyboard does nothing. Reporting it would take
  // down a solution shown there, over a digit the board already had.
  it('leaves a cell alone when the key is the digit it already shows', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][2] = 4
    const { onChange } = renderGrid({ grid })
    await user.click(cell(0, 2))
    await user.click(padKey('4'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Row 1 column 3 already 4')).toBeDefined()
    await user.click(padKey('5'))
    expect(onChange).toHaveBeenCalledWith(0, 2, 5)
  })

  it('empties the chosen cell with erase', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[1][1] = 3
    const { onChange } = renderGrid({ grid })
    await user.click(cell(1, 1))
    await user.click(padKey('Erase'))
    expect(onChange).toHaveBeenCalledWith(1, 1, 0)
  })

  it('leaves the cell chosen after a key, so the shading stays put', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(4, 4))
    await user.click(padKey('2'))
    expect(document.activeElement).toBe(cell(4, 4))
    expect(cell(4, 4).className).toContain('cell--selected')
    expect(document.querySelectorAll('.cell--peer')).toHaveLength(20)
  })

  // A screen reader, or a keyboard on a tablet, can land on a key.
  it('keeps the selection while a key itself has focus', () => {
    useTouchScreen()
    renderGrid()
    act(() => cell(4, 4).focus())
    act(() => padKey('2').focus())
    expect(document.activeElement).toBe(padKey('2'))
    expect(cell(4, 4).className).toContain('cell--selected')
  })

  it('drops the selection once focus leaves the pad as well', () => {
    useTouchScreen()
    render(<button type="button">elsewhere</button>)
    renderGrid()
    act(() => cell(4, 4).focus())
    act(() => padKey('2').focus())
    act(() => screen.getByRole('button', { name: 'elsewhere' }).focus())
    expect(document.querySelectorAll('.cell--selected')).toHaveLength(0)
  })

  it('will not write over one of the puzzle\'s clues', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 4
    const { onChange } = renderGrid({ grid, locked: new Set<CellKey>(['0,0']) })
    await user.click(cell(0, 0))
    expect(padKey('9').getAttribute('aria-disabled')).toBe('true')
    await user.click(padKey('9'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a chosen clue shaded when a switched-off key is tapped', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 4
    renderGrid({ grid, locked: new Set<CellKey>(['0,0']) })
    await user.click(cell(0, 0))
    await user.click(padKey('9'))
    expect(document.activeElement).toBe(cell(0, 0))
    expect(cell(0, 0).className).toContain('cell--selected')
  })

  it('switches off while a solve is running', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const { onChange } = renderGrid({ readOnly: true })
    await user.click(cell(3, 3))
    expect(padKey('1').getAttribute('aria-disabled')).toBe('true')
    await user.click(padKey('1'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not select the digit on focus, which on iOS raises a menu over the board', () => {
    useTouchScreen()
    const grid = emptyBoard()
    grid[0][0] = 5
    renderGrid({ grid })
    cell(0, 0).focus()
    expect(cell(0, 0).selectionEnd! - cell(0, 0).selectionStart!).toBe(0)
  })

  it('swallows a second tap on the chosen cell, which iOS would answer with its edit menu', () => {
    useTouchScreen()
    renderGrid()
    act(() => cell(4, 4).focus())
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.touchEnd(cell(4, 4))).toBe(false)
  })

  it('lets a tap on any other cell through, so it can take the selection', () => {
    useTouchScreen()
    renderGrid()
    act(() => cell(4, 4).focus())
    expect(fireEvent.touchEnd(cell(0, 0))).toBe(true)
  })

  it('still takes digits from a hardware keyboard, for a tablet with one attached', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await user.type(cell(6, 6), '8')
    expect(onChange).toHaveBeenCalledWith(6, 6, 8)
  })

  // Nothing is selected on focus here, so the caret is wherever the tap left it.
  it('replaces the digit from a hardware keyboard with the caret after it', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 5
    renderPlayable(grid)
    await user.click(cell(0, 0))
    cell(0, 0).setSelectionRange(1, 1)
    await user.keyboard('7')
    expect(cell(0, 0).value).toBe('7')
  })

  // Nothing is selected on focus here, so the caret can sit in front of a digit.
  it('replaces the digit even when the caret sits in front of it', async () => {
    useTouchScreen()
    const user = userEvent.setup()
    const grid = emptyBoard()
    grid[0][0] = 5
    const { onChange } = renderGrid({ grid })
    act(() => cell(0, 0).focus())
    cell(0, 0).setSelectionRange(0, 0)
    await user.keyboard('7')
    expect(onChange).toHaveBeenLastCalledWith(0, 0, 7)
  })
})
