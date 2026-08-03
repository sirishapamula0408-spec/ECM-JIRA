import nodemailer from 'nodemailer'
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL } from '../config.js'
import { run, all } from '../db.js'

let transporter = null

/**
 * JL-323: Persist the outcome of one send attempt to `email_log`.
 *
 * Best-effort by design: logging must never turn a mail problem into a request
 * failure, so every error here is swallowed after being reported to stderr. A
 * missing row is strictly less bad than a 500 on an invite.
 */
async function recordEmailAttempt({ to, subject, type, relatedEntity, status, messageId, error }) {
  try {
    await run(
      `INSERT INTO email_log (recipient, subject, email_type, related_entity, status, message_id, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(to || ''),
        subject == null ? null : String(subject),
        type || 'other',
        relatedEntity == null ? null : String(relatedEntity),
        status,
        messageId == null ? null : String(messageId),
        error == null ? null : String(error),
      ],
    )
  } catch (err) {
    console.error(`[Mailer] Could not write email_log row for ${to}: ${err.message}`)
  }
}

/**
 * Returns true when the minimum SMTP settings (host + credentials) are present.
 * When false, sendMail() no-ops gracefully instead of attempting delivery.
 * JL-305: same predicate as config.isMailConfigured(), applied to the SMTP_*
 * values imported from config.js (kept local so tests can mock config.js with
 * a plain settings object).
 */
export function isSmtpConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS)
}

function getTransporter() {
  if (transporter) return transporter

  if (!isSmtpConfigured()) {
    return null
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })

  return transporter
}

/**
 * Send a transactional email. Never throws — on any failure (or when SMTP is
 * not configured) it logs and returns a result object with a `skipped`/`error`
 * flag so callers can fire-and-forget without crashing the request.
 *
 * JL-323: every outcome is also written to `email_log`, so delivery is
 * auditable after the fact. Because this function does not throw, callers MUST
 * inspect the returned `ok` flag — a `.catch()` on the promise will not fire on
 * an SMTP rejection.
 *
 * @param {object}  opts
 * @param {string}  opts.to             Recipient address.
 * @param {string}  opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {string} [opts.type]          Categorises the log row: 'invite',
 *                                      'password_reset', 'notification',
 *                                      'digest'. Defaults to 'other'.
 * @param {string} [opts.relatedEntity] Free-form back-reference for the log row,
 *                                      e.g. `invitation:42` or `member:7`.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string, messageId?: string, accepted?: string[] }>}
 */
export async function sendMail({ to, subject, html, text, type, relatedEntity }) {
  const from = SMTP_FROM
  const transport = getTransporter()

  if (!transport) {
    // Graceful no-op: log to console so devs can still verify the flow.
    console.log('─────────────────────────────────────────')
    console.log('[Mailer] SMTP not configured — email not sent (console fallback)')
    console.log(`  To:      ${to}`)
    console.log(`  Subject: ${subject}`)
    console.log(`  Body:    ${text || '(HTML only)'}`)
    console.log('─────────────────────────────────────────')
    await recordEmailAttempt({
      to, subject, type, relatedEntity,
      status: 'skipped',
      error: 'SMTP not configured',
    })
    return { ok: false, skipped: true, accepted: [to], messageId: 'console-fallback' }
  }

  try {
    const info = await transport.sendMail({ from, to, subject, html, text })
    console.log(`[Mailer] Sent to ${to} — messageId: ${info.messageId}`)
    await recordEmailAttempt({
      to, subject, type, relatedEntity,
      status: 'sent',
      messageId: info.messageId,
    })
    return { ok: true, messageId: info.messageId, accepted: info.accepted }
  } catch (err) {
    // Never throw from the mailer — email is best-effort.
    console.error(`[Mailer] Failed to send to ${to}: ${err.message}`)
    await recordEmailAttempt({
      to, subject, type, relatedEntity,
      status: 'failed',
      error: err.message,
    })
    return { ok: false, error: err.message }
  }
}

/**
 * JL-323: Most recent delivery attempt per recipient, for a batch of addresses.
 * Returns a Map keyed by lower-cased email so list endpoints can decorate rows
 * without an N+1 query. Best-effort — returns an empty Map on any error.
 */
export async function getLatestEmailStatuses(emails = []) {
  const list = [...new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase()))]
  if (!list.length) return new Map()

  try {
    const placeholders = list.map(() => '?').join(', ')
    const rows = await all(
      `SELECT DISTINCT ON (LOWER(recipient))
              LOWER(recipient) AS recipient, status, error, message_id, created_at
         FROM email_log
        WHERE LOWER(recipient) IN (${placeholders})
        ORDER BY LOWER(recipient), created_at DESC, id DESC`,
      list,
    )
    return new Map(rows.map((r) => [r.recipient, r]))
  } catch (err) {
    console.error(`[Mailer] Could not read email_log statuses: ${err.message}`)
    return new Map()
  }
}

/**
 * JL-304: Verify SMTP connectivity using nodemailer's transporter.verify().
 * Never throws — returns a structured result so callers (e.g. an admin
 * "test connection" endpoint) can report status without crashing.
 *
 * @returns {Promise<{ configured: boolean, ok: boolean, error?: string }>}
 *   - configured:false → SMTP env unset (console-fallback mode); ok is false.
 *   - configured:true, ok:true  → transporter.verify() succeeded.
 *   - configured:true, ok:false → verify() failed; `error` carries the reason.
 */
export async function verifyMailer() {
  if (!isSmtpConfigured()) {
    return { configured: false, ok: false }
  }

  const transport = getTransporter()
  if (!transport) {
    return { configured: false, ok: false }
  }

  try {
    await transport.verify()
    return { configured: true, ok: true }
  } catch (err) {
    return { configured: true, ok: false, error: err.message }
  }
}

/**
 * Build the password-reset email (subject/html/text) for a given reset token.
 */
export function buildPasswordResetEmail({ token, appUrl }) {
  const base = appUrl || APP_URL || 'http://localhost:5173'
  const resetUrl = `${base.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`
  const subject = 'Reset your ECM-JIRA password'

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#172b4d;">
      <div style="text-align:center;margin-bottom:28px;">
        <h2 style="margin:0 0 4px;font-size:20px;color:#0052cc;">ECM-JIRA</h2>
        <p style="margin:0;font-size:12px;color:#6b778c;">Project Management Platform</p>
      </div>
      <p style="font-size:14px;line-height:1.6;">We received a request to reset your password.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${resetUrl}" style="display:inline-block;padding:12px 32px;background:#0052cc;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Reset Password</a>
      </div>
      <p style="font-size:13px;line-height:1.6;color:#6b778c;">This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #dfe1e6;margin:24px 0;" />
      <p style="font-size:11px;color:#97a0af;text-align:center;">If the button doesn't work, paste this link into your browser:<br />${resetUrl}</p>
    </div>
  `

  const text = `We received a request to reset your ECM-JIRA password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 15 minutes. If you didn't request this, you can safely ignore this email.`

  return { subject, html, text }
}

export function buildInviteEmail({ recipientName, invitedBy, role, appUrl }) {
  // JL-305: read APP_URL from config.js — no direct process.env access here.
  const url = appUrl || APP_URL || 'http://localhost:5173'
  const subject = `You've been invited to join ECM-JIRA`

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#172b4d;">
      <div style="text-align:center;margin-bottom:28px;">
        <h2 style="margin:0 0 4px;font-size:20px;color:#0052cc;">ECM-JIRA</h2>
        <p style="margin:0;font-size:12px;color:#6b778c;">Project Management Platform</p>
      </div>
      <p style="font-size:14px;line-height:1.6;">Hi <strong>${recipientName}</strong>,</p>
      <p style="font-size:14px;line-height:1.6;"><strong>${invitedBy}</strong> has invited you to join the team on <strong>ECM-JIRA</strong> as a <strong>${role}</strong>.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${url}" style="display:inline-block;padding:12px 32px;background:#0052cc;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Accept Invitation</a>
      </div>
      <p style="font-size:13px;line-height:1.6;color:#6b778c;">Once you accept, you'll be able to collaborate on projects, track issues, and manage sprints with your team.</p>
      <hr style="border:none;border-top:1px solid #dfe1e6;margin:24px 0;" />
      <p style="font-size:11px;color:#97a0af;text-align:center;">This invitation was sent by ${invitedBy}. If you weren't expecting this, you can safely ignore this email.</p>
    </div>
  `

  const text = `Hi ${recipientName},\n\n${invitedBy} has invited you to join ECM-JIRA as a ${role}.\n\nAccept your invitation: ${url}\n\nIf you weren't expecting this, you can safely ignore this email.`

  return { subject, html, text }
}

// Minimal HTML escaping so notification titles/messages can't break the markup.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * JL-303: Build a single digest email summarising a batch of unread
 * notifications for one recipient. Follows the buildInviteEmail style.
 */
export function buildDigestEmail({ recipientEmail, notifications = [], appUrl }) {
  const url = appUrl || APP_URL || 'http://localhost:5173'
  const count = notifications.length
  const noun = count === 1 ? 'notification' : 'notifications'
  const subject = `ECM-JIRA: ${count} unread ${noun}`

  const rows = notifications
    .map((n) => {
      const title = escapeHtml(n.title || 'Notification')
      const message = n.message ? `<p style="margin:4px 0 0;font-size:13px;line-height:1.5;color:#6b778c;">${escapeHtml(n.message)}</p>` : ''
      return `
        <li style="list-style:none;padding:12px 0;border-bottom:1px solid #dfe1e6;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#172b4d;">${title}</p>
          ${message}
        </li>`
    })
    .join('')

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#172b4d;">
      <div style="text-align:center;margin-bottom:28px;">
        <h2 style="margin:0 0 4px;font-size:20px;color:#0052cc;">ECM-JIRA</h2>
        <p style="margin:0;font-size:12px;color:#6b778c;">Project Management Platform</p>
      </div>
      <p style="font-size:14px;line-height:1.6;">You have <strong>${count}</strong> unread ${noun} waiting for you.</p>
      <ul style="margin:16px 0;padding:0;">${rows}</ul>
      <div style="text-align:center;margin:28px 0;">
        <a href="${url}" style="display:inline-block;padding:12px 32px;background:#0052cc;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">View in ECM-JIRA</a>
      </div>
      <hr style="border:none;border-top:1px solid #dfe1e6;margin:24px 0;" />
      <p style="font-size:11px;color:#97a0af;text-align:center;">You're receiving this digest because email digests are enabled for ${escapeHtml(recipientEmail)}. Change this in your notification preferences.</p>
    </div>
  `

  const lines = notifications.map((n) => {
    const title = n.title || 'Notification'
    return n.message ? `• ${title} — ${n.message}` : `• ${title}`
  })
  const text = `You have ${count} unread ${noun} on ECM-JIRA:\n\n${lines.join('\n')}\n\nView in ECM-JIRA: ${url}`

  return { subject, html, text }
}

/**
 * Build the in-app notification email (subject/html/text) for a notification
 * that is being mirrored to the recipient's inbox.
 */
export function buildNotificationEmail({ title, message, type, actorEmail, appUrl }) {
  const url = appUrl || APP_URL || 'http://localhost:5173'
  const heading = title || 'New notification'
  const subject = title || 'New notification from ECM-JIRA'
  const actorLine = actorEmail ? `${actorEmail} · ` : ''
  const typeLabel = type ? String(type).replace(/_/g, ' ') : 'notification'

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#172b4d;">
      <div style="text-align:center;margin-bottom:28px;">
        <h2 style="margin:0 0 4px;font-size:20px;color:#0052cc;">ECM-JIRA</h2>
        <p style="margin:0;font-size:12px;color:#6b778c;">Project Management Platform</p>
      </div>
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#6b778c;margin:0 0 6px;">${actorLine}${typeLabel}</p>
      <h3 style="margin:0 0 12px;font-size:16px;color:#172b4d;">${heading}</h3>
      ${message ? `<p style="font-size:14px;line-height:1.6;">${message}</p>` : ''}
      <div style="text-align:center;margin:28px 0;">
        <a href="${url}" style="display:inline-block;padding:12px 32px;background:#0052cc;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">View in ECM-JIRA</a>
      </div>
      <hr style="border:none;border-top:1px solid #dfe1e6;margin:24px 0;" />
      <p style="font-size:11px;color:#97a0af;text-align:center;">You're receiving this because email notifications are enabled. You can change this in your notification preferences.</p>
    </div>
  `

  const text = `${actorLine}${typeLabel}\n${heading}${message ? `\n\n${message}` : ''}\n\nView in ECM-JIRA: ${url}\n\nYou're receiving this because email notifications are enabled. You can change this in your notification preferences.`

  return { subject, html, text }
}
