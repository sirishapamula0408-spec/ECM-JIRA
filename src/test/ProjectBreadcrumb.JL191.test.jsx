// JL-191 — project breadcrumb: present from the first render, a current-page
// crumb on every project view (including Summary and nested paths), real links,
// and aria-current on the last crumb.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { projectViewLabel } from '../utils/projectBreadcrumb'

vi.mock('../api/projectApi', () => ({ fetchProjectById: vi.fn() }))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))

import { fetchProjectById } from '../api/projectApi'
import { ProjectTopPanel } from '../components/layout/ProjectTopPanel'

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <ProjectTopPanel hasProjects />
  </MemoryRouter>,
)
const breadcrumb = () => screen.getByRole('navigation', { name: 'Breadcrumb' })

describe('projectViewLabel', () => {
  it('labels the bare project route as Summary', () => {
    expect(projectViewLabel('/projects/6', '6')).toBe('Summary')
    expect(projectViewLabel('/projects/6/', '6')).toBe('Summary')
  })

  it('labels every project route registered in App.jsx', () => {
    const cases = {
      'active-sprint': 'Active sprints', automation: 'Automation', backlog: 'Backlog', board: 'Board',
      goals: 'Goals', list: 'List', queues: 'Queues', releases: 'Releases', reports: 'Reports',
      roadmap: 'Timeline', settings: 'Settings', wiki: 'Wiki',
    }
    for (const [segment, label] of Object.entries(cases)) {
      expect(projectViewLabel(`/projects/6/${segment}`, '6')).toBe(label)
    }
  })

  it('keeps the crumb on nested paths by reading the first segment', () => {
    expect(projectViewLabel('/projects/6/settings/fields', '6')).toBe('Settings')
    expect(projectViewLabel('/projects/6/wiki/pages/3', '6')).toBe('Wiki')
  })

  it('returns nothing for unknown views, other projects, or no project', () => {
    expect(projectViewLabel('/projects/6/unknown', '6')).toBe('')
    expect(projectViewLabel('/projects/60/backlog', '6')).toBe('')
    expect(projectViewLabel('/backlog', undefined)).toBe('')
    expect(projectViewLabel('/projects/6/toString', '6')).toBe('')
  })
})

describe('ProjectTopPanel breadcrumb', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders immediately with a loading placeholder, then the project name', async () => {
    let resolve
    fetchProjectById.mockReturnValue(new Promise((r) => { resolve = r }))
    renderAt('/projects/6/backlog')

    // Present before the name request settles (it used to be hidden).
    const loading = within(breadcrumb()).getByRole('link', { name: 'Loading project' })
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(loading).toHaveAttribute('href', '/projects/6')

    resolve({ id: 6, name: 'Test Project' })
    const named = await within(breadcrumb()).findByRole('link', { name: 'Test Project' })
    expect(named).not.toHaveAttribute('aria-busy')
  })

  it('falls back to "Project <id>" when the name request fails', async () => {
    fetchProjectById.mockRejectedValue(new Error('500'))
    renderAt('/projects/6/reports')
    expect(await within(breadcrumb()).findByRole('link', { name: 'Project 6' })).toHaveAttribute('href', '/projects/6')
    expect(within(breadcrumb()).getByText('Reports')).toBeInTheDocument()
  })

  it('shows Summary as the current crumb on the project root', async () => {
    fetchProjectById.mockResolvedValue({ id: 6, name: 'Test Project' })
    renderAt('/projects/6')
    await within(breadcrumb()).findByRole('link', { name: 'Test Project' })
    expect(within(breadcrumb()).getByText('Summary')).toHaveAttribute('aria-current', 'page')
  })

  it('labels views that had no crumb before: Automation, Goals, Queues, Releases', async () => {
    fetchProjectById.mockResolvedValue({ id: 6, name: 'Test Project' })
    for (const [segment, label] of [['automation', 'Automation'], ['goals', 'Goals'], ['queues', 'Queues'], ['releases', 'Releases']]) {
      const { unmount } = renderAt(`/projects/6/${segment}`)
      expect(within(breadcrumb()).getByText(label)).toHaveAttribute('aria-current', 'page')
      unmount()
    }
  })

  it('uses real links for the ancestors and hides the separators from assistive tech', async () => {
    fetchProjectById.mockResolvedValue({ id: 6, name: 'Test Project' })
    renderAt('/projects/6/backlog')
    expect(within(breadcrumb()).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    await within(breadcrumb()).findByRole('link', { name: 'Test Project' })
    expect(within(breadcrumb()).queryByRole('button')).toBeNull()
    for (const sep of within(breadcrumb()).getAllByText('/')) expect(sep).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows no breadcrumb outside a project', () => {
    renderAt('/backlog')
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(fetchProjectById).not.toHaveBeenCalled()
  })
})
