/**
 * The four moves you make while playing, kept next to the board they act on.
 *
 * They live here rather than in the Controls panel because on a phone that
 * panel sits below the fold, and these are in-play controls you reach for
 * constantly.
 */

interface BoardActionsProps {
  /** A request is out; the actions wait for it. */
  busy: boolean
  /** The request that is out is a solve, which the Solve button says. */
  solving: boolean
  isEmpty: boolean
  /** CP-SAT's answer is on the board, so there are no moves of the player's to check. */
  solved: boolean
  canUndo: boolean
  onSolve: () => void
  onCheck: () => void
  onUndo: () => void
  onClear: () => void
}

// Busy is shown with aria-disabled rather than disabled. The button just
// pressed is the one that goes busy, and disabling the focused element drops
// focus to the page, so the next Tab starts over from the top. The other
// conditions never change under the button that has focus, bar Undo running
// out of moves, which is aria-disabled for the same reason.

export default function BoardActions({
  busy,
  solving,
  isEmpty,
  solved,
  canUndo,
  onSolve,
  onCheck,
  onUndo,
  onClear,
}: BoardActionsProps) {
  function unlessBusy(action: () => void): () => void {
    return () => {
      if (!busy) action()
    }
  }

  return (
    <div className="board-actions" role="group" aria-label="Board actions">
      <button
        className="button button--primary"
        onClick={unlessBusy(onSolve)}
        disabled={isEmpty}
        aria-disabled={busy}
      >
        {solving ? 'Solving…' : 'Solve'}
      </button>
      <button
        className="button"
        onClick={unlessBusy(onCheck)}
        disabled={isEmpty || solved}
        aria-disabled={busy}
      >
        Check Moves
      </button>
      <button
        className="button"
        onClick={unlessBusy(() => {
          if (canUndo) onUndo()
        })}
        aria-disabled={busy || !canUndo}
      >
        Undo
      </button>
      {/* Clear takes back the player's moves; the givens stay put. */}
      <button className="button button--ghost" onClick={unlessBusy(onClear)} aria-disabled={busy}>
        Clear
      </button>
    </div>
  )
}
