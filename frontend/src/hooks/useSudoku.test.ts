import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getRandomPuzzle, listLevels, solvePuzzle, validateGrid } from '../api/client'
import type { Level, Puzzle, SolveResponse, ValidateResponse } from '../api/types'
import { useSudoku } from './useSudoku'

vi.mock('../api/client')

const LEVELS: Level[] = [
  { key: 'easy', label: 'Easy', description: 'naked singles', count: 10 },
  { key: 'evil', label: 'Evil', description: 'backtracking', count: 10 },
]

/** A puzzle with a single given, which is enough to tell grids apart. */
function puzzleWith(value: number, label = 'Easy #1'): Puzzle {
  const grid = Array.from({ length: 9 }, () => Array<number>(9).fill(0))
  grid[0][0] = value
  return {
    key: 'easy-1',
    label,
    level: 'easy',
    puzzle: '.'.repeat(81),
    grid,
    givens: 1,
    source: 'test',
  }
}

function solved(overrides: Partial<SolveResponse> = {}): SolveResponse {
  const solution = Array.from({ length: 9 }, () => Array<number>(9).fill(1))
  return {
    status: 'SOLVED',
    solution,
    solutions: [solution],
    solution_count: 1,
    unique: true,
    truncated: false,
    wall_time_ms: 2.5,
    branches: 0,
    conflicts: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(listLevels).mockResolvedValue(LEVELS)
  vi.mocked(getRandomPuzzle).mockResolvedValue(puzzleWith(5))
})

/** Mount the hook and wait for the levels request that fires on mount. */
async function mount() {
  const view = renderHook(() => useSudoku())
  await waitFor(() => expect(view.result.current.levels).toHaveLength(2))
  return view
}

describe('on mount', () => {
  it('loads the difficulty levels', async () => {
    const { result } = await mount()
    expect(result.current.levels).toEqual(LEVELS)
    expect(result.current.level).toBe('')
  })

  it('starts on an empty board with the idle message', async () => {
    const { result } = await mount()
    expect(result.current.isEmpty).toBe(true)
    expect(result.current.status.kind).toBe('idle')
    expect(result.current.stats).toBeNull()
  })

  it('reports a failure to reach the API', async () => {
    vi.mocked(listLevels).mockRejectedValue(new Error('Cannot reach the solver API'))
    const { result } = renderHook(() => useSudoku())
    await waitFor(() => expect(result.current.status.kind).toBe('error'))
    expect(result.current.status.message).toBe('Cannot reach the solver API')
  })
})

describe('editing', () => {
  it('writes the cell and leaves the rest alone', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(4, 4, 7))
    expect(result.current.grid[4][4]).toBe(7)
    expect(result.current.isEmpty).toBe(false)
  })

  it('throws away a displayed solution', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 1))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.solution).not.toBeNull()

    act(() => result.current.updateCell(1, 1, 2))
    expect(result.current.solution).toBeNull()
    expect(result.current.stats).toBeNull()
  })
})

describe('picking a level', () => {
  it('draws a puzzle and marks its givens', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    expect(getRandomPuzzle).toHaveBeenCalledWith('easy')
    expect(result.current.level).toBe('easy')
    expect(result.current.grid[0][0]).toBe(5)
    expect(result.current.givens.has('0,0')).toBe(true)
    expect(result.current.status.message).toContain('Easy #1')
  })

  it('shuffles by drawing from the level again', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('evil')
    })
    vi.mocked(getRandomPuzzle).mockResolvedValue(puzzleWith(9, 'Evil #4'))
    await act(async () => {
      result.current.shuffle()
    })
    await waitFor(() => expect(result.current.grid[0][0]).toBe(9))
    expect(getRandomPuzzle).toHaveBeenLastCalledWith('evil')
  })

  it('does nothing when no level has been chosen', async () => {
    const { result } = await mount()
    act(() => result.current.shuffle())
    expect(getRandomPuzzle).not.toHaveBeenCalled()
  })

  it('surfaces a failed draw', async () => {
    vi.mocked(getRandomPuzzle).mockRejectedValue(new Error('unknown level'))
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('nope')
    })
    expect(result.current.status).toEqual({ kind: 'error', message: 'unknown level' })
    expect(result.current.busy).toBe(false)
  })
})

describe('solving', () => {
  it('shows the solution without overwriting what was typed', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.grid[0][0]).toBe(3)
    expect(result.current.displayGrid[0][0]).toBe(1)
    expect(result.current.status.kind).toBe('ok')
    expect(result.current.status.message).toContain('unique solution')
  })

  it('says so when more than one solution exists', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved({ unique: false, solution_count: 2 }))
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.status.message).toContain('more than one solution')
  })

  it('reports contradictory givens with the first conflict', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(
      solved({
        status: 'INFEASIBLE',
        solution: null,
        conflicts: [
          { row: 0, col: 4, unit: 'row', value: 6, message: 'r1c5=6 repeats in its row' },
        ],
      }),
    )
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.status.kind).toBe('error')
    expect(result.current.status.message).toContain('r1c5=6 repeats in its row')
    expect(result.current.conflictedCells.has('0,4')).toBe(true)
    expect(result.current.solution).toBeNull()
  })

  it('warns when CP-SAT runs out of time', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved({ status: 'UNKNOWN', solution: null }))
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.status.kind).toBe('warn')
  })
})

describe('checking', () => {
  it('calls a complete board complete', async () => {
    const response: ValidateResponse = {
      consistent: true,
      complete: true,
      givens: 81,
      conflicts: [],
    }
    vi.mocked(validateGrid).mockResolvedValue(response)
    const { result } = await mount()
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.status).toEqual({ kind: 'ok', message: 'Complete and valid.' })
  })

  it('counts what is filled in when it is not', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: true,
      complete: false,
      givens: 30,
      conflicts: [],
    })
    const { result } = await mount()
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.status.message).toContain('30 of 81')
  })
})

describe('clear', () => {
  it('takes back the moves but leaves the givens on the board', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    act(() => result.current.updateCell(4, 4, 8))
    expect(result.current.grid[4][4]).toBe(8)

    act(() => result.current.clear())

    expect(result.current.grid[4][4], 'the move is gone').toBe(0)
    expect(result.current.grid[0][0]).toBe(5)
    expect(result.current.givens.has('0,0')).toBe(true)
    expect(result.current.isEmpty).toBe(false)
  })

  it('restores a given the player had typed over', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    act(() => result.current.updateCell(0, 0, 2))
    expect(result.current.grid[0][0]).toBe(2)

    act(() => result.current.clear())
    expect(result.current.grid[0][0]).toBe(5)
  })

  it('drops a displayed solution and the statistics with it', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.solution).not.toBeNull()

    act(() => result.current.clear())
    expect(result.current.solution).toBeNull()
    expect(result.current.stats).toBeNull()
    expect(result.current.status.kind).toBe('idle')
  })

  it('empties a board that was typed from scratch', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(3, 3, 6))
    act(() => result.current.clear())
    expect(result.current.isEmpty).toBe(true)
    expect(result.current.givens.size).toBe(0)
  })

  it('forgets the move history', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(3, 3, 6))
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.clear())
    expect(result.current.canUndo).toBe(false)
  })
})

describe('locked cells', () => {
  it('are the puzzle\'s clues once one is dealt', async () => {
    const { result } = await mount()
    expect(result.current.locked.size).toBe(0)
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    expect(result.current.locked.has('0,0')).toBe(true)
    expect(result.current.locked.has('4,4')).toBe(false)
  })

  it('do not grow as the player fills the board in', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    act(() => result.current.updateCell(4, 4, 8))
    expect(result.current.locked.has('4,4')).toBe(false)
  })

  it('stay put through a solve, which rewrites the styling set', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    act(() => result.current.updateCell(4, 4, 8))
    await act(async () => {
      await result.current.solve()
    })
    // `givens` now describes what was typed; the lock must not follow it.
    expect(result.current.givens.has('4,4')).toBe(true)
    expect(result.current.locked.has('4,4')).toBe(false)
  })

  it('are empty for a board typed from scratch', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 1))
    expect(result.current.locked.size).toBe(0)
  })
})

describe('undo', () => {
  it('is unavailable until something has been typed', async () => {
    const { result } = await mount()
    expect(result.current.canUndo).toBe(false)
  })

  it('takes back the last move', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(2, 2, 4))
    act(() => result.current.undo())
    expect(result.current.grid[2][2]).toBe(0)
    expect(result.current.canUndo).toBe(false)
  })

  it('restores what the cell held before, not just an empty cell', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(2, 2, 4))
    act(() => result.current.updateCell(2, 2, 9))
    act(() => result.current.undo())
    expect(result.current.grid[2][2]).toBe(4)
  })

  it('walks back one move at a time', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(0, 1, 1))
    act(() => result.current.updateCell(0, 2, 2))
    act(() => result.current.updateCell(0, 3, 3))

    act(() => result.current.undo())
    expect(result.current.grid[0][3]).toBe(0)
    expect(result.current.grid[0][2]).toBe(2)

    act(() => result.current.undo())
    act(() => result.current.undo())
    expect(result.current.grid[0][1]).toBe(0)
    expect(result.current.canUndo).toBe(false)
  })

  it('does nothing when there is nothing to take back', async () => {
    const { result } = await mount()
    act(() => result.current.undo())
    expect(result.current.isEmpty).toBe(true)
  })

  it('never undoes a given away', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    expect(result.current.canUndo, 'dealing is not a move').toBe(false)
    act(() => result.current.undo())
    expect(result.current.grid[0][0]).toBe(5)
  })

  it('does not count retyping the same digit as a move', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(5, 5, 7))
    act(() => result.current.updateCell(5, 5, 7))
    act(() => result.current.undo())
    expect(result.current.grid[5][5]).toBe(0)
    expect(result.current.canUndo).toBe(false)
  })

  it('starts fresh when a new puzzle is dealt', async () => {
    const { result } = await mount()
    act(() => result.current.updateCell(1, 1, 3))
    expect(result.current.canUndo).toBe(true)
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    expect(result.current.canUndo).toBe(false)
  })

  it('clears a displayed solution, since the board changed underneath it', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.solution).not.toBeNull()

    act(() => result.current.undo())
    expect(result.current.solution).toBeNull()
    expect(result.current.stats).toBeNull()
  })
})
