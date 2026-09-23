/**
 * All board state and API traffic in one hook, so the components stay dumb.
 *
 * The board the user edits is `grid`. A solve does not overwrite it: the result
 * lands in `solution`, and `displayGrid` merges the two so solved cells can be
 * styled differently from what was typed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { getRandomPuzzle, listLevels, solvePuzzle, validateGrid } from '../api/client'
import type { Conflict, Grid, Level, Puzzle, SolveResponse } from '../api/types'
import type { CellKey } from '../lib/grid'
import { EMPTY, cloneGrid, conflictKeys, emptyGrid, givenKeys, setCell } from '../lib/grid'

/** How the status line is coloured, and what it says. */
export type StatusKind = 'idle' | 'ok' | 'warn' | 'error'

export interface Status {
  kind: StatusKind
  message: string
}

const IDLE: Status = { kind: 'idle', message: 'Type a puzzle, or pick a difficulty.' }

/** Anything thrown by the client is an Error; anything else gets a fallback. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export function useSudoku() {
  const [grid, setGrid] = useState<Grid>(emptyGrid)
  const [givens, setGivens] = useState<Set<CellKey>>(() => new Set())
  const [solution, setSolution] = useState<Grid | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [status, setStatus] = useState<Status>(IDLE)
  const [stats, setStats] = useState<SolveResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [levels, setLevels] = useState<Level[]>([])
  const [level, setLevel] = useState('')
  const [checkUnique, setCheckUnique] = useState(true)

  useEffect(() => {
    let cancelled = false
    listLevels()
      .then((data) => {
        if (!cancelled) setLevels(data)
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ kind: 'error', message: messageOf(error) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const displayGrid = solution ?? grid

  const conflictedCells = useMemo(() => conflictKeys(conflicts), [conflicts])

  /** Editing anywhere invalidates the displayed solution. */
  const updateCell = useCallback((row: number, col: number, value: number) => {
    setSolution(null)
    setConflicts([])
    setStats(null)
    setStatus(IDLE)
    setGrid((current) => setCell(current, row, col, value))
  }, [])

  const loadPuzzle = useCallback((puzzle: Puzzle) => {
    setGrid(cloneGrid(puzzle.grid))
    setGivens(givenKeys(puzzle.grid))
    setSolution(null)
    setConflicts([])
    setStats(null)
    setStatus({ kind: 'idle', message: `Loaded ${puzzle.label} — ${puzzle.givens} givens.` })
  }, [])

  /** Pick a difficulty: the server draws one of that level's puzzles at random. */
  const loadLevel = useCallback(
    async (levelKey: string) => {
      setLevel(levelKey)
      setBusy(true)
      try {
        loadPuzzle(await getRandomPuzzle(levelKey))
      } catch (error: unknown) {
        setStatus({ kind: 'error', message: messageOf(error) })
      } finally {
        setBusy(false)
      }
    },
    [loadPuzzle],
  )

  /** Re-draw from the level already chosen, for a different puzzle at the same level. */
  const shuffle = useCallback(() => {
    if (level) void loadLevel(level)
  }, [level, loadLevel])

  const clear = useCallback(() => {
    setGrid(emptyGrid())
    setGivens(new Set())
    setSolution(null)
    setConflicts([])
    setStats(null)
    setStatus(IDLE)
  }, [])

  const solve = useCallback(async () => {
    setBusy(true)
    setConflicts([])
    try {
      const result = await solvePuzzle(grid, { maxSolutions: checkUnique ? 2 : 1 })
      setStats(result)
      if (result.status === 'SOLVED') {
        setSolution(result.solution)
        setGivens(givenKeys(grid))
        const uniqueness = !checkUnique
          ? ''
          : result.unique
            ? ' · unique solution'
            : ' · more than one solution'
        setStatus({
          kind: 'ok',
          message: `Solved in ${result.wall_time_ms.toFixed(1)} ms${uniqueness}`,
        })
      } else if (result.status === 'INFEASIBLE') {
        setSolution(null)
        setConflicts(result.conflicts)
        setStatus({
          kind: 'error',
          message: result.conflicts.length
            ? `Contradictory givens: ${result.conflicts[0].message}`
            : 'No solution exists for these givens.',
        })
      } else {
        setStatus({ kind: 'warn', message: 'CP-SAT hit its time limit without an answer.' })
      }
    } catch (error: unknown) {
      setStatus({ kind: 'error', message: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }, [grid, checkUnique])

  const check = useCallback(async () => {
    setBusy(true)
    try {
      const result = await validateGrid(displayGrid)
      setConflicts(result.conflicts)
      setStats(null)
      if (result.complete) {
        setStatus({ kind: 'ok', message: 'Complete and valid.' })
      } else if (result.consistent) {
        setStatus({ kind: 'ok', message: `No conflicts · ${result.givens} of 81 filled.` })
      } else {
        setStatus({
          kind: 'error',
          message: `${result.conflicts.length} conflict(s): ${result.conflicts[0].message}`,
        })
      }
    } catch (error: unknown) {
      setStatus({ kind: 'error', message: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }, [displayGrid])

  const isEmpty = useMemo(
    () => displayGrid.every((row) => row.every((value) => value === EMPTY)),
    [displayGrid],
  )

  return {
    grid,
    displayGrid,
    givens,
    solution,
    conflictedCells,
    status,
    stats,
    busy,
    levels,
    level,
    checkUnique,
    setCheckUnique,
    updateCell,
    loadLevel,
    shuffle,
    clear,
    solve,
    check,
    isEmpty,
  }
}
