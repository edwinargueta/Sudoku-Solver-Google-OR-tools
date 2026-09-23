/** Status line plus the CP-SAT search statistics behind the last solve. */

import type { SolveResponse } from '../api/types'
import type { Status } from '../hooks/useSudoku'

interface StatusPanelProps {
  status: Status
  stats: SolveResponse | null
}

export default function StatusPanel({ status, stats }: StatusPanelProps) {
  return (
    <div className="status">
      <p className={`status__message status__message--${status.kind}`} role="status">
        {status.message}
      </p>

      {stats && (
        <dl className="stats">
          <div className="stats__item">
            <dt>Status</dt>
            <dd>{stats.status}</dd>
          </div>
          <div className="stats__item">
            <dt>Wall time</dt>
            <dd>{stats.wall_time_ms.toFixed(1)} ms</dd>
          </div>
          <div className="stats__item">
            <dt>Branches</dt>
            <dd>{stats.branches.toLocaleString()}</dd>
          </div>
          <div className="stats__item">
            <dt>Solutions</dt>
            <dd>
              {stats.solution_count}
              {stats.truncated ? '+' : ''}
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}
