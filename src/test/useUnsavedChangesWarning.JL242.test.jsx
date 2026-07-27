import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'

// Helper: only the 'beforeunload' registrations matter — React/jsdom add
// unrelated listeners of their own, so filter spy calls by event name.
const beforeUnloadCalls = (spy) => spy.mock.calls.filter(([type]) => type === 'beforeunload')

describe('useUnsavedChangesWarning (JL-242)', () => {
  let addSpy
  let removeSpy

  beforeEach(() => {
    addSpy = vi.spyOn(window, 'addEventListener')
    removeSpy = vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not register a beforeunload listener while not dirty', () => {
    renderHook(() => useUnsavedChangesWarning(false))
    expect(beforeUnloadCalls(addSpy)).toHaveLength(0)
  })

  it('registers a beforeunload listener while dirty', () => {
    renderHook(() => useUnsavedChangesWarning(true))
    expect(beforeUnloadCalls(addSpy)).toHaveLength(1)
    expect(beforeUnloadCalls(removeSpy)).toHaveLength(0)
  })

  it('removes the listener when isDirty flips back to false', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesWarning(dirty), {
      initialProps: { dirty: true },
    })
    const [, handler] = beforeUnloadCalls(addSpy)[0]

    rerender({ dirty: false })
    const removed = beforeUnloadCalls(removeSpy)
    expect(removed).toHaveLength(1)
    // The exact same handler reference must be unregistered.
    expect(removed[0][1]).toBe(handler)
    // And no new listener is registered while clean.
    expect(beforeUnloadCalls(addSpy)).toHaveLength(1)
  })

  it('re-registers a listener when isDirty becomes true again', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesWarning(dirty), {
      initialProps: { dirty: false },
    })
    expect(beforeUnloadCalls(addSpy)).toHaveLength(0)

    rerender({ dirty: true })
    expect(beforeUnloadCalls(addSpy)).toHaveLength(1)
  })

  it('removes the listener on unmount while dirty', () => {
    const { unmount } = renderHook(() => useUnsavedChangesWarning(true))
    const [, handler] = beforeUnloadCalls(addSpy)[0]

    unmount()
    const removed = beforeUnloadCalls(removeSpy)
    expect(removed).toHaveLength(1)
    expect(removed[0][1]).toBe(handler)
  })

  it('handler prevents default and sets returnValue for legacy browsers', () => {
    renderHook(() => useUnsavedChangesWarning(true))
    const [, handler] = beforeUnloadCalls(addSpy)[0]

    const event = { preventDefault: vi.fn(), returnValue: undefined }
    handler(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.returnValue).toBe('')
  })

  it('accepts truthy/falsy values (derived dirty expressions)', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesWarning(dirty), {
      initialProps: { dirty: '' }, // falsy — e.g. an unset form field
    })
    expect(beforeUnloadCalls(addSpy)).toHaveLength(0)

    rerender({ dirty: 'edited title' }) // truthy
    expect(beforeUnloadCalls(addSpy)).toHaveLength(1)
  })
})
