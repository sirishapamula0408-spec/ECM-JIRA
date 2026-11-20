/*
 * Issue notifications — the Jira-style "you were assigned", "issue created" and
 * "status changed" messages, in-app and by email.
 *
 * Every message goes through createNotification(), which stores the in-app row
 * and sends the email when the recipient's preferences allow it (email on,
 * digest off, the type not muted). This module decides only WHO is told:
 *
 *   created          → the assignee ("assigned to you"); the reporter, if that is
 *                      someone else ("created")
 *   assignee changed → the new assignee
 *   status changed   → the assignee, the reporter and every watcher
 *
 * Never the person who made the change. Never a deactivated member. Never anyone
 * who cannot read the issue: an email carries the issue's title, so a watcher
 * who has since lost access to the project, or a recipient an issue security
 * level hides the issue from, is skipped.
 *
 * `issues.assignee` and `issues.reporter` hold a member's NAME or EMAIL (both
 * forms occur), so each is resolved against `members` first. A value that
 * matches no member is skipped: there is no address to send to, and no role to
 * check access with.
 *
 * Every export is best-effort and never throws — a notification problem must
 * never fail the edit that triggered it. Callers fire and forget.
 */
import { get, all } from '../db.js'
import { createNotification } from '../routes/notifications.js'
import { canAccessProject } from '../middleware/authorize.js'
import { canViewIssue } from './issueSecurity.js'

export const ISSUE_NOTIFICATION_TYPES = ['issue_assigned', 'issue_created', 'status_changed']

/** A bulk edit lists at most this many issues in one summary message. */
const SUMMARY_LIST_MAX = 20

const ISSUE_COLUMNS = 'id, issue_key, title, status, priority, issue_type, project_id, assignee, reporter, security_level_id'

const lower = (v) => String(v ?? '').trim().toLowerCase()

async function loadIssue(issueId) {
  return get(`SELECT ${ISSUE_COLUMNS} FROM issues WHERE id = ?`, [issueId])
}

/** members row for a name-or-email value, or null. Prefers an email match. */
async function resolveMember(value) {
  const v = lower(value)
  if (!v) return null
  const member = await get(
    `SELECT id, name, email, role, is_owner, status FROM members
      WHERE LOWER(email) = ? OR LOWER(name) = ?
      ORDER BY CASE WHEN LOWER(email) = ? THEN 0 ELSE 1 END, id ASC
      LIMIT 1`,
    [v, v, v],
  )
  if (!member || !member.email || member.status === 'Deactivated') return null
  return member
}

/** May this member read this issue? Same rules as the issue's read gates. */
async function canRead(member, issue) {
  const user = {
    email: member.email,
    memberId: member.id,
    workspaceRole: member.role,
    isOwner: Boolean(member.is_owner),
  }
  if (!(await canAccessProject(user, issue.project_id))) return false
  return canViewIssue(issue, user)
}

async function displayName(email) {
  if (!email) return 'Someone'
  const m = await get('SELECT name FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1', [email])
  return m?.name || email
}

async function projectName(projectId) {
  if (projectId == null) return ''
  const p = await get('SELECT name FROM projects WHERE id = ?', [projectId])
  return p?.name || ''
}

function detailLines(issue, project) {
  const lines = [`Status: ${issue.status} · Priority: ${issue.priority}`]
  if (project) lines.push(`Project: ${project}`)
  return lines
}

const linkFor = (issue) => `/browse/${encodeURIComponent(issue.issue_key)}`

/**
 * Work out who hears about one event on one issue. Returns a list of
 * { member, type, title, message, line } — `line` is the one-line form used
 * when several issues are summarised in a single message.
 */
async function recipientsFor(issue, event, actorEmail) {
  const actor = await displayName(actorEmail)
  const project = await projectName(issue.project_id)
  const kind = (issue.issue_type || 'issue').toLowerCase()
  const key = issue.issue_key
  const out = []
  const seen = new Set([lower(actorEmail)])

  const add = async (value, build) => {
    const member = await resolveMember(value)
    if (!member) return
    const email = lower(member.email)
    if (seen.has(email)) return
    seen.add(email)
    if (!(await canRead(member, issue))) return
    out.push({ member, ...build() })
  }

  if (event.kind === 'created') {
    await add(issue.assignee, () => ({
      type: 'issue_assigned',
      title: `${key} assigned to you: ${issue.title}`,
      message: [`${actor} created this ${kind} and assigned it to you.`, ...detailLines(issue, project)].join('\n'),
      line: `${key}: ${issue.title}`,
    }))
    await add(issue.reporter, () => ({
      type: 'issue_created',
      title: `${key} created: ${issue.title}`,
      message: [`${actor} created this ${kind} with you as the reporter.`, ...detailLines(issue, project)].join('\n'),
      line: `${key}: ${issue.title}`,
    }))
  } else if (event.kind === 'assigned') {
    await add(issue.assignee, () => ({
      type: 'issue_assigned',
      title: `${key} assigned to you: ${issue.title}`,
      message: [`${actor} assigned this ${kind} to you.`, ...detailLines(issue, project)].join('\n'),
      line: `${key}: ${issue.title}`,
    }))
  } else if (event.kind === 'status') {
    const build = () => ({
      type: 'status_changed',
      title: `${key} moved to ${event.to}: ${issue.title}`,
      message: [
        `${actor} changed the status from ${event.from} to ${event.to}.`,
        `Assignee: ${issue.assignee || 'Unassigned'} · Priority: ${issue.priority}`,
        ...(project ? [`Project: ${project}`] : []),
      ].join('\n'),
      line: `${key}: ${issue.title} (${event.from} → ${event.to})`,
    })
    await add(issue.assignee, build)
    await add(issue.reporter, build)
    const watchers = await all('SELECT user_email FROM watchers WHERE issue_id = ?', [issue.id])
    for (const w of watchers || []) await add(w.user_email, build)
  }
  return out
}

async function deliver(issue, recipients, actorEmail) {
  for (const r of recipients) {
    await createNotification({
      recipientEmail: r.member.email,
      type: r.type,
      title: r.title,
      message: r.message,
      issueId: issue.id,
      projectId: issue.project_id ?? null,
      actorEmail,
      link: linkFor(issue),
    })
  }
}

async function notifyOne(issueId, event, actorEmail) {
  try {
    const issue = await loadIssue(issueId)
    if (!issue) return
    await deliver(issue, await recipientsFor(issue, event, actorEmail), actorEmail)
  } catch (err) {
    console.error(`[issueNotifications] ${event.kind} on issue ${issueId} failed: ${err.message}`)
  }
}

/** A new issue (create, sub-task, clone). */
export function notifyIssueCreated({ issueId, actorEmail }) {
  return notifyOne(issueId, { kind: 'created' }, actorEmail)
}

/**
 * The assignee field was written. Silent when it still names the same person —
 * "jane@x.com" replaced by "Jane" (or a re-save) is not a new assignment.
 */
export async function notifyIssueAssigned({ issueId, previousAssignee, actorEmail }) {
  try {
    const issue = await loadIssue(issueId)
    if (!issue || !(await isNewAssignee(previousAssignee, issue.assignee))) return
    await deliver(issue, await recipientsFor(issue, { kind: 'assigned' }, actorEmail), actorEmail)
  } catch (err) {
    console.error(`[issueNotifications] assigned on issue ${issueId} failed: ${err.message}`)
  }
}

/** The issue moved from one status to another. Silent when nothing moved. */
export function notifyStatusChanged({ issueId, fromStatus, toStatus, actorEmail }) {
  if (!toStatus || fromStatus === toStatus) return Promise.resolve()
  return notifyOne(issueId, { kind: 'status', from: fromStatus, to: toStatus }, actorEmail)
}

async function isNewAssignee(previous, current) {
  if (!lower(current)) return false
  if (lower(previous) === lower(current)) return false
  const [a, b] = await Promise.all([resolveMember(previous), resolveMember(current)])
  return !(a && b && a.id === b.id)
}

/**
 * A bulk edit. `changes` is [{ issueId, assignee?: { from }, status?: { from, to } }].
 * Each recipient gets ONE message per notification type, listing every issue,
 * rather than one email per issue — 50 issues bulk-assigned to someone is one
 * email, not 50.
 */
export async function notifyBulkChanges({ changes, actorEmail }) {
  try {
    const groups = new Map() // `${email}|${type}` → { member, type, items: [{ issue, r }] }
    for (const change of changes || []) {
      const issue = await loadIssue(change.issueId)
      if (!issue) continue
      const recipients = []
      if (change.assignee && (await isNewAssignee(change.assignee.from, issue.assignee))) {
        recipients.push(...(await recipientsFor(issue, { kind: 'assigned' }, actorEmail)))
      }
      if (change.status && change.status.from !== change.status.to) {
        recipients.push(...(await recipientsFor(issue, { kind: 'status', ...change.status }, actorEmail)))
      }
      for (const r of recipients) {
        const k = `${lower(r.member.email)}|${r.type}`
        if (!groups.has(k)) groups.set(k, { member: r.member, type: r.type, items: [] })
        groups.get(k).items.push({ issue, r })
      }
    }

    const actor = await displayName(actorEmail)
    for (const g of groups.values()) {
      if (g.items.length === 1) {
        const { issue, r } = g.items[0]
        await deliver(issue, [r], actorEmail)
        continue
      }
      const n = g.items.length
      const title = g.type === 'issue_assigned'
        ? `${n} issues assigned to you`
        : `${n} issues changed status`
      const shown = g.items.slice(0, SUMMARY_LIST_MAX).map(({ r }) => `• ${r.line}`)
      if (n > SUMMARY_LIST_MAX) shown.push(`…and ${n - SUMMARY_LIST_MAX} more`)
      await createNotification({
        recipientEmail: g.member.email,
        type: g.type,
        title,
        message: [`${actor} updated these issues in one bulk change:`, ...shown].join('\n'),
        issueId: null,
        projectId: null,
        actorEmail,
        link: null,
      })
    }
  } catch (err) {
    console.error(`[issueNotifications] bulk change failed: ${err.message}`)
  }
}
