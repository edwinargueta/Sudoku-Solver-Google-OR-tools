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

export default function StatusLine({ status }: StatusLineProps) {
  return (
    <p className={`status__message status__message--${status.kind}`} role="status">
      {status.message}
    </p>
  )
}
