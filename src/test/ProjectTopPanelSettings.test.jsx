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

describe('ProjectTopPanel — Settings tab (JL-222)', () => {
  it('shows a Settings link to the project settings page when inside a project', async () => {
    renderAt('/projects/6/board')
    const link = await screen.findByRole('link', { name: /settings/i })
    expect(link).toHaveAttribute('href', '/projects/6/settings')
  })

  it('marks the Settings tab active on the settings page', async () => {
    renderAt('/projects/6/settings')
    const link = await screen.findByRole('link', { name: /settings/i })
    expect(link.className).toMatch(/active/)
  })

  it('does not show the Settings tab outside a project context', () => {
    renderAt('/backlog')
    expect(screen.queryByRole('link', { name: /^settings$/i })).not.toBeInTheDocument()
  })
})
