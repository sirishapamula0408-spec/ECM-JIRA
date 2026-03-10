import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActiveSprintPage } from '../pages/ActiveSprintPage/ActiveSprintPage'

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
      { id: 1, key: 'TP-1', title: 'Sprint Issue', status: 'To Do', priority: 'Medium', issueType: 'Task', assignee: 'Alice', projectId: 1, sprintId: 10 },
      { id: 2, key: 'TP-2', title: 'Another Issue', status: 'In Progress', priority: 'High', issueType: 'Bug', assignee: 'Bob', projectId: 1, sprintId: 10 },
    ],
    handleMove: vi.fn(),
    reloadIssues: vi.fn(),
  }),
}))

vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({
    sprints: [
      { id: 10, name: 'Sprint 1', isStarted: true, dateRange: 'Mar 1 - Mar 15' },
    ],
    handleCompleteSprint: vi.fn(),
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
    canManageSprints: true,
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

describe('ActiveSprintPage RBAC', () => {
  describe('when canManageSprints=false and canEditIssue=false', () => {
    beforeEach(() => {
      setupPermissions({ canManageSprints: false, canEditIssue: false })
    })

    it('should hide the Complete sprint button', () => {
      render(<ActiveSprintPage />)
      expect(screen.queryByText('Complete sprint')).not.toBeInTheDocument()
    })

    it('should render cards as not draggable', () => {
      render(<ActiveSprintPage />)
      const cards = document.querySelectorAll('.active-sprint-card')
      cards.forEach((card) => {
        expect(card.getAttribute('draggable')).not.toBe('true')
      })
    })
  })

  describe('when canManageSprints=true and canEditIssue=true', () => {
    beforeEach(() => {
      setupPermissions({ canManageSprints: true, canEditIssue: true })
    })

    it('should show the Complete sprint button', () => {
      render(<ActiveSprintPage />)
      expect(screen.getByText('Complete sprint')).toBeInTheDocument()
    })

    it('should render cards as draggable', () => {
      render(<ActiveSprintPage />)
      const cards = document.querySelectorAll('.active-sprint-card')
      expect(cards.length).toBeGreaterThan(0)
      cards.forEach((card) => {
        expect(card.getAttribute('draggable')).toBe('true')
      })
    })
  })
})
