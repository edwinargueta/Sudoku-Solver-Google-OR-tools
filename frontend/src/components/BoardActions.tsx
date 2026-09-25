/**
 * The four moves you make while playing, kept next to the board they act on.
 *
 * They live here rather than in the Toolbar because on a phone the Toolbar sits
 * below the fold: the difficulty picker is set-up you touch once per puzzle,
 * these are in-play controls you reach for constantly.
 */

interface BoardActionsProps {
  busy: boolean
  isEmpty: boolean
  canUndo: boolean
  onSolve: () => void
  onCheck: () => void
  onUndo: () => void
  onClear: () => void
}

export default function BoardActions({
  busy,
  isEmpty,
  canUndo,
  onSolve,
  onCheck,
  onUndo,
  onClear,
}: BoardActionsProps) {
  return (
    <div className="board-actions" role="group" aria-label="Board actions">
      <button className="button button--primary" onClick={onSolve} disabled={busy || isEmpty}>
        {busy ? 'Solving…' : 'Solve'}
      </button>
      <button className="button" onClick={onCheck} disabled={busy || isEmpty}>
        Check Moves
      </button>
      <button className="button" onClick={onUndo} disabled={busy || !canUndo}>
        Undo
      </button>
      {/* Clear takes back the player's moves; the givens stay put. */}
      <button className="button button--ghost" onClick={onClear} disabled={busy}>
        Clear
      </button>
    </div>
  )
}
