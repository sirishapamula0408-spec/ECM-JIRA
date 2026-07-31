import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Contexts / apis the modal depends on.
vi.mock('../context/IssueContext', () => ({ useIssues: () => ({ handleCreate: vi.fn() }) }))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'T' }, members: [] }) }))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../context/AppDataContext', () => ({ useAppData: () => ({ setAppError: vi.fn() }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { email: 't@t.com' } }) }))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([
    { id: 1, name: 'ECM Platform', key: 'ECM' },
    { id: 9, name: 'Test Project', key: 'TP' },
  ]),
}))
vi.mock('../api/issueTypeSchemeApi', () => ({
  fetchProjectIssueTypes: vi.fn().mockResolvedValue({ allowedTypes: ['Story', 'Bug', 'Task'], defaultType: 'Story' }),
}))

import { CreateIssueModal } from '../components/issues/CreateIssueModal'

function projectSelect() {
  // the <select> that carries the project options
  const opt = screen.getByRole('option', { name: /Test Project/ })
  return opt.closest('select')
}

beforeEach(() => vi.clearAllMocks())

/* ================================================================
   JL-320: the Project dropdown must default to the project the user is
   currently viewing (from /projects/:id/...), not always the first project.
   ================================================================ */
describe('JL-320 — Create Issue modal default project', () => {
  it('defaults to the active project when opened from a project route', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/9/board']}>
        <CreateIssueModal onClose={() => {}} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('option', { name: /Test Project/ })).toBeInTheDocument())
    // active project is id 9 (Test Project), NOT the first project (ECM Platform)
    await waitFor(() => expect(projectSelect().value).toBe('9'))
  })

  it('falls back to the first project when not on a project route', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <CreateIssueModal onClose={() => {}} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('option', { name: /ECM Platform/ })).toBeInTheDocument())
    await waitFor(() => expect(projectSelect().value).toBe('1'))
  })
})
