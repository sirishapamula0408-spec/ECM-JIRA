import { all, get, run } from '../db.js'
import { createNotification } from '../routes/notifications.js'

export const TRIGGER_TYPES = ['status_changed', 'comment_added']
export const ACTION_TYPES = ['assign', 'transition', 'comment', 'notify']

async function logExecution(ruleId, issueId, status, message) {
  await run(
    'INSERT INTO automation_logs (rule_id, issue_id, status, message) VALUES (?, ?, ?, ?)',
    [ruleId, issueId, status, message],
  )
}

// Execute a single rule's action against an issue. Actions apply directly to the
// DB and never re-invoke the engine, so a "transition" action can't cause a loop.
async function executeAction(rule, issue) {
  const value = rule.action_value || ''
  switch (rule.action_type) {
    case 'assign':
      await run('UPDATE issues SET assignee = ? WHERE id = ?', [value, issue.id])
      return `Assigned ${issue.issue_key || issue.id} to ${value}`
    case 'transition':
      await run('UPDATE issues SET status = ? WHERE id = ?', [value, issue.id])
      return `Transitioned ${issue.issue_key || issue.id} to ${value}`
    case 'comment':
      await run('INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)', [issue.id, 'Automation', value])
      return `Added automated comment`
    case 'notify':
      if (issue.assignee) {
        await createNotification({
          recipientEmail: value || issue.assignee,
          type: 'automation',
          title: `Automation: ${rule.name}`,
          message: value || `Rule "${rule.name}" fired on ${issue.issue_key || issue.id}`,
          issueId: issue.id,
          projectId: issue.project_id,
        })
      }
      return `Notified ${value || issue.assignee}`
    default:
      throw new Error(`Unknown action type: ${rule.action_type}`)
  }
}

async function runRules(triggerType, issue, matches) {
  if (!issue?.project_id) return
  const rules = await all(
    'SELECT * FROM automation_rules WHERE project_id = ? AND trigger_type = ? AND enabled = TRUE',
    [issue.project_id, triggerType],
  )
  for (const rule of rules) {
    if (!matches(rule)) continue
    try {
      const message = await executeAction(rule, issue)
      await logExecution(rule.id, issue.id, 'success', message)
    } catch (err) {
      await logExecution(rule.id, issue.id, 'failure', err.message || 'Action failed')
    }
  }
}

// Fired after a status change. condition_value empty = any status; else must equal new status.
export async function runStatusChangeAutomations(issue) {
  await runRules('status_changed', issue, (rule) => !rule.condition_value || rule.condition_value === issue.status)
}

// Fired after a comment is added. condition_value optional substring filter on comment text.
export async function runCommentAutomations(issue, commentText = '') {
  await runRules('comment_added', issue, (rule) => !rule.condition_value || commentText.toLowerCase().includes(rule.condition_value.toLowerCase()))
}
