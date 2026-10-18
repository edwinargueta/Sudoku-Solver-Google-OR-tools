import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getRandomPuzzle, listLevels, solvePuzzle, validateGrid } from '../api/client'
import type { Conflict, Level, Puzzle, SolveResponse, ValidateResponse } from '../api/types'
import { useSudoku } from './useSudoku'

vi.mock('../api/client')

const LEVELS: Level[] = [
  { key: 'easy', label: 'Easy', description: 'naked singles', count: 10 },
  { key: 'evil', label: 'Evil', description: 'backtracking', count: 10 },
]

/** A puzzle with a single given, which is enough to tell grids apart. */
function puzzleWith(value: number, label = 'Easy #1', key = 'easy-1'): Puzzle {
  const grid = Array.from({ length: 9 }, () => Array<number>(9).fill(0))
  grid[0][0] = value
  return {
    key,
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
    exhaustive: true,
    truncated: false,
    wall_time_ms: 2.5,
    branches: 0,
    conflicts: [],
    ...overrides,
  }
}

/** A response with no solution in it, shaped the way the API sends one. */
function unsolved(
  status: 'INFEASIBLE' | 'UNKNOWN',
  overrides: Partial<SolveResponse> = {},
): SolveResponse {
  return solved({
    status,
    solution: null,
    solutions: [],
    solution_count: 0,
    unique: false,
    // An infeasible search ran to the end; one out of time did not.
    exhaustive: status === 'INFEASIBLE',
    truncated: false,
    ...overrides,
  })
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

/** A promise the test settles by hand, to look at the hook mid-request. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** The player's answer to "throw your moves away?", and a record of being asked. */
function answerConfirm(answer: boolean) {
  return vi.spyOn(window, 'confirm').mockReturnValue(answer)
}

function conflict(row: number, col: number, unit: string, value: number): Conflict {
  return { row, col, unit, value, message: `r${row + 1}c${col + 1}=${value} repeats in its ${unit}` }
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
    expect(result.current.levelsFailed).toBe(true)
    expect(result.current.levelsLoading).toBe(false)
  })
})

describe('when the levels fail to load', () => {
  async function mountFailing() {
    vi.mocked(listLevels).mockRejectedValueOnce(new Error('Request failed (HTTP 503).'))
    const view = renderHook(() => useSudoku())
    await waitFor(() => expect(view.result.current.levelsFailed).toBe(true))
    return view
  }

  it('can be retried, which takes the error down once the levels arrive', async () => {
    const { result } = await mountFailing()
    act(() => result.current.retryLevels())
    expect(result.current.levelsLoading).toBe(true)
    await waitFor(() => expect(result.current.levels).toEqual(LEVELS))
    expect(result.current.levelsFailed).toBe(false)
    expect(result.current.levelsLoading).toBe(false)
    expect(result.current.status).toMatchObject({
      kind: 'idle',
      message: 'Type a puzzle, or pick a difficulty.',
    })
  })

  // The status line is read out when its id changes, so a second failure
  // has to be a new status, even with the same words.
  it('says so again when a retry fails too, with the new reason', async () => {
    const { result } = await mountFailing()
    const first = result.current.status
    vi.mocked(listLevels).mockRejectedValueOnce(new Error('Cannot reach the solver API.'))
    act(() => result.current.retryLevels())
    await waitFor(() => expect(result.current.levelsLoading).toBe(false))
    expect(listLevels).toHaveBeenCalledTimes(2)
    expect(result.current.status).toMatchObject({
      kind: 'error',
      message: 'Cannot reach the solver API.',
    })
    expect(result.current.status.id).not.toBe(first.id)
    expect(result.current.levelsFailed).toBe(true)
  })

  it('is retried when the network comes back', async () => {
    const { result } = await mountFailing()
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(result.current.levels).toEqual(LEVELS))
    expect(listLevels).toHaveBeenCalledTimes(2)
  })

  it('does not point the player at a picker with nothing in it', async () => {
    const { result } = await mountFailing()
    act(() => result.current.updateCell(0, 0, 4))
    expect(result.current.status.message).toBe(
      'Type a puzzle, or retry loading the difficulty levels.',
    )
  })

  it('does not overwrite the answer to something done in the meantime', async () => {
    const levels = deferred<Level[]>()
    vi.mocked(listLevels).mockReturnValueOnce(levels.promise)
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = renderHook(() => useSudoku())
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    await act(async () => {
      levels.reject(new Error('Request failed (HTTP 503).'))
      await levels.promise.catch(() => {})
    })
    expect(result.current.levelsFailed).toBe(true)
    expect(result.current.status.kind).toBe('ok')
  })

  it('leaves a later message alone when a retry succeeds', async () => {
    const { result } = await mountFailing()
    act(() => result.current.updateCell(0, 0, 3))
    act(() => result.current.undo())
    act(() => result.current.retryLevels())
    await waitFor(() => expect(result.current.levels).toEqual(LEVELS))
    expect(result.current.status.message).toBe('Took back r1c1.')
  })

  describe('after the player has moved on from the first failure', () => {
    async function mountFailingThenCheck() {
      vi.mocked(validateGrid).mockResolvedValue({
        consistent: true,
        complete: false,
        givens: 1,
        conflicts: [],
      })
      const view = await mountFailing()
      act(() => view.result.current.updateCell(0, 0, 3))
      await act(async () => {
        await view.result.current.check()
      })
      expect(view.result.current.status).toMatchObject({
        kind: 'ok',
        message: 'No conflicts · 1 of 81 filled.',
      })
      return view
    }

    // Pressing Retry asks a question, so a failure is its answer, even though
    // what it replaces is not the first failure.
    it('says so when their Retry fails too', async () => {
      const { result } = await mountFailingThenCheck()
      const checked = result.current.status
      vi.mocked(listLevels).mockRejectedValueOnce(new Error('Cannot reach the solver API.'))
      act(() => result.current.retryLevels())
      await waitFor(() => expect(result.current.levelsLoading).toBe(false))
      expect(listLevels).toHaveBeenCalledTimes(2)
      expect(result.current.status).toMatchObject({
        kind: 'error',
        message: 'Cannot reach the solver API.',
      })
      expect(result.current.status.id).not.toBe(checked.id)
    })

    it('does not overwrite what they do while the retry is out', async () => {
      const { result } = await mountFailingThenCheck()
      const retry = deferred<Level[]>()
      vi.mocked(listLevels).mockReturnValueOnce(retry.promise)
      act(() => result.current.retryLevels())
      await act(async () => {
        await result.current.check()
      })
      const later = result.current.status
      await act(async () => {
        retry.reject(new Error('Cannot reach the solver API.'))
        await retry.promise.catch(() => {})
      })
      await waitFor(() => expect(result.current.levelsLoading).toBe(false))
      expect(result.current.levelsFailed).toBe(true)
      expect(result.current.status).toEqual(later)
    })

    // Nobody pressed anything, so there is no question for it to answer.
    it('says nothing when a retry on reconnecting fails', async () => {
      const { result } = await mountFailingThenCheck()
      const checked = result.current.status
      vi.mocked(listLevels).mockRejectedValueOnce(new Error('Cannot reach the solver API.'))
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => expect(result.current.levelsLoading).toBe(false))
      expect(listLevels).toHaveBeenCalledTimes(2)
      expect(result.current.status).toEqual(checked)
    })
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

  // Only the solver put a digit there, so the player's grid already holds 0.
  it('erasing a cell the solver filled throws the solution away, with no move to record', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.displayGrid[4][4]).toBe(1)

    act(() => result.current.updateCell(4, 4, 0))
    expect(result.current.solution).toBeNull()
    expect(result.current.stats).toBeNull()
    expect(result.current.displayGrid[4][4]).toBe(0)
    expect(result.current.status.kind).toBe('idle')
    expect(result.current.canUndo).toBe(false)
  })

  it('typing the digit the solver showed there is a move of the player\'s own', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 1))
    await act(async () => {
      await result.current.solve()
    })
    act(() => result.current.updateCell(4, 4, 1))
    expect(result.current.solution).toBeNull()
    expect(result.current.grid[4][4]).toBe(1)
    expect(result.current.canUndo).toBe(true)
  })

  it('leaves a shown solution alone when a key would change nothing on screen', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 1))
    await act(async () => {
      await result.current.solve()
    })
    act(() => result.current.updateCell(0, 0, 1))
    expect(result.current.solution).not.toBeNull()
  })

  it('lands every edit made before the next render', async () => {
    const { result } = await mount()
    act(() => {
      result.current.updateCell(0, 1, 1)
      result.current.updateCell(0, 2, 2)
    })
    expect(result.current.grid[0].slice(1, 3)).toEqual([1, 2])

    act(() => {
      result.current.undo()
      result.current.undo()
    })
    expect(result.current.grid[0].slice(1, 3)).toEqual([0, 0])
    expect(result.current.canUndo).toBe(false)
  })

  it('takes down the conflicts a check found', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [conflict(0, 0, 'row', 5), conflict(0, 1, 'row', 5)],
    })
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 5))
    act(() => result.current.updateCell(0, 1, 5))
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.conflictedCells.size).toBe(2)

    act(() => result.current.updateCell(0, 1, 6))
    expect(result.current.conflictedCells.size).toBe(0)
  })
})

describe('picking a level', () => {
  it('draws a puzzle and marks its givens', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    expect(getRandomPuzzle).toHaveBeenCalledWith('easy', undefined)
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
    expect(getRandomPuzzle).toHaveBeenLastCalledWith('evil', 'easy-1')
  })

  // The server draws with replacement, so without being told it deals the
  // same puzzle again one time in ten.
  it('asks for any puzzle but the one on the board', async () => {
    const { result } = await mount()
    vi.mocked(getRandomPuzzle).mockResolvedValue(puzzleWith(9, 'Evil #4', 'evil-4'))
    await act(async () => {
      await result.current.loadLevel('evil')
    })
    await act(async () => {
      result.current.shuffle()
    })
    expect(getRandomPuzzle).toHaveBeenLastCalledWith('evil', 'evil-4')
  })

  it('is busy while the draw is out, and says it is a load', async () => {
    const draw = deferred<Puzzle>()
    vi.mocked(getRandomPuzzle).mockReturnValue(draw.promise)
    const { result } = await mount()
    let loading!: Promise<void>
    act(() => {
      loading = result.current.loadLevel('easy')
    })
    expect(result.current).toMatchObject({ busy: true, pending: 'load', level: 'easy' })

    await act(async () => {
      draw.resolve(puzzleWith(5))
      await loading
    })
    expect(result.current).toMatchObject({ busy: false, pending: null })
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
    expect(result.current.status).toMatchObject({ kind: 'error', message: 'unknown level' })
    expect(result.current.busy).toBe(false)
  })

  // The board still holds the old level's puzzle, so the picker must say so.
  it('goes back to the level on the board when a draw fails', async () => {
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    vi.mocked(getRandomPuzzle).mockRejectedValueOnce(new Error('Request failed (HTTP 503).'))
    await act(async () => {
      await result.current.loadLevel('evil')
    })
    expect(result.current.level).toBe('easy')
    expect(result.current.grid[0][0]).toBe(5)
  })

  it('takes down the conflicts of the last board', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [conflict(0, 0, 'row', 5), conflict(0, 1, 'row', 5)],
    })
    const { result } = await mount()
    act(() => result.current.updateCell(0, 1, 5))
    await act(async () => {
      await result.current.check()
    })
    answerConfirm(true)
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    expect(result.current.conflictedCells.size).toBe(0)
  })

  // Left up, the last board's solution is what would be painted over the new deal.
  it('takes down the solution and statistics of the last board', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    await act(async () => {
      await result.current.solve()
    })
    vi.mocked(getRandomPuzzle).mockResolvedValue(puzzleWith(9, 'Easy #2', 'easy-2'))
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    expect(result.current.solution).toBeNull()
    expect(result.current.stats).toBeNull()
    expect(result.current.displayGrid[0][0]).toBe(9)
  })
})

describe('throwing the player\'s moves away', () => {
  async function mountWithAMove() {
    const view = await mount()
    await act(async () => {
      await view.result.current.loadLevel('easy')
    })
    act(() => view.result.current.updateCell(4, 4, 8))
    vi.mocked(getRandomPuzzle).mockClear()
    return view
  }

  it('asks first when a new level is picked, and keeps the game if told no', async () => {
    const confirm = answerConfirm(false)
    const { result } = await mountWithAMove()
    await act(async () => {
      await result.current.loadLevel('evil')
    })
    expect(confirm).toHaveBeenCalledOnce()
    expect(getRandomPuzzle).not.toHaveBeenCalled()
    expect(result.current.level).toBe('easy')
    expect(result.current.grid[4][4]).toBe(8)
    expect(result.current.canUndo).toBe(true)
  })

  it('deals the new level if told yes', async () => {
    answerConfirm(true)
    const { result } = await mountWithAMove()
    await act(async () => {
      await result.current.loadLevel('evil')
    })
    expect(getRandomPuzzle).toHaveBeenCalledWith('evil', undefined)
    expect(result.current.grid[4][4]).toBe(0)
  })

  it('asks before New puzzle, too', async () => {
    const confirm = answerConfirm(false)
    const { result } = await mountWithAMove()
    act(() => result.current.shuffle())
    expect(confirm).toHaveBeenCalledOnce()
    expect(getRandomPuzzle).not.toHaveBeenCalled()
  })

  it('asks before Clear, and keeps the moves if told no', async () => {
    const confirm = answerConfirm(false)
    const { result } = await mountWithAMove()
    act(() => result.current.clear())
    expect(confirm).toHaveBeenCalledOnce()
    expect(result.current.grid[4][4]).toBe(8)
  })

  it('does not ask when there is nothing to lose', async () => {
    const confirm = answerConfirm(false)
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    // A digit typed and erased again leaves the board as it was dealt.
    act(() => result.current.updateCell(4, 4, 8))
    act(() => result.current.updateCell(4, 4, 0))
    await act(async () => {
      await result.current.loadLevel('evil')
    })
    act(() => result.current.clear())
    expect(confirm).not.toHaveBeenCalled()
    expect(getRandomPuzzle).toHaveBeenLastCalledWith('evil', undefined)
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
    vi.mocked(solvePuzzle).mockResolvedValue(
      solved({ unique: false, exhaustive: false, truncated: true, solution_count: 2 }),
    )
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.status.message).toContain('more than one solution')
  })

  // One solution found and the time limit hit before a second was ruled out:
  // neither "unique" nor "more than one" would be true.
  it('does not guess at uniqueness when the search was cut short', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(
      solved({ unique: false, exhaustive: false, truncated: true, solution_count: 1 }),
    )
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.status.message).toMatch(
      /^Solved in [\d.]+ ms · uniqueness not confirmed \(time limit\)$/,
    )
  })

  it('asks for a second solution while the uniqueness check is on', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(solvePuzzle).toHaveBeenLastCalledWith(expect.any(Array), { maxSolutions: 2 })
  })

  it('asks for one, and says nothing about uniqueness, with the check off', async () => {
    // What the API sends for max_solutions=1: it stops at the first solution,
    // so the search never finishes.
    vi.mocked(solvePuzzle).mockResolvedValue(
      solved({ unique: false, exhaustive: false, truncated: true }),
    )
    const { result } = await mount()
    act(() => result.current.setCheckUnique(false))
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(solvePuzzle).toHaveBeenLastCalledWith(expect.any(Array), { maxSolutions: 1 })
    expect(result.current.status.message).toMatch(/^Solved in [\d.]+ ms$/)
  })

  it('is busy while the solve is out, and says it is a solve', async () => {
    const answer = deferred<SolveResponse>()
    vi.mocked(solvePuzzle).mockReturnValue(answer.promise)
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    let solving!: Promise<void>
    act(() => {
      solving = result.current.solve()
    })
    expect(result.current).toMatchObject({ busy: true, pending: 'solve' })

    await act(async () => {
      answer.resolve(solved())
      await solving
    })
    expect(result.current).toMatchObject({ busy: false, pending: null })
  })

  it('reports a solve that fails, and stops being busy', async () => {
    const answer = deferred<SolveResponse>()
    vi.mocked(solvePuzzle).mockReturnValue(answer.promise)
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    let solving!: Promise<void>
    act(() => {
      solving = result.current.solve()
    })
    await act(async () => {
      answer.reject(new Error('The solver is busy. Try again in a moment.'))
      await solving
    })
    expect(result.current).toMatchObject({
      busy: false,
      status: { kind: 'error', message: 'The solver is busy. Try again in a moment.' },
    })
    expect(result.current.solution).toBeNull()
  })

  // Only possible if something edits the board mid-solve, which the UI does
  // not allow; the answer would describe a board that is no longer there.
  it('drops an answer about a board that has changed since', async () => {
    const answer = deferred<SolveResponse>()
    vi.mocked(solvePuzzle).mockReturnValue(answer.promise)
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    let solving!: Promise<void>
    act(() => {
      solving = result.current.solve()
    })
    act(() => result.current.updateCell(1, 1, 4))
    await act(async () => {
      answer.resolve(solved())
      await solving
    })
    expect(result.current.solution).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  it('takes down the conflicts a check found before solving', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [conflict(0, 0, 'row', 5)],
    })
    const answer = deferred<SolveResponse>()
    vi.mocked(solvePuzzle).mockReturnValue(answer.promise)
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 5))
    await act(async () => {
      await result.current.check()
    })
    let solving!: Promise<void>
    act(() => {
      solving = result.current.solve()
    })
    expect(result.current.conflictedCells.size).toBe(0)
    await act(async () => {
      answer.resolve(solved())
      await solving
    })
  })

  it('reports contradictory givens with the first conflict', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(
      unsolved('INFEASIBLE', {
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

  it('names the player\'s own entry in a clash, not the clue it repeats', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(
      unsolved('INFEASIBLE', {
        conflicts: [conflict(0, 0, 'row', 5), conflict(0, 2, 'row', 5)],
      }),
    )
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy') // a 5 at r1c1
    })
    act(() => result.current.updateCell(0, 2, 5))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.status.message).toBe('Contradictory givens: r1c3=5 repeats in its row')
    expect([...result.current.conflictedCells].sort()).toEqual(['0,0', '0,2'])
  })

  it('says there is no solution when there is no clash to name', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(unsolved('INFEASIBLE'))
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 3))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.status).toMatchObject({
      kind: 'error',
      message: 'No solution exists for these givens.',
    })
  })

  it('warns when CP-SAT runs out of time', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(unsolved('UNKNOWN'))
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
    expect(result.current.status).toMatchObject({ kind: 'ok', message: 'Complete and valid.' })
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

  it('checks the player\'s own board', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: true,
      complete: false,
      givens: 1,
      conflicts: [],
    })
    const { result } = await mount()
    act(() => result.current.updateCell(2, 2, 7))
    await act(async () => {
      await result.current.check()
    })
    expect(vi.mocked(validateGrid).mock.lastCall?.[0][2][2]).toBe(7)
  })

  // Every cell of a clash is reported, once per unit it breaks: two cells
  // sharing a row and a box come back as four entries.
  it('counts the cells in conflict, not the entries', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [
        conflict(0, 0, 'row', 5),
        conflict(0, 0, 'box', 5),
        conflict(0, 2, 'row', 5),
        conflict(0, 2, 'box', 5),
      ],
    })
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy') // a 5 at r1c1
    })
    act(() => result.current.updateCell(0, 2, 5))
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.status).toMatchObject({
      kind: 'error',
      message: '2 cells in conflict: r1c3=5 repeats in its row',
    })
    expect([...result.current.conflictedCells].sort()).toEqual(['0,0', '0,2'])
  })

  it('names the first cell when every cell of the clash is the player\'s', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [conflict(0, 0, 'row', 5), conflict(0, 1, 'row', 5)],
    })
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 5))
    act(() => result.current.updateCell(0, 1, 5))
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.status.message).toBe('2 cells in conflict: r1c1=5 repeats in its row')
  })

  // A puzzle dealt with two clues that clash leaves no entry of the
  // player's to point at, but the clash still has to be named.
  it('names the first cell when every cell of the clash is a clue', async () => {
    const clashing = puzzleWith(5)
    clashing.grid[0][1] = 5
    vi.mocked(getRandomPuzzle).mockResolvedValue(clashing)
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [conflict(0, 0, 'row', 5), conflict(0, 1, 'row', 5)],
    })
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    expect(result.current.locked).toEqual(new Set(['0,0', '0,1']))
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.status.message).toBe('2 cells in conflict: r1c1=5 repeats in its row')
  })

  it('says "cell", not "cells", for one', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [conflict(0, 0, 'row', 5)],
    })
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 5))
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.status.message).toBe('1 cell in conflict: r1c1=5 repeats in its row')
  })

  // A screen reader hears a status only when it changes, so the same result
  // twice has to be news the second time.
  it('gives a repeated result a new status', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: true,
      complete: false,
      givens: 1,
      conflicts: [],
    })
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 5))
    await act(async () => {
      await result.current.check()
    })
    const first = result.current.status
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.status.message).toBe(first.message)
    expect(result.current.status.id).not.toBe(first.id)
  })

  it('is busy while the check is out, and reports one that fails', async () => {
    const answer = deferred<ValidateResponse>()
    vi.mocked(validateGrid).mockReturnValue(answer.promise)
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 5))
    let checking!: Promise<void>
    act(() => {
      checking = result.current.check()
    })
    expect(result.current).toMatchObject({ busy: true, pending: 'check' })

    await act(async () => {
      answer.reject(new Error('Request failed (HTTP 500).'))
      await checking
    })
    expect(result.current).toMatchObject({
      busy: false,
      pending: null,
      status: { kind: 'error', message: 'Request failed (HTTP 500).' },
    })
  })

  // As with a solve: marks painted from this answer would sit on cells the
  // player has changed since.
  it('drops a check about a board that has changed since', async () => {
    const answer = deferred<ValidateResponse>()
    vi.mocked(validateGrid).mockReturnValue(answer.promise)
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 5))
    let checking!: Promise<void>
    act(() => {
      checking = result.current.check()
    })
    act(() => result.current.updateCell(0, 0, 6))
    await act(async () => {
      answer.resolve({
        consistent: false,
        complete: false,
        givens: 2,
        conflicts: [conflict(0, 0, 'row', 5)],
      })
      await checking
    })
    expect(result.current.conflictedCells.size).toBe(0)
    expect(result.current.status.kind).toBe('idle')
    expect(result.current.busy).toBe(false)
  })
})

describe('clear', () => {
  it('takes back the moves but leaves the givens on the board', async () => {
    answerConfirm(true)
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
    answerConfirm(true)
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

  it('paints only the dealt clues as clues again, after a solve', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    answerConfirm(true)
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    act(() => result.current.updateCell(4, 4, 8))
    await act(async () => {
      await result.current.solve()
    })
    expect(result.current.givens.has('4,4')).toBe(true)

    act(() => result.current.clear())
    expect([...result.current.givens]).toEqual(['0,0'])
  })

  it('empties a board that was typed from scratch', async () => {
    answerConfirm(true)
    const { result } = await mount()
    act(() => result.current.updateCell(3, 3, 6))
    act(() => result.current.clear())
    expect(result.current.isEmpty).toBe(true)
    expect(result.current.givens.size).toBe(0)
  })

  it('forgets the move history', async () => {
    answerConfirm(true)
    const { result } = await mount()
    act(() => result.current.updateCell(3, 3, 6))
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.clear())
    expect(result.current.canUndo).toBe(false)
  })

  // The clue's half of the clash is marked too, and would stay red with
  // nothing left to clash with.
  it('takes down the conflicts a check found', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [conflict(0, 0, 'row', 5), conflict(0, 2, 'row', 5)],
    })
    answerConfirm(true)
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy') // a 5 at r1c1
    })
    act(() => result.current.updateCell(0, 2, 5))
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.conflictedCells.size).toBe(2)

    act(() => result.current.clear())
    expect(result.current.conflictedCells.size).toBe(0)
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

  // Painted as clues only while the solution they were clues to is shown.
  it('stop painting the player\'s entries as clues once the solution goes', async () => {
    vi.mocked(solvePuzzle).mockResolvedValue(solved())
    const { result } = await mount()
    await act(async () => {
      await result.current.loadLevel('easy')
    })
    act(() => result.current.updateCell(4, 4, 8))
    await act(async () => {
      await result.current.solve()
    })
    act(() => result.current.updateCell(5, 5, 2))
    expect(result.current.givens.has('4,4')).toBe(false)
    expect([...result.current.givens]).toEqual(['0,0'])
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
    answerConfirm(true)
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

  it('takes down the conflicts a check found', async () => {
    vi.mocked(validateGrid).mockResolvedValue({
      consistent: false,
      complete: false,
      givens: 2,
      conflicts: [conflict(0, 0, 'row', 5), conflict(0, 1, 'row', 5)],
    })
    const { result } = await mount()
    act(() => result.current.updateCell(0, 0, 5))
    act(() => result.current.updateCell(0, 1, 5))
    await act(async () => {
      await result.current.check()
    })
    act(() => result.current.undo())
    expect(result.current.conflictedCells.size).toBe(0)
  })
})
