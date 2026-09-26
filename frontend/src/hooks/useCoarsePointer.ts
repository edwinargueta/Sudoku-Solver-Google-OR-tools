/**
 * Whether the main pointer is a finger rather than a mouse.
 *
 * It is the nearest thing the platform offers to "there is no keyboard here",
 * which is the question the board is really asking: a phone's own keyboard
 * slides up over the bottom rows of the puzzle, so a touch screen gets the
 * number pad instead.
 */

import { useSyncExternalStore } from 'react'

const QUERY = '(pointer: coarse)'

// jsdom has no matchMedia, and there the answer is simply "not a phone".
function queryList(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const list = queryList()
  list?.addEventListener('change', onChange)
  return () => list?.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return queryList()?.matches ?? false
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
