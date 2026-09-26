/**
 * Digits for a touch screen, drawn under the board in place of the phone's own
 * keyboard, which would slide up over the bottom rows of the puzzle.
 *
 * One row, nine digits and an erase key, so the board and the pad fit on
 * screen together even on a small phone.
 */

import type { FocusEvent, MouseEvent } from 'react'

import { EMPTY, SIZE } from '../lib/grid'

const DIGITS = Array.from({ length: SIZE }, (_, index) => index + 1)

interface NumberPadProps {
  /** Nothing to write to: no cell chosen, a clue chosen, or a solve running. */
  disabled: boolean
  /** What the last key did, for a screen reader; nobody else needs telling. */
  announcement: string
  /** A digit from 1 to 9, or EMPTY for the erase key. */
  onPress: (value: number) => void
  onBlur: (event: FocusEvent<HTMLElement>) => void
}

// The cell being filled has to keep focus: it is what the board shades and
// what the next key writes to. Pressing a key would otherwise take it away.
function keepFocus(event: MouseEvent): void {
  event.preventDefault()
}

// Switched off with aria-disabled rather than disabled: a disabled button
// swallows its mouse-down, so keepFocus never runs and the tap blurs the cell.

export default function NumberPad({ disabled, announcement, onPress, onBlur }: NumberPadProps) {
  function press(value: number): void {
    if (!disabled) onPress(value)
  }

  return (
    <div
      className="number-pad"
      role="group"
      aria-label="Number pad"
      data-number-pad
      onMouseDown={keepFocus}
      onBlur={onBlur}
    >
      {DIGITS.map((digit) => (
        <button
          key={digit}
          type="button"
          className="number-pad__key"
          aria-disabled={disabled}
          onClick={() => press(digit)}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        className="number-pad__key number-pad__key--erase"
        aria-label="Erase"
        aria-disabled={disabled}
        onClick={() => press(EMPTY)}
      >
        ⌫
      </button>
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
