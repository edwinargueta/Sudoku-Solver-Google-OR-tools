/**
 * Choosing what to play, above the board.
 *
 * It sits here rather than in the settings panel because on a phone that panel
 * is below the fold: on first load the board is empty and every action is
 * disabled, so the one control that does anything has to be the one you can
 * see. The row is kept to a single line — the level's description is desktop
 * only — because every pixel above the grid pushes the actions down.
 */

import type { Level } from '../api/types'

interface LevelPickerProps {
  levels: Level[]
  level: string
  /** A request is out; a pick now would race it, so it is ignored. */
  busy: boolean
  /** The list of levels could not be fetched, and has not been since. */
  failed: boolean
  /** The list of levels is on its way, first time or on a retry. */
  loading: boolean
  onPickLevel: (level: string) => void
  onShuffle: () => void
  onRetry: () => void
}

// While busy, the select and the button are marked with aria-disabled and
// ignore input, rather than being disabled: they are what the player just
// used, and disabling the focused control drops focus to the page.

export default function LevelPicker({
  levels,
  level,
  busy,
  failed,
  loading,
  onPickLevel,
  onShuffle,
  onRetry,
}: LevelPickerProps) {
  const chosen = levels.find((entry) => entry.key === level)
  const placeholder = levels.length
    ? 'Choose a difficulty…'
    : failed && !loading
      ? 'Could not load the levels'
      : 'Loading…'

  return (
    <div className="level-picker">
      <div className="field__inline">
        <select
          className="select"
          aria-label="Difficulty"
          value={level}
          disabled={levels.length === 0}
          aria-disabled={busy}
          onChange={(event) => {
            if (!busy) onPickLevel(event.target.value)
          }}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {levels.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
              {entry.count > 1 ? ` · ${entry.count} puzzles` : ''}
            </option>
          ))}
        </select>
        {/* One button, relabelled rather than swapped for another, so a
            successful Retry leaves focus where it was. Re-picking the same
            option fires no change event, so rerolling needs a button. */}
        {failed ? (
          <button
            className="button button--ghost"
            aria-disabled={loading}
            onClick={() => {
              if (!loading) onRetry()
            }}
          >
            Retry
          </button>
        ) : (
          <button
            className="button button--ghost"
            aria-disabled={busy || !level}
            onClick={() => {
              if (!busy && level) onShuffle()
            }}
          >
            New puzzle
          </button>
        )}
      </div>
      {chosen ? <small className="field__hint">{chosen.description}</small> : null}
    </div>
  )
}
