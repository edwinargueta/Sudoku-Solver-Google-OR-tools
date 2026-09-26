import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
    locked: new Set<CellKey>(),
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

  it('leaves digits to the browser, so its own undo still works', () => {
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
    renderGrid()
    await user.click(cell(2, 3))
    await user.click(padKey('7'))
    expect(screen.getByText('Row 3 column 4 set to 7')).toBeDefined()
    await user.click(padKey('Erase'))
    expect(screen.getByText('Row 3 column 4 cleared')).toBeDefined()
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

  it('leaves a shortcut such as Cmd+1 to the browser', () => {
    useTouchScreen()
    const { onChange } = renderGrid()
    act(() => cell(0, 0).focus())
    // fireEvent returns true when nothing called preventDefault.
    expect(fireEvent.keyDown(cell(0, 0), { key: '1', metaKey: true })).toBe(true)
    expect(fireEvent.keyDown(cell(0, 0), { key: '1', ctrlKey: true })).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
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
