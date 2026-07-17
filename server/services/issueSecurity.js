// JL-131: Issue-level security schemes — pure, db-free visibility helper.
//
// canViewIssue(issue, user) → boolean
//   An issue with no security level (null/undefined) is public → always visible
//   (backward compatible with all pre-JL-131 issues). When a level is set, the
//   issue is only visible to:
//     - workspace Owners (user.isOwner)
//     - workspace Admins (user.workspaceRole === 'Admin')
//     - the issue's assignee (matched by email against assigneeEmail/assignee)
//     - the issue's reporter (matched by email against reporterEmail/reporter)
//
// Assignee/reporter are stored as free-form display strings in this app, so the
// match is intentionally tolerant: it compares the caller's email
// (case-insensitively) against every candidate identity field the issue carries.
// The helper accepts either the raw DB row shape (security_level_id) or the
// mapped API shape (securityLevelId), so it is usable on both sides of mapIssue.
export function canViewIssue(issue, user) {
  if (!issue) return false

  const level = issue.security_level_id ?? issue.securityLevelId ?? null
  // No security level → public.
  if (level === null || level === undefined) return true

  if (!user) return false
  // Workspace Owner / Admin always see restricted issues.
  if (user.isOwner) return true
  if (user.workspaceRole === 'Admin') return true

  const email = String(user.email || '').trim().toLowerCase()
  if (!email) return false

  const candidates = [
    issue.assigneeEmail,
    issue.assignee,
    issue.reporterEmail,
    issue.reporter,
  ]
  return candidates.some(
    (c) => c && String(c).trim().toLowerCase() === email,
  )
}
