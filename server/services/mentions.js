import { get, run } from '../db.js'
import { createNotification } from '../routes/notifications.js'

/**
 * Extract @mentions from free text.
 * Matches @email patterns (e.g. `@jane@example.com`) and returns the unique
 * list of mentioned email addresses. Shared by comments (JL-41) and issue
 * descriptions (JL-166) so both use one implementation.
 */
export function extractMentions(text) {
  const mentions = []
  const regex = /@([\w.+-]+@[\w.-]+\.\w+)/g
  let match
  while ((match = regex.exec(String(text || ''))) !== null) {
    mentions.push(match[1])
  }
  return [...new Set(mentions)]
}

/**
 * Handle @mentions found in `text` for a given issue.
 * For each unique mentioned email it inserts a row into the `mentions` table
 * and creates a `mention` notification (createNotification already skips the
 * actor themselves, so nobody is notified about mentioning themselves).
 *
 * @param {object} opts
 * @param {string} opts.text            The text to scan for @mentions.
 * @param {number|null} opts.issueId    The related issue id (for the mention row + notification).
 * @param {string} opts.actorEmail      The email of the user who authored the text.
 * @param {string|null} [opts.actorLabel] Display label for the notification message (defaults to actorEmail).
 * @param {number|null} [opts.commentId]  The related comment id, when the mention came from a comment.
 * @param {boolean} [opts.requireMember]  When true, only mention existing members (skip unknown emails).
 * @returns {Promise<string[]>} the list of emails that were mentioned/notified.
 */
export async function processMentions({
  text,
  issueId = null,
  actorEmail = null,
  actorLabel = null,
  commentId = null,
  requireMember = false,
}) {
  const emails = extractMentions(text)
  if (emails.length === 0) return []

  const issue = issueId != null
    ? await get('SELECT issue_key, project_id FROM issues WHERE id = ?', [issueId])
    : null
  const label = actorLabel || actorEmail || 'Someone'
  const notified = []

  for (const email of emails) {
    if (requireMember) {
      const member = await get('SELECT email FROM members WHERE email = ? LIMIT 1', [email])
      if (!member) continue
    }

    await run(
      'INSERT INTO mentions (comment_id, issue_id, mentioned_email) VALUES (?, ?, ?)',
      [commentId, issueId, email],
    )

    await createNotification({
      recipientEmail: email,
      type: 'mention',
      title: `Mentioned in ${issue?.issue_key || 'an issue'}`,
      message: `${label} mentioned you: "${String(text).slice(0, 100)}"`,
      issueId: issueId ?? null,
      projectId: issue?.project_id || null,
      actorEmail,
    })

    notified.push(email)
  }

  return notified
}
