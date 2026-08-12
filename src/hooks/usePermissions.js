import { useMemo } from 'react'
import { useMembers } from '../context/MemberContext'

// Project "Lead" is the highest project tier (>= Admin), so a project Lead
// gets full project-admin capabilities. Workspace roles top out at Admin.
const ROLE_RANK = {
  Viewer: 1,
  Member: 2,
  Admin: 3,
  Lead: 4,
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
        canCreateIssueAnywhere: false,
        canEditIssue: false,
        canDeleteIssue: false,
        canExportIssues: false,
        canManageSprints: false,
        canManageProjectSettings: false,
        canManageMembers: false,
        canInviteMembers: false,
        canManageUsers: false,
        canDeleteUser: false,
        canDeleteProject: false,
        canCreateProject: false,
        canEditWorkflows: false,
        canAddComment: false,
        canLogWork: false,
        canAddAttachment: false,
        canLinkIssues: false,
        canManageCrossProjectBoards: false,
      }
    }

    const { workspaceRole, isOwner, projectRoles, projectCreationPolicy } = currentMember
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

    // Effective rank: workspace Admin/Owner always gets max rank; otherwise
    // JL-289 — an explicit project role is AUTHORITATIVE within that project and
    // sets the effective rank up OR down (workspace Viewer + project Admin is
    // elevated; workspace Member + project Viewer is genuinely read-only). A user
    // with no role on this project falls back to their workspace rank.
    // Keep this expression textually identical to resolveProjectAccess() in
    // server/middleware/authorize.js; the frontend mirror and the backend gate
    // MUST be changed together or the UI will offer actions the API rejects.
    const effectiveRank = isOwner || wsRank >= ROLE_RANK.Admin
      ? ROLE_RANK.Admin
      : projectRole ? projRank : wsRank

    const isAdmin = isOwner || wsRank >= ROLE_RANK.Admin
    const isProjectAdmin = isAdmin || projRank >= ROLE_RANK.Admin

    // JL-295: global (project-agnostic) create eligibility — true when the
    // workspace rank alone allows creating, OR the user holds a project role
    // >= Member on at least one project. Used by UI that isn't scoped to a
    // single project (e.g. the Topbar "+ Create" button), so a workspace
    // Viewer who is a Member/Lead somewhere still sees the button. A pure
    // Viewer (no project write role) stays blocked.
    const hasAnyProjectWriteRole = (projectRoles || []).some(
      (pr) => (ROLE_RANK[pr.role] || 0) >= ROLE_RANK.Member,
    )

    return {
      loaded: true,
      workspaceRole,
      projectRole,
      isOwner,
      isAdmin,

      // Issue permissions
      canCreateIssue: effectiveRank >= ROLE_RANK.Member,
      // JL-295: eligible to create in at least one project (see above)
      canCreateIssueAnywhere:
        effectiveRank >= ROLE_RANK.Member || hasAnyProjectWriteRole,
      canEditIssue: effectiveRank >= ROLE_RANK.Member,
      // JL-228: project Members (and above) can delete issues/tasks/stories/epics
      // — same tier as create/edit. Viewers stay blocked (rank < Member).
      canDeleteIssue: effectiveRank >= ROLE_RANK.Member,

      // JL-288: exporting issue data is a READ operation — any project member,
      // including Viewers, may export ("if permitted"). Backend export endpoint
      // is gated on project READ; import stays Member+ (canCreateIssue).
      canExportIssues: effectiveRank >= ROLE_RANK.Viewer,

      // Sprint permissions
      canManageSprints: isProjectAdmin,

      // Project permissions
      canManageProjectSettings: isProjectAdmin,
      canDeleteProject: isOwner || isAdmin,
      // JL-211: configurable workspace policy. 'admins_only' restricts creation to
      // workspace Admin/Owner; anything else (default 'all_members') keeps the
      // legacy Member+ behaviour. Owner always allowed.
      canCreateProject:
        projectCreationPolicy === 'admins_only'
          ? isAdmin
          : wsRank >= ROLE_RANK.Member,

      // Member permissions
      canManageMembers: isAdmin,
      canInviteMembers: isAdmin,

      // User management permissions (JL-195) — workspace Admin/Owner only
      canManageUsers: isAdmin,
      canDeleteUser: isAdmin,

      // Workflow permissions
      canEditWorkflows: isAdmin,

      // Comment permissions
      canAddComment: effectiveRank >= ROLE_RANK.Member,

      // JL-284: additional IssueDetailPage write capabilities — same tier as
      // canEditIssue (project Member+). Viewers get a read-only issue view.
      canLogWork: effectiveRank >= ROLE_RANK.Member,
      canAddAttachment: effectiveRank >= ROLE_RANK.Member,
      canLinkIssues: effectiveRank >= ROLE_RANK.Member,

      // JL-296: mutating shared cross-project boards requires workspace Member+.
      // Workspace-level capability (not project-scoped) — Viewers are read-only.
      canManageCrossProjectBoards: wsRank >= ROLE_RANK.Member,
    }
  }, [currentMember, projectId])
}
