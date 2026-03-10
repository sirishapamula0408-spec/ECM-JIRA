import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectsPage } from '../pages/ProjectsPage/ProjectsPage'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }) => children,
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([
    { id: 1, name: 'Alpha', key: 'AL', type: 'Scrum', lead: 'Alice', avatar_color: '#0052cc' },
    { id: 2, name: 'Beta', key: 'BE', type: 'Kanban', lead: 'Bob', avatar_color: '#36b37e' },
  ]),
  deleteProject: vi.fn().mockResolvedValue({}),
}))

import { usePermissions } from '../hooks/usePermissions'

function setupPermissions(overrides = {}) {
  usePermissions.mockReturnValue({
    loaded: true,
    workspaceRole: 'Member',
    projectRole: null,
    isOwner: false,
    isAdmin: false,
    canCreateIssue: true,
    canEditIssue: true,
    canDeleteIssue: false,
    canManageSprints: false,
    canManageProjectSettings: false,
    canManageMembers: false,
    canInviteMembers: false,
    canDeleteProject: false,
    canCreateProject: false,
    canEditWorkflows: false,
    canAddComment: true,
    ...overrides,
  })
}

describe('ProjectsPage RBAC', () => {
  const mockOnCreate = vi.fn()

  describe('when canCreateProject=false and canDeleteProject=false', () => {
    beforeEach(() => {
      setupPermissions({ canCreateProject: false, canDeleteProject: false })
    })

    it('should hide the Create project button', async () => {
      render(<ProjectsPage onCreateProject={mockOnCreate} projectRefreshKey={0} />)
      await screen.findByText('Alpha')
      expect(screen.queryByText('Create project')).not.toBeInTheDocument()
    })

    it('should hide the Move to trash button in the action menu', async () => {
      render(<ProjectsPage onCreateProject={mockOnCreate} projectRefreshKey={0} />)
      await screen.findByText('Alpha')
      const actionBtns = screen.getAllByLabelText('Project actions')
      fireEvent.click(actionBtns[0])
      expect(screen.queryByText('Move to trash')).not.toBeInTheDocument()
    })
  })

  describe('when canCreateProject=true and canDeleteProject=true', () => {
    beforeEach(() => {
      setupPermissions({ canCreateProject: true, canDeleteProject: true })
    })

    it('should show the Create project button', async () => {
      render(<ProjectsPage onCreateProject={mockOnCreate} projectRefreshKey={0} />)
      await screen.findByText('Alpha')
      expect(screen.getByText('Create project')).toBeInTheDocument()
    })

    it('should show the Move to trash button in the action menu', async () => {
      render(<ProjectsPage onCreateProject={mockOnCreate} projectRefreshKey={0} />)
      await screen.findByText('Alpha')
      const actionBtns = screen.getAllByLabelText('Project actions')
      fireEvent.click(actionBtns[0])
      expect(screen.getByText('Move to trash')).toBeInTheDocument()
    })
  })
})
