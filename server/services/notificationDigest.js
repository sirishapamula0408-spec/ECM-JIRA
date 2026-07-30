import { all, run } from '../db.js'
import { sendMail, buildDigestEmail } from '../utils/mailer.js'
import { APP_URL } from '../config.js'

// --- JL-303: Daily / weekly email digest of unread notifications ---
// A dependency-free, in-process digest runner driven by the existing scheduler
// (server/services/scheduler.js). Users whose notification_preferences.email_digest
// is 'daily' or 'weekly' receive ONE email batching their unread notifications on
// that cadence; 'off' users get nothing. Idempotency is anchored on
// notification_preferences.last_digest_sent_at — we only select unread
// notifications created after that watermark (and up to `now`), then advance it.

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

function toMs(value) {
  if (value == null) return NaN
  if (value instanceof Date) return value.getTime()
  return new Date(value).getTime()
}

// The minimum interval that must elapse between digests for a given cadence.
export function cadenceMs(digest) {
  if (digest === 'daily') return DAY_MS
  if (digest === 'weekly') return WEEK_MS
  return Infinity
}

// PURE + UNIT-TESTABLE: given one preferences row and the current time, decide
// whether this user is due for a digest. `now` is injected (no wall-clock dep).
// A user is due when their cadence is daily/weekly AND either they have never
// received a digest (last_digest_sent_at is null) or at least one cadence
// interval has elapsed since the last one.
export function isDigestDue(pref, now) {
  if (!pref) return false
  const digest = pref.email_digest
  if (digest !== 'daily' && digest !== 'weekly') return false
  if (!pref.last_digest_sent_at) return true
  const lastMs = toMs(pref.last_digest_sent_at)
  if (!Number.isFinite(lastMs)) return true
  return toMs(now) - lastMs >= cadenceMs(digest)
}

// PURE + UNIT-TESTABLE: filter a list of preference rows down to those due now.
export function dueDigestPrefs(prefs, now) {
  return (prefs || []).filter((pref) => isDigestDue(pref, now))
}

/**
 * Run the digest cycle for every due daily/weekly user.
 *
 * For each due user, select their UNREAD notifications created strictly after
 * their last_digest_sent_at watermark and no later than `now`, send a single
 * digest email, then advance the watermark to `now`. When a user has no new
 * unread notifications, nothing is sent and the watermark is left untouched, so
 * a subsequent run never resends already-digested notifications (idempotent).
 *
 * Each user is guarded independently so one failure can't abort the whole cycle.
 * `now` is injected so tests never depend on real timers/wall-clock.
 *
 * @param {Date|string} [now]
 * @returns {Promise<number>} the number of digest emails actually sent
 */
export async function runDigests(now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now)
  const nowIso = nowDate.toISOString()

  const prefs = await all(
    "SELECT user_email, email_digest, last_digest_sent_at FROM notification_preferences WHERE email_digest IN ('daily', 'weekly')",
    [],
  )

  let sent = 0
  for (const pref of dueDigestPrefs(prefs, nowDate)) {
    try {
      const notifications = await all(
        `SELECT id, type, title, message, issue_id, project_id, created_at
         FROM notifications
         WHERE recipient_email = ?
           AND is_read = FALSE
           AND (? IS NULL OR created_at > ?)
           AND created_at <= ?
         ORDER BY created_at ASC`,
        [pref.user_email, pref.last_digest_sent_at, pref.last_digest_sent_at, nowIso],
      )

      if (!notifications.length) continue

      const { subject, html, text } = buildDigestEmail({
        recipientEmail: pref.user_email,
        notifications,
        appUrl: APP_URL,
      })
      await sendMail({ to: pref.user_email, subject, html, text })

      await run(
        'UPDATE notification_preferences SET last_digest_sent_at = ? WHERE user_email = ?',
        [nowIso, pref.user_email],
      )
      sent += 1
    } catch (err) {
      console.error(`[digest] failed for ${pref.user_email}: ${err.message}`)
    }
  }

  return sent
}
