import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkflowsPage } from '../pages/WorkflowsPage/WorkflowsPage'

vi.mock('react-router-dom', () => ({
  useParams: () => ({ projectId: '1' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }) => children,
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: [
      { id: 1, key: 'TP-1', title: 'Test Issue', status: 'To Do', priority: 'Medium', issueType: 'Task', assignee: 'Alice', projectId: 1, sprintId: null },
    ],
    handleCreate: vi.fn(),
    handleMove: vi.fn(),
  }),
}))

vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: [] }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'test@test.com', name: 'Test User' } }),
}))

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    members: [],
    profile: { full_name: 'Test User' },
  }),
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
    canCreateProject: true,
    canEditWorkflows: false,
    canAddComment: true,
    ...overrides,
  })
}

describe('WorkflowsPage RBAC', () => {
  describe('when canCreateIssue=false', () => {
    beforeEach(() => {
      setupPermissions({ canCreateIssue: false, canEditIssue: false })
    })

    it('should hide the inline Create button', () => {
      render(<WorkflowsPage />)
      expect(screen.queryByText('Create', { selector: 'button span span' })).not.toBeInTheDocument()
    })
  })

  describe('when canEditIssue=false', () => {
    beforeEach(() => {
      setupPermissions({ canCreateIssue: false, canEditIssue: false })
    })

    it('should disable the status select dropdowns', () => {
      render(<WorkflowsPage />)
      const statusSelects = document.querySelectorAll('.jira-list-status-select')
      statusSelects.forEach((select) => {
        expect(select).toBeDisabled()
      })
    })
  })

  describe('when canCreateIssue=true and canEditIssue=true', () => {
    beforeEach(() => {
      setupPermissions({ canCreateIssue: true, canEditIssue: true })
    })

    it('should show the inline Create button', () => {
      render(<WorkflowsPage />)
      const createButton = document.querySelector('.jira-list-create')
      expect(createButton).toBeInTheDocument()
    })

    it('should enable the status select dropdowns', () => {
      render(<WorkflowsPage />)
      const statusSelects = document.querySelectorAll('.jira-list-status-select')
      statusSelects.forEach((select) => {
        expect(select).not.toBeDisabled()
      })
    })
  })
})
