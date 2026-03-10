import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IssueDetailPage } from '../pages/IssueDetailPage/IssueDetailPage'

// ---- Mocks ----

vi.mock('react-router-dom', () => ({
  useParams: () => ({ issueId: '1' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }) => children,
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: [
      { id: 1, key: 'TP-1', title: 'Test Issue', status: 'To Do', priority: 'Medium', issueType: 'Task', assignee: 'Alice', description: 'A description', projectId: 1, sprintId: null },
    ],
    handleMove: vi.fn(),
    handleUpdate: vi.fn(),
  }),
}))

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    members: [{ id: 1, name: 'Alice' }],
    profile: { full_name: 'Test User' },
  }),
}))

vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: [] }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'test@test.com' } }),
}))

vi.mock('../api/issueApi', () => ({
  fetchIssueById: vi.fn().mockResolvedValue(null),
  fetchComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn().mockResolvedValue({ id: 99, author: 'Test', text: 'hi' }),
}))

vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn().mockResolvedValue({ name: 'Test Project' }),
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

describe('IssueDetailPage RBAC', () => {
  describe('when canEditIssue=false', () => {
    beforeEach(() => {
      setupPermissions({ canEditIssue: false, canAddComment: false })
    })

    it('should hide quick action buttons (Attach, Create subtask, Link issue)', () => {
      render(<IssueDetailPage />)
      expect(screen.queryByText('Attach')).not.toBeInTheDocument()
      expect(screen.queryByText('Create subtask')).not.toBeInTheDocument()
      expect(screen.queryByText('Link issue')).not.toBeInTheDocument()
    })

    it('should disable the status select', () => {
      render(<IssueDetailPage />)
      const statusSelect = screen.getByDisplayValue('To Do')
      expect(statusSelect).toBeDisabled()
    })

    it('should render InlineField displays as read-only (no "Click to edit" title)', () => {
      render(<IssueDetailPage />)
      const displays = document.querySelectorAll('.id-inline-display')
      displays.forEach((el) => {
        expect(el.getAttribute('title')).not.toBe('Click to edit')
      })
    })
  })

  describe('when canAddComment=false', () => {
    beforeEach(() => {
      setupPermissions({ canEditIssue: true, canAddComment: false })
    })

    it('should hide comment input area', () => {
      render(<IssueDetailPage />)
      expect(screen.queryByPlaceholderText('Add a comment...')).not.toBeInTheDocument()
    })
  })

  describe('when all permissions are true', () => {
    beforeEach(() => {
      setupPermissions({ canEditIssue: true, canAddComment: true })
    })

    it('should show quick action buttons', () => {
      render(<IssueDetailPage />)
      expect(screen.getByText('Attach')).toBeInTheDocument()
      expect(screen.getByText('Create subtask')).toBeInTheDocument()
      expect(screen.getByText('Link issue')).toBeInTheDocument()
    })

    it('should enable the status select', () => {
      render(<IssueDetailPage />)
      const statusSelect = screen.getByDisplayValue('To Do')
      expect(statusSelect).not.toBeDisabled()
    })

    it('should show comment input', () => {
      render(<IssueDetailPage />)
      expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument()
    })

    it('should render InlineField displays with "Click to edit" title', () => {
      render(<IssueDetailPage />)
      const editableDisplays = document.querySelectorAll('.id-inline-display[title="Click to edit"]')
      expect(editableDisplays.length).toBeGreaterThan(0)
    })
  })
})
