import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecentIssues } from '../hooks/useRecentIssues'

// In-memory localStorage mock
function createLocalStorageMock() {
  let store = {}
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, value) => { store[key] = String(value) }),
    removeItem: vi.fn((key) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
}

describe('useRecentIssues (JL-163)', () => {
  let localStorageMock

  beforeEach(() => {
    localStorageMock = createLocalStorageMock()
    vi.stubGlobal('localStorage', localStorageMock)
  })

  it('starts empty when localStorage has no entries', () => {
    const { result } = renderHook(() => useRecentIssues())
    expect(result.current.recentIssues).toEqual([])
  })

  it('adds issues most-recent-first and persists to localStorage', () => {
    const { result } = renderHook(() => useRecentIssues())

    act(() => result.current.addRecent({ id: 1, key: 'ECM-1', title: 'First issue' }))
    act(() => result.current.addRecent({ id: 2, key: 'ECM-2', title: 'Second issue' }))

    expect(result.current.recentIssues).toEqual([
      { id: 2, key: 'ECM-2', title: 'Second issue' },
      { id: 1, key: 'ECM-1', title: 'First issue' },
    ])

    const persisted = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1])
    expect(persisted.map((i) => i.id)).toEqual([2, 1])
    expect(localStorageMock.setItem.mock.calls.at(-1)[0]).toBe('recentIssues')
  })

  it('de-duplicates: re-viewing an issue moves it to the front without duplicating', () => {
    const { result } = renderHook(() => useRecentIssues())

    act(() => result.current.addRecent({ id: 1, key: 'ECM-1', title: 'First' }))
    act(() => result.current.addRecent({ id: 2, key: 'ECM-2', title: 'Second' }))
    act(() => result.current.addRecent({ id: 3, key: 'ECM-3', title: 'Third' }))
    // duplicate view of issue 1
    act(() => result.current.addRecent({ id: 1, key: 'ECM-1', title: 'First' }))

    const ids = result.current.recentIssues.map((i) => i.id)
    expect(ids).toEqual([1, 3, 2])
    expect(ids.filter((id) => id === 1)).toHaveLength(1)
  })

  it('caps the list at 8 entries, dropping the oldest', () => {
    const { result } = renderHook(() => useRecentIssues())

    for (let i = 1; i <= 10; i += 1) {
      act(() => result.current.addRecent({ id: i, key: `ECM-${i}`, title: `Issue ${i}` }))
    }

    expect(result.current.recentIssues).toHaveLength(8)
    expect(result.current.recentIssues.map((i) => i.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3])
  })

  it('hydrates initial state from localStorage', () => {
    localStorageMock.setItem(
      'recentIssues',
      JSON.stringify([{ id: 5, key: 'ECM-5', title: 'Stored issue' }]),
    )

    const { result } = renderHook(() => useRecentIssues())
    expect(result.current.recentIssues).toEqual([{ id: 5, key: 'ECM-5', title: 'Stored issue' }])
  })

  it('ignores corrupt localStorage data', () => {
    localStorageMock.setItem('recentIssues', 'not-json{{{')

    const { result } = renderHook(() => useRecentIssues())
    expect(result.current.recentIssues).toEqual([])
  })

  it('ignores addRecent calls without a valid id', () => {
    const { result } = renderHook(() => useRecentIssues())

    act(() => result.current.addRecent(null))
    act(() => result.current.addRecent({ key: 'ECM-X', title: 'No id' }))

    expect(result.current.recentIssues).toEqual([])
  })

  it('keeps separate hook instances in sync via the update event', () => {
    const first = renderHook(() => useRecentIssues())
    const second = renderHook(() => useRecentIssues())

    act(() => first.result.current.addRecent({ id: 7, key: 'ECM-7', title: 'Shared' }))

    expect(second.result.current.recentIssues.map((i) => i.id)).toEqual([7])
  })
})
