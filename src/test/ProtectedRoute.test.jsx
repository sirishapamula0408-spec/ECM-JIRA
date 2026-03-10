import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from '../components/auth/ProtectedRoute'

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { usePermissions } from '../hooks/usePermissions'

function setupPermissions(overrides = {}) {
  usePermissions.mockReturnValue({
    loaded: true,
    workspaceRole: 'Member',
    isOwner: false,
    canManageProjectSettings: false,
    ...overrides,
  })
}

function renderWithRouter(permission, redirectTo = '/denied') {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route
          path="/protected"
          element={
            <ProtectedRoute permission={permission} redirectTo={redirectTo}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/denied" element={<div>Access Denied</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should render children when permission is granted', () => {
    setupPermissions({ canManageProjectSettings: true })
    renderWithRouter('canManageProjectSettings')
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('should redirect when permission is denied', () => {
    setupPermissions({ canManageProjectSettings: false })
    renderWithRouter('canManageProjectSettings')
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
  })

  it('should render nothing while permissions are loading', () => {
    setupPermissions({ loaded: false })
    renderWithRouter('canManageProjectSettings')
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument()
  })

  it('should allow owner through role-based check', () => {
    setupPermissions({ isOwner: true, workspaceRole: 'Admin' })
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <ProtectedRoute role="Admin" redirectTo="/denied">
                <div>Admin Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/denied" element={<div>Access Denied</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Admin Content')).toBeInTheDocument()
  })

  it('should redirect Viewer from Admin-required route', () => {
    setupPermissions({ workspaceRole: 'Viewer', isOwner: false })
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <ProtectedRoute role="Admin" redirectTo="/denied">
                <div>Admin Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/denied" element={<div>Access Denied</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument()
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
  })
})
