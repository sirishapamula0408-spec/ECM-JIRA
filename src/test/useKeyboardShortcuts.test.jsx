import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useKeyboardShortcuts, isEditableTarget } from '../hooks/useKeyboardShortcuts'

function press(key, target = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  // jsdom's KeyboardEvent ignores a `target` init; dispatch from the node so
  // event.target reflects the intended element.
  target.dispatchEvent(event)
  return event
}

function makeHandlers() {
  return {
    onCreate: vi.fn(),
    onFocusSearch: vi.fn(),
    onNavigate: vi.fn(),
    onShowHelp: vi.fn(),
  }
}

describe('useKeyboardShortcuts', () => {
  afterEach(() => {
    cleanup()
  })

  it('fires onCreate for "c"', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts(handlers))
    press('c')
    expect(handlers.onCreate).toHaveBeenCalledTimes(1)
    expect(handlers.onFocusSearch).not.toHaveBeenCalled()
  })

  it('fires onFocusSearch for "/"', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts(handlers))
    press('/')
    expect(handlers.onFocusSearch).toHaveBeenCalledTimes(1)
  })

  it('fires onShowHelp for "?"', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts(handlers))
    press('?')
    expect(handlers.onShowHelp).toHaveBeenCalledTimes(1)
  })

  it('navigates to /board for "g" then "b"', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts(handlers))
    press('g')
    press('b')
    expect(handlers.onNavigate).toHaveBeenCalledTimes(1)
    expect(handlers.onNavigate).toHaveBeenCalledWith('/board')
  })

  it('navigates to /dashboard for "g" then "d"', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts(handlers))
    press('g')
    press('d')
    expect(handlers.onNavigate).toHaveBeenCalledWith('/dashboard')
  })

  it('does not navigate when the "g" chord is not completed with a known key', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts(handlers))
    press('g')
    press('x')
    expect(handlers.onNavigate).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when typing in an input', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts(handlers))
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('c', input)
    press('/', input)
    press('?', input)
    expect(handlers.onCreate).not.toHaveBeenCalled()
    expect(handlers.onFocusSearch).not.toHaveBeenCalled()
    expect(handlers.onShowHelp).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('ignores shortcuts when a modifier key is held', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts(handlers))
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })
    document.body.dispatchEvent(event)
    expect(handlers.onCreate).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    const handlers = makeHandlers()
    renderHook(() => useKeyboardShortcuts({ ...handlers, enabled: false }))
    press('c')
    expect(handlers.onCreate).not.toHaveBeenCalled()
  })

  it('removes its listener on unmount', () => {
    const handlers = makeHandlers()
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers))
    unmount()
    press('c')
    expect(handlers.onCreate).not.toHaveBeenCalled()
  })

  describe('isEditableTarget', () => {
    it('detects input/textarea/select and contentEditable', () => {
      const input = document.createElement('input')
      const textarea = document.createElement('textarea')
      const select = document.createElement('select')
      const div = document.createElement('div')
      const editableDiv = document.createElement('div')
      Object.defineProperty(editableDiv, 'isContentEditable', { value: true })
      expect(isEditableTarget(input)).toBe(true)
      expect(isEditableTarget(textarea)).toBe(true)
      expect(isEditableTarget(select)).toBe(true)
      expect(isEditableTarget(editableDiv)).toBe(true)
      expect(isEditableTarget(div)).toBe(false)
      expect(isEditableTarget(null)).toBe(false)
    })
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})
