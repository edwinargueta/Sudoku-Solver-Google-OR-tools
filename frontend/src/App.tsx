import { useEffect, useState } from 'react'

import { getHealth } from './api/client'
import type { Health } from './api/types'
import BoardActions from './components/BoardActions'
import LevelPicker from './components/LevelPicker'
import SolveStats from './components/SolveStats'
import SolverOptions from './components/SolverOptions'
import StatusLine from './components/StatusLine'
import SudokuGrid from './components/SudokuGrid'
import { useSudoku } from './hooks/useSudoku'

// The Vite dev server proxies /api only, so there the docs link points at
// uvicorn. A build is served from behind a proxy that passes /docs through.
const DOCS_URL =
  import.meta.env.VITE_API_DOCS_URL ??
  (import.meta.env.DEV ? 'http://127.0.0.1:8000/docs' : '/docs')

/** How often to ask again while the API is down. */
export const HEALTH_RETRY_MS = 15_000

/**
 * Small badge in the header proving the backend is up and which build it runs.
 *
 * It asks again whenever the page comes back into view or the network comes
 * back, and every HEALTH_RETRY_MS while the API is down, so a blip at load
 * time does not leave it saying "API offline" for good.
 */
function BackendBadge() {
  const [health, setHealth] = useState<Health | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    getHealth()
      .then((data) => {
        if (cancelled) return
        setHealth(data)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    function recheck(): void {
      if (document.visibilityState === 'visible') setAttempt((count) => count + 1)
    }
    window.addEventListener('online', recheck)
    document.addEventListener('visibilitychange', recheck)
    const timer = failed ? window.setInterval(recheck, HEALTH_RETRY_MS) : undefined
    return () => {
      window.removeEventListener('online', recheck)
      document.removeEventListener('visibilitychange', recheck)
      window.clearInterval(timer)
    }
  }, [failed])

  if (failed) return <span className="badge badge--down">API offline</span>
  if (!health) return <span className="badge">connecting…</span>
  return <span className="badge badge--up">OR-Tools {health.ortools_version}</span>
}

export default function App() {
  const sudoku = useSudoku()

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1 className="header__title">Sudoku Solver</h1>
          <p className="header__subtitle">
            81 variables, 27 all-different constraints, solved by Google OR-Tools CP-SAT.
          </p>
        </div>
        <BackendBadge />
      </header>

      <main className="layout">
        <section className="panel panel--board" aria-label="Board">
          <LevelPicker
            levels={sudoku.levels}
            level={sudoku.level}
            busy={sudoku.busy}
            failed={sudoku.levelsFailed}
            loading={sudoku.levelsLoading}
            onPickLevel={sudoku.loadLevel}
            onShuffle={sudoku.shuffle}
            onRetry={sudoku.retryLevels}
          />
          <SudokuGrid
            grid={sudoku.displayGrid}
            givens={sudoku.givens}
            locked={sudoku.locked}
            conflictedCells={sudoku.conflictedCells}
            readOnly={sudoku.busy}
            onChange={sudoku.updateCell}
            onUndo={sudoku.undo}
          />
          <BoardActions
            busy={sudoku.busy}
            solving={sudoku.pending === 'solve'}
            isEmpty={sudoku.isEmpty}
            solved={sudoku.solution !== null}
            canUndo={sudoku.canUndo}
            onSolve={sudoku.solve}
            onCheck={sudoku.check}
            onUndo={sudoku.undo}
            onClear={sudoku.clear}
          />
          <StatusLine status={sudoku.status} />
          <p className="hint">Type 1–9, arrow keys to move, Backspace to clear a cell.</p>
        </section>

        <section className="panel" aria-label="Controls">
          <SolverOptions
            busy={sudoku.busy}
            checkUnique={sudoku.checkUnique}
            onToggleUnique={sudoku.setCheckUnique}
          />
          <SolveStats stats={sudoku.stats} />
        </section>
      </main>

      <footer className="footer">
        <a href={DOCS_URL} target="_blank" rel="noreferrer">
          API docs
        </a>
        <span>·</span>
        <a href="https://developers.google.com/optimization/cp/cp_solver" target="_blank" rel="noreferrer">
          CP-SAT reference
        </a>
      </footer>
    </div>
  )
}
