import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePageTitle, APP_NAME } from '../hooks/usePageTitle'

describe('usePageTitle (JL-202)', () => {
  beforeEach(() => {
    document.title = 'ECM Project Tracker'
  })

  it('sets document.title with the app-name suffix on mount', () => {
    renderHook(() => usePageTitle('Dashboard'))
    expect(document.title).toBe('Dashboard · ECM Project Tracker')
  })

  it('uses the exported APP_NAME constant as the suffix', () => {
    renderHook(() => usePageTitle('Board'))
    expect(document.title).toBe(`Board · ${APP_NAME}`)
  })

  it('updates document.title when the title changes', () => {
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: 'Backlog' },
    })
    expect(document.title).toBe('Backlog · ECM Project Tracker')

    rerender({ title: 'Reports' })
    expect(document.title).toBe('Reports · ECM Project Tracker')
  })

  it('restores the previous title on unmount', () => {
    document.title = 'Previous Title'
    const { unmount } = renderHook(() => usePageTitle('User Management'))
    expect(document.title).toBe('User Management · ECM Project Tracker')

    unmount()
    expect(document.title).toBe('Previous Title')
  })

  it('leaves document.title untouched when no title is given', () => {
    document.title = 'Untouched'
    renderHook(() => usePageTitle(''))
    expect(document.title).toBe('Untouched')
  })
})
