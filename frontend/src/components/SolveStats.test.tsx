import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SolveResponse } from '../api/types'
import SolveStats from './SolveStats'

const STATS: SolveResponse = {
  status: 'SOLVED',
  solution: null,
  solutions: [],
  solution_count: 1,
  unique: true,
  truncated: false,
  wall_time_ms: 12.345,
  branches: 1234,
  conflicts: [],
}

describe('the search statistics', () => {
  it('stay hidden until there has been a solve', () => {
    const { container } = render(<SolveStats stats={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('round the wall time and group the branch count', () => {
    render(<SolveStats stats={STATS} />)
    expect(screen.getByText('12.3 ms')).toBeDefined()
    expect(screen.getByText('1,234')).toBeDefined()
  })

  it('marks a truncated count with a plus', () => {
    render(<SolveStats stats={{ ...STATS, solution_count: 2, truncated: true }} />)
    expect(screen.getByText(/^2\+$/)).toBeDefined()
  })
})
