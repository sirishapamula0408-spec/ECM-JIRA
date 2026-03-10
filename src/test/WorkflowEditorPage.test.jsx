import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkflowEditorPage } from '../pages/WorkflowEditorPage/WorkflowEditorPage'

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { usePermissions } from '../hooks/usePermissions'

function setupPermissions(overrides = {}) {
  usePermissions.mockReturnValue({
    loaded: true,
    workspaceRole: 'Admin',
    projectRole: null,
    isOwner: false,
    isAdmin: true,
    canCreateIssue: true,
    canEditIssue: true,
    canDeleteIssue: true,
    canManageSprints: true,
    canManageProjectSettings: true,
    canManageMembers: true,
    canInviteMembers: true,
    canDeleteProject: true,
    canCreateProject: true,
    canEditWorkflows: true,
    canAddComment: true,
    ...overrides,
  })
}

describe('WorkflowEditorPage RBAC', () => {
  describe('when canEditWorkflows=false', () => {
    beforeEach(() => {
      setupPermissions({ canEditWorkflows: false })
    })

    it('should hide Add status and Add transition toolbar buttons', () => {
      render(<WorkflowEditorPage />)
      expect(screen.queryByText('Add status', { exact: false })).not.toBeInTheDocument()
      expect(screen.queryByText('Add transition', { exact: false })).not.toBeInTheDocument()
    })

    it('should hide Publish and Discard changes buttons', () => {
      render(<WorkflowEditorPage />)
      expect(screen.queryByText('Publish')).not.toBeInTheDocument()
      expect(screen.queryByText('Discard changes')).not.toBeInTheDocument()
    })

    it('should hide Delete status button when a node is selected', () => {
      render(<WorkflowEditorPage />)
      const nodes = document.querySelectorAll('.wfe-node')
      expect(nodes.length).toBeGreaterThan(0)
      fireEvent.mouseDown(nodes[0])
      expect(screen.queryByText(/Delete status/)).not.toBeInTheDocument()
    })

    it('should hide Delete transition button when a transition is selected', () => {
      render(<WorkflowEditorPage />)
      const arrows = document.querySelectorAll('.wfe-arrow')
      if (arrows.length > 0) {
        fireEvent.click(arrows[0])
        expect(screen.queryByText(/Delete transition/)).not.toBeInTheDocument()
      }
    })
  })

  describe('when canEditWorkflows=true', () => {
    beforeEach(() => {
      setupPermissions({ canEditWorkflows: true })
    })

    it('should show Add status and Add transition toolbar buttons', () => {
      render(<WorkflowEditorPage />)
      expect(screen.getByText('Add status', { exact: false })).toBeInTheDocument()
      expect(screen.getByText('Add transition', { exact: false })).toBeInTheDocument()
    })

    it('should show Publish and Discard changes buttons', () => {
      render(<WorkflowEditorPage />)
      expect(screen.getByText('Publish')).toBeInTheDocument()
      expect(screen.getByText('Discard changes')).toBeInTheDocument()
    })

    it('should show Delete status button when a node is selected', () => {
      render(<WorkflowEditorPage />)
      const nodes = document.querySelectorAll('.wfe-node')
      expect(nodes.length).toBeGreaterThan(0)
      fireEvent.mouseDown(nodes[0])
      expect(screen.getByText(/Delete status/)).toBeInTheDocument()
    })
  })
})
