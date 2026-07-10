import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAsync } from '../hooks/useAsync'

describe('useAsync', () => {
  it('starts idle (no auto-run when deps are omitted)', () => {
    const fn = vi.fn().mockResolvedValue('x')
    const { result } = renderHook(() => useAsync(fn))
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBe(null)
    expect(result.current.error).toBe(null)
    expect(fn).not.toHaveBeenCalled()
  })

  it('resolves: sets data and toggles loading off', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useAsync(fn))

    let returned
    await act(async () => {
      returned = await result.current.run()
    })

    expect(returned).toEqual({ ok: true })
    expect(result.current.data).toEqual({ ok: true })
    expect(result.current.error).toBe(null)
    expect(result.current.loading).toBe(false)
  })

  it('rejects: sets error and leaves data null', async () => {
    const boom = new Error('boom')
    const fn = vi.fn().mockRejectedValue(boom)
    const { result } = renderHook(() => useAsync(fn))

    await act(async () => {
      await expect(result.current.run()).rejects.toThrow('boom')
    })

    expect(result.current.error).toBe(boom)
    expect(result.current.data).toBe(null)
    expect(result.current.loading).toBe(false)
  })

  it('auto-runs when deps are provided', async () => {
    const fn = vi.fn().mockResolvedValue('auto')
    const { result } = renderHook(() => useAsync(fn, []))

    await waitFor(() => expect(result.current.data).toBe('auto'))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
  })
})
