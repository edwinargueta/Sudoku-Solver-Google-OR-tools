/**
 * What just happened, in one line.
 *
 * It sits under the actions rather than with the statistics because some
 * actions change nothing else on screen — checking a board with no conflicts
 * repaints no cells, so this line is the entire response.
 */

import type { Status } from '../hooks/useSudoku'

interface StatusLineProps {
  status: Status
}

// The message is keyed by its id, so saying the same words again, as a second
// Check Moves on an unchanged board does, still swaps the node and is read
// out. The live region itself stays put: one mounted fresh is announced
// unreliably.

export default function StatusLine({ status }: StatusLineProps) {
  return (
    <p className={`status__message status__message--${status.kind}`} role="status">
      <span key={status.id}>{status.message}</span>
    </p>
  )
}
