import { Navigate } from 'react-router-dom'
import { usePermissions } from '../../hooks/usePermissions'

export function ProtectedRoute({ permission, role, projectId, redirectTo = '/', children }) {
  const permissions = usePermissions(projectId)

  if (!permissions.loaded) return null

  // Check permission-based access
  if (permission && !permissions[permission]) {
    return <Navigate to={redirectTo} replace />
  }

  // Check role-based access
  if (role) {
    const ROLE_RANK = { Viewer: 1, Member: 2, Admin: 3 }
    if (permissions.isOwner) return children
    const userRank = ROLE_RANK[permissions.workspaceRole] || 0
    const requiredRank = ROLE_RANK[role] || 0
    if (userRank < requiredRank) {
      return <Navigate to={redirectTo} replace />
    }
  }

  return children
}
