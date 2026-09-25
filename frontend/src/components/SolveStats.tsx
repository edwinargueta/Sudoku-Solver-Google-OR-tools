/** The CP-SAT search statistics behind the last solve; absent until there is one. */

import type { SolveResponse } from '../api/types'

interface SolveStatsProps {
  stats: SolveResponse | null
}

export default function SolveStats({ stats }: SolveStatsProps) {
  if (!stats) return null

  return (
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
  )
}
