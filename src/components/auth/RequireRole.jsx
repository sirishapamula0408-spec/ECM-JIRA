import { cloneElement, isValidElement, Children } from 'react'
import Tooltip from '@mui/material/Tooltip'
import { usePermissions } from '../../hooks/usePermissions'

const ROLE_RANK = {
  Viewer: 1,
  Member: 2,
  Admin: 3,
}

/**
 * Declarative wrapper for role-based UI gating.
 *
 * Props:
 * - role: workspace role required ('Admin', 'Member', 'Viewer')
 * - permission: capability key from usePermissions (e.g., 'canManageSprints')
 * - projectId: optional project scope for permission checks
 * - mode: 'hide' (default) or 'disable'
 * - fallback: optional element to render when unauthorized
 * - tooltip: message shown on disabled elements (default: 'You do not have permission')
 * - children: elements to gate
 *
 * Usage:
 *   <RequireRole role="Admin">
 *     <DeleteButton />
 *   </RequireRole>
 *
 *   <RequireRole permission="canManageSprints" projectId={projectId} mode="disable">
 *     <SprintControls />
 *   </RequireRole>
 */
export function RequireRole({
  role,
  permission,
  projectId,
  mode = 'hide',
  fallback = null,
  tooltip = 'You do not have permission',
  children,
}) {
  const permissions = usePermissions(projectId)

  // Determine authorization
  let authorized = false

  if (permission) {
    // Check by capability key
    authorized = Boolean(permissions[permission])
  } else if (role) {
    // Check by role rank
    if (permissions.isOwner) {
      authorized = true
    } else {
      const requiredRank = ROLE_RANK[role] || 0
      const userRank = ROLE_RANK[permissions.workspaceRole] || 0
      authorized = userRank >= requiredRank
    }
  } else {
    // No role or permission specified — allow
    authorized = true
  }

  if (authorized) {
    return children
  }

  if (mode === 'disable') {
    // Clone children with disabled prop and wrap in tooltip
    return Children.map(children, (child) => {
      if (!isValidElement(child)) return child
      const disabled = cloneElement(child, {
        disabled: true,
        style: { ...child.props.style, opacity: 0.5, pointerEvents: 'none' },
      })
      return (
        <Tooltip title={tooltip} arrow>
          <span style={{ display: 'inline-block' }}>{disabled}</span>
        </Tooltip>
      )
    })
  }

  // mode === 'hide' — render fallback or nothing
  return fallback
}
