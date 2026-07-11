import { useMemo } from 'react'
import { useMembers } from '../context/MemberContext'

const ROLE_RANK = {
  Viewer: 1,
  Member: 2,
  Admin: 3,
}

/**
 * Hook that returns permission capabilities based on the current user's
 * workspace role and optional project-level role.
 *
 * @param {number|string} [projectId] - Optional project ID for project-scoped permissions
 * @returns {object} Permission capabilities
 */
export function usePermissions(projectId) {
  const { currentMember } = useMembers()

  return useMemo(() => {
    if (!currentMember) {
      // Not loaded yet — deny everything
      return {
        loaded: false,
        workspaceRole: null,
        projectRole: null,
        isOwner: false,
        isAdmin: false,
        canCreateIssue: false,
        canEditIssue: false,
        canDeleteIssue: false,
        canManageSprints: false,
        canManageProjectSettings: false,
        canManageMembers: false,
        canInviteMembers: false,
        canDeleteProject: false,
        canCreateProject: false,
        canEditWorkflows: false,
        canAddComment: false,
      }
    }

    const { workspaceRole, isOwner, projectRoles } = currentMember
    const wsRank = ROLE_RANK[workspaceRole] || 0

    // Find the project-level role if projectId is provided
    let projectRole = null
    if (projectId && projectRoles) {
      const match = projectRoles.find(
        (pr) => String(pr.projectId) === String(projectId),
      )
      projectRole = match?.role || null
    }

    const projRank = ROLE_RANK[projectRole] || 0

    // Effective rank: workspace Admin/Owner always gets max rank;
    // otherwise take the higher of workspace and project rank
    const effectiveRank = isOwner || wsRank >= ROLE_RANK.Admin
      ? ROLE_RANK.Admin
      : Math.max(wsRank, projRank)

    const isAdmin = isOwner || wsRank >= ROLE_RANK.Admin
    const isProjectAdmin = isAdmin || projRank >= ROLE_RANK.Admin

    return {
      loaded: true,
      workspaceRole,
      projectRole,
      isOwner,
      isAdmin,

      // Issue permissions
      canCreateIssue: effectiveRank >= ROLE_RANK.Member,
      canEditIssue: effectiveRank >= ROLE_RANK.Member,
      canDeleteIssue: isProjectAdmin,

      // Sprint permissions
      canManageSprints: isProjectAdmin,

      // Project permissions
      canManageProjectSettings: isProjectAdmin,
      canDeleteProject: isOwner || isAdmin,
      canCreateProject: wsRank >= ROLE_RANK.Member,

      // Member permissions
      canManageMembers: isAdmin,
      canInviteMembers: isAdmin,

      // Workflow permissions
      canEditWorkflows: isAdmin,

      // Comment permissions
      canAddComment: effectiveRank >= ROLE_RANK.Member,
    }
  }, [currentMember, projectId])
}
