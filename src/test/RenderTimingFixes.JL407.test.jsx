// JL-407 — behavioural cover for the sites where the react-hooks fixes changed
// *when* something happens, not just which lint rule fires. Each of these would
// still lint clean if the fix were reverted to something subtly wrong, so the
// lint run is not cover on its own.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, renderHook } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'

const { mockFetchProjectById } = vi.hoisted(() => ({ mockFetchProjectById: vi.fn() }))
vi.mock('../api/projectApi', () => ({
  fetchProjectById: mockFetchProjectById,
  fetchProjects: vi.fn(() => Promise.resolve([])),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canCreateProject: true, canManageUsers: true, canManageMembers: true }),
}))
vi.mock('../hooks/usePluginContributions', () => ({
  usePluginContributions: () => ({ contributions: [], loading: false }),
}))

import { ProjectTopPanel } from '../components/layout/ProjectTopPanel'
import { Sidebar } from '../components/layout/Sidebar'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JL-407 — ProjectTopPanel never shows a name from another project', () => {
  // The real defect the refactor removed: the effect only cleared `projectName`
  // when projectId went falsy, so moving from project A to project B left A's
  // name in the header for the whole duration of B's request.
  // A real in-router navigation. Re-rendering MemoryRouter with different
  // `initialEntries` does nothing — the router owns its history after mount —
  // so a rerender-based test would silently never navigate and pass regardless.
  function GoTo({ to }) {
    const navigate = useNavigate()
    return <button type="button" onClick={() => navigate(to)}>go</button>
  }

  function renderAt(pathname) {
    return render(
      <MemoryRouter initialEntries={[pathname]}>
        <ProjectTopPanel hasProjects />
        <GoTo to="/projects/2/board" />
      </MemoryRouter>,
    )
  }

  it('shows the name once it resolves', async () => {
    mockFetchProjectById.mockResolvedValue({ id: 1, name: 'Apollo' })
    renderAt('/projects/1/board')
    expect(await screen.findByText('Apollo')).toBeInTheDocument()
  })

  it('does not show the previous project name while the next one is loading', async () => {
    // Project 1 resolves; project 2 never does, standing in for "still in
    // flight". Nothing in the header may still claim to be Apollo.
    mockFetchProjectById.mockImplementation((id) =>
      String(id) === '1'
        ? Promise.resolve({ id: 1, name: 'Apollo' })
        : new Promise(() => {}),
    )
    renderAt('/projects/1/board')
    expect(await screen.findByText('Apollo')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(mockFetchProjectById).toHaveBeenCalledWith('2'))
    expect(screen.queryByText('Apollo')).not.toBeInTheDocument()
  })

  it('shows the new name once the second project resolves', async () => {
    // The positive control for the test above: "never shows Apollo" would also
    // be satisfied by never showing anything at all.
    mockFetchProjectById.mockImplementation((id) =>
      Promise.resolve({ id: Number(id), name: String(id) === '1' ? 'Apollo' : 'Borealis' }),
    )
    renderAt('/projects/1/board')
    expect(await screen.findByText('Apollo')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(await screen.findByText('Borealis')).toBeInTheDocument()
    expect(screen.queryByText('Apollo')).not.toBeInTheDocument()
  })
})

describe('JL-407 — Sidebar auto-expand keeps effect parity', () => {
  // The expand moved from an effect into a render-time adjustment. These are the
  // four transitions the effect had, asserted so the swap is not a behaviour
  // change smuggled in behind a lint fix.
  function Nav({ to }) {
    const navigate = useNavigate()
    return <button type="button" onClick={() => navigate(to)}>go {to}</button>
  }

  function renderAt(pathname, extra = null) {
    return render(
      <MemoryRouter initialEntries={[pathname]}>
        <Sidebar collapsed={false} onToggleSidebar={() => {}} onCreateProject={() => {}} projectRefreshKey={0} hasProjects />
        {extra}
      </MemoryRouter>,
    )
  }

  // The disclosure button carries aria-expanded and swaps its accessible name
  // between "Expand projects" and "Collapse projects", so the open state is
  // readable exactly the way assistive tech reads it.
  const disclosure = () => screen.getByRole('button', { name: /(Expand|Collapse) projects/ })
  const isOpen = () => disclosure().getAttribute('aria-expanded') === 'true'

  it('expands on mount inside a project route', () => {
    renderAt('/projects/7/board')
    expect(isOpen()).toBe(true)
  })

  it('does not expand on mount outside a project route', () => {
    renderAt('/members')
    expect(isOpen()).toBe(false)
  })

  it('expands when navigating into a project', () => {
    renderAt('/members', <Nav to="/projects/7/board" />)
    expect(isOpen()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'go /projects/7/board' }))
    expect(isOpen()).toBe(true)
  })

  it('leaves a manual collapse alone when leaving the project route', () => {
    // The effect this replaced only ran on an activeProjectId change, so
    // navigating away never re-expanded. Same here — and this is the case a
    // naive `expanded || Boolean(activeProjectId)` derivation would break.
    renderAt('/projects/7/board', <Nav to="/members" />)
    expect(isOpen()).toBe(true)
    fireEvent.click(disclosure())
    expect(isOpen()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'go /members' }))
    expect(isOpen()).toBe(false)
  })
})

describe('JL-407 — useKeyboardShortcuts publishes handlers from an effect', () => {
  // The ref write moved out of render. The behaviour that must survive: a
  // keydown always reaches the newest handler, including after a re-render with
  // a different function identity.
  it('calls the latest onCreate after a re-render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ onCreate }) => useKeyboardShortcuts({ onCreate }), {
      initialProps: { onCreate: first },
    })

    fireEvent.keyDown(document, { key: 'c' })
    expect(first).toHaveBeenCalledTimes(1)

    rerender({ onCreate: second })
    fireEvent.keyDown(document, { key: 'c' })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('works on the very first render, before any re-render', () => {
    // The failure mode of moving a ref write into an effect is an empty ref on
    // the first commit. Effects run before a user event can be delivered, so
    // this must still fire.
    const onFocusSearch = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onFocusSearch }))
    fireEvent.keyDown(document, { key: '/' })
    expect(onFocusSearch).toHaveBeenCalledTimes(1)
  })

  it('still ignores shortcuts typed into an input', () => {
    const onCreate = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onCreate }))
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'c' })
    expect(onCreate).not.toHaveBeenCalled()
    input.remove()
  })
})
