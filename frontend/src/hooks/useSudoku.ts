/**
 * The game's state and API traffic in one hook, so the components stay dumb.
 *
 * The board the user edits is `grid`. A solve does not overwrite it: the result
 * lands in `solution`, and `displayGrid` is the solution while one is shown,
 * otherwise the player's grid. `givens` says which of the displayed cells the
 * puzzle or the player supplied, so solved cells can be styled differently.
 *
 * `dealt` is the board as it arrived from the server, which is what Clear goes
 * back to — the givens are not the player's to erase. Every edit is recorded in
 * `history` so the last one can be taken back.
 *
 * Everything an edit touches lives in one reducer, so each change is worked out
 * from the state as it is, not from whatever grid a callback closed over.
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'

import { getRandomPuzzle, listLevels, solvePuzzle, validateGrid } from '../api/client'
import type { Conflict, Grid, Level, Puzzle, SolveResponse, ValidateResponse } from '../api/types'
import {
  EMPTY,
  cellKey,
  cloneGrid,
  conflictKeys,
  countFilled,
  emptyGrid,
  givenKeys,
  gridsEqual,
  setCell,
} from '../lib/grid'

/** How the status line is coloured, and what it says. */
export type StatusKind = 'idle' | 'ok' | 'warn' | 'error'

export interface Status {
  kind: StatusKind
  message: string
  /** New for every status set, so the same words said twice still count as news. */
  id: number
}

/** Which request is out, if any. Only one ever is: the UI waits for each. */
export type Pending = 'load' | 'solve' | 'check' | null

/** One edit, with what the cell held before, which is all undo needs. */
interface Move {
  row: number
  col: number
  previous: number
}

interface Game {
  grid: Grid
  dealt: Grid
  /** The puzzle on the board, so "New puzzle" can ask for any other. */
  puzzleKey: string | null
  history: Move[]
  solution: Grid | null
  conflicts: Conflict[]
  stats: SolveResponse | null
  status: Status
  /** The status that said the levels failed to load, to take down once they have. */
  levelsErrorId: number | null
  /** The status showing when the player pressed Retry, which the retry's failure may replace. */
  retryFromId: number | null
}

type Action =
  | { type: 'edit'; row: number; col: number; value: number }
  | { type: 'undo' }
  | { type: 'load'; puzzle: Puzzle }
  | { type: 'clear' }
  | { type: 'solving' }
  // The grid each request was sent, so an answer about a board that has
  // changed since is dropped rather than painted over it.
  | { type: 'solved'; grid: Grid; result: SolveResponse; checkUnique: boolean }
  | { type: 'checked'; grid: Grid; result: ValidateResponse }
  | { type: 'failed'; message: string }
  | { type: 'levelsRetrying' }
  | { type: 'levelsFailed'; message: string }
  | { type: 'levelsLoaded' }

const IDLE_MESSAGE = 'Type a puzzle, or pick a difficulty.'
const NO_LEVELS_MESSAGE = 'Type a puzzle, or retry loading the difficulty levels.'

const DISCARD_FOR_DEAL = 'Deal a new puzzle? Your moves on this one will be lost.'
const DISCARD_FOR_CLEAR = 'Clear all your moves? This cannot be undone.'

/** Anything thrown by the client is an Error; anything else gets a fallback. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

function say(state: Game, kind: StatusKind, message: string): Status {
  return { kind, message, id: state.status.id + 1 }
}

/** The idle line, left as it is if it is already showing, so typing does not re-announce it. */
function idle(state: Game): Status {
  const { status } = state
  return status.kind === 'idle' && status.message === IDLE_MESSAGE
    ? status
    : say(state, 'idle', IDLE_MESSAGE)
}

/**
 * The conflict to name in the status line. Both cells of a clash are
 * reported, and when one of them is the player's own entry, that is the one
 * to point at: a clue cannot be changed, so naming it helps nobody.
 */
function conflictToName(conflicts: Conflict[], dealt: Grid): Conflict {
  const clues = givenKeys(dealt)
  return conflicts.find((c) => !clues.has(cellKey(c.row, c.col))) ?? conflicts[0]
}

function uniquenessNote(result: SolveResponse): string {
  if (result.solution_count >= 2) return ' · more than one solution'
  if (result.unique) return ' · unique solution'
  // One solution found, but the search was cut off before it could rule out
  // a second, so "unique" would be a guess.
  return ' · uniqueness not confirmed (time limit)'
}

/** A solution, its statistics and any conflicts all describe the board as it was. */
function afterEdit(state: Game, grid: Grid, history: Move[]): Game {
  return {
    ...state,
    grid,
    history,
    solution: null,
    conflicts: [],
    stats: null,
    status: idle(state),
  }
}

function reduce(state: Game, action: Action): Game {
  switch (action.type) {
    case 'edit': {
      const { row, col, value } = action
      const previous = state.grid[row][col]
      if (previous !== value) {
        return afterEdit(state, setCell(state.grid, row, col, value), [
          ...state.history,
          { row, col, previous },
        ])
      }
      // The player's grid already holds this, but the board may be showing
      // the solver's digit there instead: erasing a solved cell, say. That is
      // still an edit of what is on screen, so the solution goes, but there
      // is no move to record.
      if (state.solution && state.solution[row][col] !== value) {
        return afterEdit(state, state.grid, state.history)
      }
      return state // retyping the same digit is not a move
    }

    case 'undo': {
      // Only the player's moves are recorded, so a given can never be undone away.
      const last = state.history[state.history.length - 1]
      if (!last) return state
      return {
        ...afterEdit(
          state,
          setCell(state.grid, last.row, last.col, last.previous),
          state.history.slice(0, -1),
        ),
        status: say(state, 'idle', `Took back r${last.row + 1}c${last.col + 1}.`),
      }
    }

    case 'load': {
      const { puzzle } = action
      return {
        ...state,
        grid: cloneGrid(puzzle.grid),
        dealt: cloneGrid(puzzle.grid),
        puzzleKey: puzzle.key,
        history: [],
        solution: null,
        conflicts: [],
        stats: null,
        status: say(state, 'idle', `Loaded ${puzzle.label} — ${puzzle.givens} givens.`),
      }
    }

    case 'clear':
      return {
        ...state,
        grid: cloneGrid(state.dealt),
        history: [],
        solution: null,
        conflicts: [],
        stats: null,
        status:
          countFilled(state.dealt) > 0
            ? say(state, 'idle', 'Cleared your moves; the givens are still there.')
            : say(state, 'idle', IDLE_MESSAGE),
      }

    case 'solving':
      return { ...state, conflicts: [] }

    case 'solved': {
      if (action.grid !== state.grid) return state
      const { result } = action
      if (result.status === 'SOLVED') {
        const note = action.checkUnique ? uniquenessNote(result) : ''
        return {
          ...state,
          solution: result.solution,
          stats: result,
          status: say(state, 'ok', `Solved in ${result.wall_time_ms.toFixed(1)} ms${note}`),
        }
      }
      if (result.status === 'INFEASIBLE') {
        return {
          ...state,
          solution: null,
          conflicts: result.conflicts,
          stats: result,
          status: say(
            state,
            'error',
            result.conflicts.length
              ? `Contradictory givens: ${conflictToName(result.conflicts, state.dealt).message}`
              : 'No solution exists for these givens.',
          ),
        }
      }
      return {
        ...state,
        stats: result,
        status: say(state, 'warn', 'CP-SAT hit its time limit without an answer.'),
      }
    }

    case 'checked': {
      if (action.grid !== state.grid) return state
      const { result } = action
      let status: Status
      if (result.complete) {
        status = say(state, 'ok', 'Complete and valid.')
      } else if (result.consistent) {
        status = say(state, 'ok', `No conflicts · ${result.givens} of 81 filled.`)
      } else {
        // Each clash names every cell in it, once per row, column or box it
        // breaks, so the count is of cells rather than of entries.
        const cells = conflictKeys(result.conflicts).size
        const named = conflictToName(result.conflicts, state.dealt)
        status = say(
          state,
          'error',
          `${cells} ${cells === 1 ? 'cell' : 'cells'} in conflict: ${named.message}`,
        )
      }
      return { ...state, conflicts: result.conflicts, status }
    }

    case 'failed':
      return { ...state, status: say(state, 'error', action.message) }

    case 'levelsRetrying':
      return { ...state, retryFromId: state.status.id }

    case 'levelsFailed': {
      // Arriving late, this must not overwrite the answer to something the
      // player has since done. It does replace the last failure it follows,
      // and whatever was showing when the player pressed Retry, so a Retry
      // that fails again is heard, and says why this time.
      const { kind, id } = state.status
      if (kind !== 'idle' && id !== state.levelsErrorId && id !== state.retryFromId) return state
      const status = say(state, 'error', action.message)
      return { ...state, status, levelsErrorId: status.id, retryFromId: null }
    }

    case 'levelsLoaded':
      // A retry worked, so an error still saying otherwise is out of date.
      return state.status.id === state.levelsErrorId
        ? {
            ...state,
            status: say(state, 'idle', IDLE_MESSAGE),
            levelsErrorId: null,
            retryFromId: null,
          }
        : { ...state, levelsErrorId: null, retryFromId: null }
  }
}

function newGame(): Game {
  return {
    grid: emptyGrid(),
    dealt: emptyGrid(),
    puzzleKey: null,
    history: [],
    solution: null,
    conflicts: [],
    stats: null,
    status: { kind: 'idle', message: IDLE_MESSAGE, id: 0 },
    levelsErrorId: null,
    retryFromId: null,
  }
}

export function useSudoku() {
  const [game, dispatch] = useReducer(reduce, undefined, newGame)
  const [pending, setPending] = useState<Pending>(null)
  const [levels, setLevels] = useState<Level[]>([])
  const [levelsLoading, setLevelsLoading] = useState(true)
  // Stays set through a retry, until one succeeds, so the picker's Retry
  // button does not vanish from under the player while it runs.
  const [levelsFailed, setLevelsFailed] = useState(false)
  const [levelsAttempt, setLevelsAttempt] = useState(0)
  const [level, setLevel] = useState('')
  const [checkUnique, setCheckUnique] = useState(true)

  const { grid, dealt, history, solution } = game

  useEffect(() => {
    let cancelled = false
    listLevels()
      .then((data) => {
        if (cancelled) return
        setLevels(data)
        setLevelsFailed(false)
        dispatch({ type: 'levelsLoaded' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLevelsFailed(true)
        dispatch({ type: 'levelsFailed', message: messageOf(error) })
      })
      .finally(() => {
        if (!cancelled) setLevelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [levelsAttempt])

  const reloadLevels = useCallback(() => {
    setLevelsLoading(true)
    setLevelsAttempt((attempt) => attempt + 1)
  }, [])

  /**
   * The picker's Retry button. The player asked, so what they were looking at
   * when they pressed it gives way to the answer, even if that is another
   * failure.
   */
  const retryLevels = useCallback(() => {
    dispatch({ type: 'levelsRetrying' })
    reloadLevels()
  }, [reloadLevels])

  // A phone that lost its signal at load time gets the levels without the
  // player having to notice the Retry button. Nobody asked for this one, so
  // if it fails it only replaces the failure already showing, never the
  // answer to something the player has done since.
  useEffect(() => {
    if (!levelsFailed) return
    window.addEventListener('online', reloadLevels)
    return () => window.removeEventListener('online', reloadLevels)
  }, [levelsFailed, reloadLevels])

  const displayGrid = solution ?? grid

  /**
   * Painted as clues: the puzzle's own, or, while a solution is shown, every
   * cell that was filled before the solve. Derived rather than stored, so it
   * cannot outlive the solution it describes.
   */
  const givens = useMemo(() => givenKeys(solution ? grid : dealt), [solution, grid, dealt])

  const conflictedCells = useMemo(() => conflictKeys(game.conflicts), [game.conflicts])

  /**
   * The puzzle's own clues, which the player may not type over.
   *
   * Deliberately not `givens`: while a solution is shown that set covers
   * whatever was typed, so keying the lock off it would freeze the player's
   * own entries instead.
   */
  const locked = useMemo(() => givenKeys(dealt), [dealt])

  /** Editing anywhere invalidates the displayed solution, and counts as a move. */
  const updateCell = useCallback((row: number, col: number, value: number) => {
    dispatch({ type: 'edit', row, col, value })
  }, [])

  /** Put the last edit back. */
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])

  // Moves that would be lost: the board differs from how it was dealt. Typing a
  // digit and erasing it again leaves nothing to lose, so nothing to ask about.
  const hasMoves = useMemo(() => !gridsEqual(grid, dealt), [grid, dealt])

  /** Throwing away the player's moves is theirs to agree to; with none, there is nothing to ask. */
  const mayDiscardMoves = useCallback(
    (question: string) => !hasMoves || window.confirm(question),
    [hasMoves],
  )

  const draw = useCallback(
    async (levelKey: string, exclude?: string) => {
      // Shown as chosen straight away; a failed draw puts the old one back,
      // since the board is still the old level's puzzle.
      const previous = level
      setLevel(levelKey)
      setPending('load')
      try {
        dispatch({ type: 'load', puzzle: await getRandomPuzzle(levelKey, exclude) })
      } catch (error: unknown) {
        setLevel(previous)
        dispatch({ type: 'failed', message: messageOf(error) })
      } finally {
        setPending(null)
      }
    },
    [level],
  )

  /** Pick a difficulty: the server draws one of that level's puzzles at random. */
  const loadLevel = useCallback(
    async (levelKey: string) => {
      if (!mayDiscardMoves(DISCARD_FOR_DEAL)) return
      await draw(levelKey)
    },
    [mayDiscardMoves, draw],
  )

  /** Re-draw from the level already chosen, for a different puzzle at the same level. */
  const shuffle = useCallback(() => {
    if (!level || !mayDiscardMoves(DISCARD_FOR_DEAL)) return
    void draw(level, game.puzzleKey ?? undefined)
  }, [level, mayDiscardMoves, draw, game.puzzleKey])

  /** Take back every move, leaving the puzzle exactly as it was dealt. */
  const clear = useCallback(() => {
    if (mayDiscardMoves(DISCARD_FOR_CLEAR)) dispatch({ type: 'clear' })
  }, [mayDiscardMoves])

  const solve = useCallback(async () => {
    const board = grid
    setPending('solve')
    dispatch({ type: 'solving' })
    try {
      const result = await solvePuzzle(board, { maxSolutions: checkUnique ? 2 : 1 })
      dispatch({ type: 'solved', grid: board, result, checkUnique })
    } catch (error: unknown) {
      dispatch({ type: 'failed', message: messageOf(error) })
    } finally {
      setPending(null)
    }
  }, [grid, checkUnique])

  /**
   * Check the player's own board. BoardActions switches Check Moves off while
   * a solution is shown: CP-SAT's answer has nothing to find, and checking the
   * grid underneath it would report on cells the player cannot see.
   */
  const check = useCallback(async () => {
    const board = grid
    setPending('check')
    try {
      dispatch({ type: 'checked', grid: board, result: await validateGrid(board) })
    } catch (error: unknown) {
      dispatch({ type: 'failed', message: messageOf(error) })
    } finally {
      setPending(null)
    }
  }, [grid])

  const isEmpty = useMemo(
    () => displayGrid.every((row) => row.every((value) => value === EMPTY)),
    [displayGrid],
  )

  // "Pick a difficulty" would point at a picker that has nothing in it.
  const status: Status =
    levelsFailed && game.status.kind === 'idle' && game.status.message === IDLE_MESSAGE
      ? { ...game.status, message: NO_LEVELS_MESSAGE }
      : game.status

  return {
    grid,
    displayGrid,
    givens,
    locked,
    solution,
    conflictedCells,
    status,
    stats: game.stats,
    pending,
    busy: pending !== null,
    levels,
    levelsLoading,
    levelsFailed,
    retryLevels,
    level,
    checkUnique,
    setCheckUnique,
    updateCell,
    undo,
    canUndo: history.length > 0,
    loadLevel,
    shuffle,
    clear,
    solve,
    check,
    isEmpty,
  }
}
