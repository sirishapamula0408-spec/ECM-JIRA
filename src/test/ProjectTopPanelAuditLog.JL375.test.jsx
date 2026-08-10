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

describe('ProjectTopPanel — hidden on Audit Log page (JL-375)', () => {
  it('does not render the navigation strip at /audit-log', () => {
    renderAt('/audit-log')
    expect(screen.queryByRole('navigation', { name: /project views/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /backlog/i })).not.toBeInTheDocument()
  })

  it('does not render the navigation strip at a nested audit-log sub-path', () => {
    renderAt('/audit-log/5')
    expect(screen.queryByRole('navigation', { name: /project views/i })).not.toBeInTheDocument()
  })

  it('still renders the navigation strip inside a project (positive control)', async () => {
    renderAt('/projects/6/backlog')
    const nav = await screen.findByRole('navigation', { name: /project views/i })
    expect(nav).toBeInTheDocument()
  })

  it('remains hidden on the dashboard (regression control)', () => {
    renderAt('/dashboard')
    expect(screen.queryByRole('navigation', { name: /project views/i })).not.toBeInTheDocument()
  })

  it('remains hidden on the profile page (regression control)', () => {
    renderAt('/profile')
    expect(screen.queryByRole('navigation', { name: /project views/i })).not.toBeInTheDocument()
  })
})
