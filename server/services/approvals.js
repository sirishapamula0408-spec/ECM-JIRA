import { all, get } from '../db.js'
import { ROLE_RANK, resolveProjectAccess } from '../middleware/authorize.js'

// JL-360: shared approval-gate logic.
//
// Before this module the approval feature was inert: `approval_rules` could be
// configured by an admin but nothing ever consulted them, so a "moving to Done
// requires a Lead approval" rule was a governance control that enforced nothing.
// The rule lookup + decision tallying now live here so the status-change path
// (server/routes/issues.js) and the approvals routes read from ONE source of
// truth rather than two drifting copies of the same query.

export const DEFAULT_APPROVER_ROLE = 'Admin'

/**
 * JL-360: find the approval rule governing a `from -> to` transition.
 *
 * Precedence: a project-specific rule wins over the global (`project_id IS NULL`)
 * fallback — `ORDER BY project_id DESC NULLS LAST` puts the concrete project id
 * first. Returns null when the transition is ungated, which is the case for every
 * existing install that has never created a rule (so behaviour is unchanged).
 */
export async function findApprovalRule(projectId, fromStatus, toStatus) {
  if (!fromStatus || !toStatus) return null
  // A no-op transition is never gated.
  if (fromStatus === toStatus) return null
  const rule = await get(
    'SELECT * FROM approval_rules WHERE (project_id = ? OR project_id IS NULL) AND from_status = ? AND to_status = ? ORDER BY project_id DESC NULLS LAST LIMIT 1',
    [projectId ?? null, fromStatus, toStatus],
  )
  return rule || null
}

/**
 * JL-360: timestamp at which the issue last entered its current status.
 *
 * Used to expire stale approvals — see collectDecisions(). Derived from the
 * JL-82 issue_history audit log so no schema change is needed. Returns null for
 * an issue that has never transitioned (nothing to expire).
 */
export async function lastStatusChangeAt(issueId) {
  const row = await get(
    "SELECT changed_at FROM issue_history WHERE issue_id = ? AND field = 'status' ORDER BY changed_at DESC, id DESC LIMIT 1",
    [issueId],
  )
  return row?.changed_at ?? null
}

// JL-360: later of two timestamps (either may be null/undefined). Values come
// back from pg as Date objects, but strings are tolerated.
function maxTimestamp(a, b) {
  if (!a) return b ?? null
  if (!b) return a ?? null
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

/**
 * JL-360: reduce raw approval rows to the effective decision per approver.
 *
 * Deliberate rules (see the ticket's "judgement calls"):
 *  - DISTINCT approvers only. Ten approvals from one person do not satisfy
 *    `required_approvals = 2`; that would defeat the point of a quorum.
 *  - The LATEST decision per approver wins, so a reviewer may change their mind
 *    (approve → reject, or reject → approve) without leaving a phantom vote.
 *  - Any standing rejection blocks the transition outright, regardless of how
 *    many approvals were collected. A rejection that could be out-voted is not
 *    a rejection.
 */
export function collectDecisions(rows = []) {
  const latest = new Map()
  for (const row of rows) {
    const email = String(row.approver_email || '').trim().toLowerCase()
    if (!email) continue
    // Rows arrive oldest-first, so a later row overwrites an earlier one.
    latest.set(email, row.decision)
  }
  const approvers = []
  const rejecters = []
  for (const [email, decision] of latest) {
    if (decision === 'approved') approvers.push(email)
    else if (decision === 'rejected') rejecters.push(email)
    // 'pending' counts as neither.
  }
  return { approvers, rejecters }
}

/**
 * JL-360: full approval state for a prospective `issue.status -> toStatus` move.
 *
 * `issue` must carry { id, status, project_id }.
 *
 * Returns:
 *   { required, rule, approvedCount, satisfied, approvers, rejecters,
 *     requiredApprovals, approverRole, remaining, rejected, since }
 *
 * When no rule matches, `{ required: false, satisfied: true }` — the caller
 * proceeds exactly as it did before JL-360.
 */
export async function evaluateApproval(issue, toStatus) {
  const rule = await findApprovalRule(issue?.project_id ?? null, issue?.status, toStatus)
  if (!rule) {
    return {
      required: false,
      satisfied: true,
      rule: null,
      approvedCount: 0,
      approvers: [],
      rejecters: [],
      requiredApprovals: 0,
      approverRole: null,
      remaining: 0,
      rejected: false,
      since: null,
    }
  }

  // Stale-approval expiry: only decisions recorded AFTER the issue last entered
  // its current status count. Otherwise an issue approved for In Review -> Done,
  // moved back, and edited could ride the old approval straight through a second
  // time — an audit hole, because the approver never saw the later state.
  //
  // The rule's own created_at is also a floor: approvals recorded before the rule
  // existed were never role-checked (POST only enforces approver_role when a rule
  // matches), so they must not retroactively satisfy a newly-created gate.
  const lastChange = await lastStatusChangeAt(issue.id)
  const since = maxTimestamp(lastChange, rule.created_at)
  const params = [issue.id, issue.status, toStatus]
  let sql =
    'SELECT approver_email, decision, created_at FROM approvals WHERE issue_id = ? AND from_status = ? AND to_status = ?'
  if (since) {
    sql += ' AND created_at >= ?'
    params.push(since)
  }
  sql += ' ORDER BY created_at ASC, id ASC'
  const rows = (await all(sql, params)) || []

  const { approvers, rejecters } = collectDecisions(rows)
  const requiredApprovals = Number(rule.required_approvals) || 1
  const rejected = rejecters.length > 0
  const approvedCount = approvers.length

  return {
    required: true,
    rule,
    approvedCount,
    approvers,
    rejecters,
    requiredApprovals,
    approverRole: rule.approver_role || DEFAULT_APPROVER_ROLE,
    remaining: Math.max(0, requiredApprovals - approvedCount),
    rejected,
    satisfied: !rejected && approvedCount >= requiredApprovals,
    since: since ?? null,
  }
}

/**
 * JL-360: human-readable refusal reason for a gated transition, or null when
 * the move may proceed. Shaped to match the existing workflow refusal message
 * in issues.js so both 409s read the same way.
 */
export function approvalRefusalMessage(state, fromStatus, toStatus) {
  if (!state.required || state.satisfied) return null
  if (state.rejected) {
    return `Transition from "${fromStatus}" to "${toStatus}" was rejected by ${state.rejecters.join(', ')}`
  }
  return `Transition from "${fromStatus}" to "${toStatus}" requires ${state.requiredApprovals} ${state.approverRole} approval(s) — ${state.approvedCount} recorded`
}

/**
 * JL-360: may this user record an approval for a rule requiring `requiredRole`?
 *
 * Reuses resolveProjectAccess() from middleware/authorize.js rather than
 * inventing a parallel check, so the semantics match every other gated route:
 *  - workspace Owner/Admin bypass project-level checks (`access.admin`);
 *  - everyone else is judged on effectiveRank = max(workspace rank, project
 *    rank), the same rule src/hooks/usePermissions.js applies on the client.
 */
export async function canApprove(user, projectId, requiredRole = DEFAULT_APPROVER_ROLE) {
  const access = await resolveProjectAccess(user, projectId)
  if (access.admin) return true
  const needed = ROLE_RANK[requiredRole] || ROLE_RANK[DEFAULT_APPROVER_ROLE]
  return access.effectiveRank >= needed
}

/**
 * JL-360: segregation of duties — the issue's reporter may not approve their own
 * issue's transition. `reporter` may hold either an email or a member display
 * name, so both are compared (case-insensitively).
 */
export function isSelfApproval(issue, approverEmail, approverName) {
  const reporter = String(issue?.reporter || '').trim().toLowerCase()
  if (!reporter) return false
  const email = String(approverEmail || '').trim().toLowerCase()
  const name = String(approverName || '').trim().toLowerCase()
  return (Boolean(email) && reporter === email) || (Boolean(name) && reporter === name)
}
