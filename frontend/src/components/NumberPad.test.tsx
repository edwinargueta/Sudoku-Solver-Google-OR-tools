import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import NumberPad from './NumberPad'

function renderPad(overrides: Partial<Parameters<typeof NumberPad>[0]> = {}) {
  const onPress = vi.fn()
  const onBlur = vi.fn()
  render(
    <NumberPad
      disabled={false}
      announcement=""
      onPress={onPress}
      onBlur={onBlur}
      {...overrides}
    />,
  )
  return { onPress, onBlur }
}

function keys(): HTMLButtonElement[] {
  const pad = screen.getByRole('group', { name: 'Number pad' })
  return within(pad).getAllByRole('button') as HTMLButtonElement[]
}

describe('the keys', () => {
  it('are the nine digits in order, then erase', () => {
    renderPad()
    expect(keys().map((key) => key.getAttribute('aria-label') ?? key.textContent)).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Erase',
    ])
  })

  it('report the digit pressed', async () => {
    const user = userEvent.setup()
    const { onPress } = renderPad()
    await user.click(screen.getByRole('button', { name: '7' }))
    expect(onPress).toHaveBeenCalledWith(7)
  })

  it('report an empty cell for erase', async () => {
    const user = userEvent.setup()
    const { onPress } = renderPad()
    await user.click(screen.getByRole('button', { name: 'Erase' }))
    expect(onPress).toHaveBeenCalledWith(0)
  })

  it('all switch off together', async () => {
    const user = userEvent.setup()
    const { onPress } = renderPad({ disabled: true })
    expect(keys().every((key) => key.getAttribute('aria-disabled') === 'true')).toBe(true)
    await user.click(screen.getByRole('button', { name: '3' }))
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('the announcement', () => {
  it('sits in a polite live region, so a screen reader hears what a key did', () => {
    renderPad({ announcement: 'Row 1 column 3 set to 7' })
    const region = screen.getByText('Row 1 column 3 set to 7')
    expect(region.getAttribute('aria-live')).toBe('polite')
  })
})

describe('focus', () => {
  it('is never taken by a key press, so the cell being filled keeps it', () => {
    renderPad()
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: '5' }))).toBe(false)
  })

  // A disabled button swallows the mouse-down, so it would blur the cell.
  it('is not taken by a switched-off key either', () => {
    renderPad({ disabled: true })
    const key = screen.getByRole('button', { name: '5' }) as HTMLButtonElement
    expect(key.disabled).toBe(false)
    expect(fireEvent.mouseDown(key)).toBe(false)
  })
})
