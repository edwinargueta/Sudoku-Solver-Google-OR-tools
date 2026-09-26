import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useCoarsePointer } from './useCoarsePointer'

/** A MediaQueryList whose answer the test can change, the way rotating or
 *  docking a device would. */
function stubPointer(coarse: boolean) {
  const listeners = new Set<() => void>()
  const list = {
    get matches() {
      return coarse
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  const matchMedia = vi.fn(() => list)
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    matchMedia,
    listeners,
    change(next: boolean) {
      coarse = next
      listeners.forEach((listener) => listener())
    },
  }
}

describe('useCoarsePointer', () => {
  it('asks about the primary pointer', () => {
    const { matchMedia } = stubPointer(true)
    renderHook(() => useCoarsePointer())
    expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)')
  })

  it('is true for a finger', () => {
    stubPointer(true)
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(true)
  })

  it('is false for a mouse', () => {
    stubPointer(false)
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
  })

  it('is false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
  })

  it('follows the device when the answer changes', () => {
    const pointer = stubPointer(false)
    const { result } = renderHook(() => useCoarsePointer())
    act(() => pointer.change(true))
    expect(result.current).toBe(true)
  })

  it('stops listening once unmounted', () => {
    const pointer = stubPointer(true)
    const { unmount } = renderHook(() => useCoarsePointer())
    expect(pointer.listeners.size).toBe(1)
    unmount()
    expect(pointer.listeners.size).toBe(0)
  })
})
