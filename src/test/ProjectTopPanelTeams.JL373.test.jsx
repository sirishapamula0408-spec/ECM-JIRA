import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn(() => Promise.resolve({ id: 6, name: 'Verify QW2' })),
}))

import { ProjectTopPanel } from '../components/layout/ProjectTopPanel'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProjectTopPanel hasProjects />
    </MemoryRouter>,
  )
}

describe('ProjectTopPanel — hidden on Teams page (JL-373)', () => {
  it('does not render the project navigation strip at /teams', () => {
    renderAt('/members')
    expect(screen.queryByRole('navigation', { name: /project views/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /backlog/i })).not.toBeInTheDocument()
  })

  it('does not render the strip at a nested Teams sub-path', () => {
    renderAt('/teams/5')
    expect(screen.queryByRole('navigation', { name: /project views/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /backlog/i })).not.toBeInTheDocument()
  })

  it('still renders the strip inside a project context', async () => {
    renderAt('/projects/6/backlog')
    expect(await screen.findByRole('navigation', { name: /project views/i })).toBeInTheDocument()
  })

  it('remains hidden on the dashboard and profile pages', () => {
    const { unmount } = renderAt('/dashboard')
    expect(screen.queryByRole('navigation', { name: /project views/i })).not.toBeInTheDocument()
    unmount()
    renderAt('/profile')
    expect(screen.queryByRole('navigation', { name: /project views/i })).not.toBeInTheDocument()
  })
})
