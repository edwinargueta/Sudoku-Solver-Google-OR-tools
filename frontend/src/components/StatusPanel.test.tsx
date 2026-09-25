import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SolveResponse } from '../api/types'
import StatusPanel from './StatusPanel'

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

describe('the status line', () => {
  it('shows the message and carries its kind into the class', () => {
    render(<StatusPanel status={{ kind: 'error', message: 'No solution exists.' }} stats={null} />)
    const message = screen.getByRole('status')
    expect(message.textContent).toBe('No solution exists.')
    expect(message.className).toContain('status__message--error')
  })
})

describe('the search statistics', () => {
  it('stay hidden until there has been a solve', () => {
    render(<StatusPanel status={{ kind: 'idle', message: 'Type a puzzle.' }} stats={null} />)
    expect(screen.queryByText('Wall time')).toBeNull()
  })

  it('round the wall time and group the branch count', () => {
    render(<StatusPanel status={{ kind: 'ok', message: 'Solved' }} stats={STATS} />)
    expect(screen.getByText('12.3 ms')).toBeDefined()
    expect(screen.getByText('1,234')).toBeDefined()
  })

  it('marks a truncated count with a plus', () => {
    render(
      <StatusPanel
        status={{ kind: 'ok', message: 'Solved' }}
        stats={{ ...STATS, solution_count: 2, truncated: true }}
      />,
    )
    expect(screen.getByText(/^2\+$/)).toBeDefined()
  })
})
