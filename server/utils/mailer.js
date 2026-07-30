import nodemailer from 'nodemailer'
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL } from '../config.js'

let transporter = null

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
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string, messageId?: string, accepted?: string[] }>}
 */
export async function sendMail({ to, subject, html, text }) {
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
    return { ok: false, skipped: true, accepted: [to], messageId: 'console-fallback' }
  }

  try {
    const info = await transport.sendMail({ from, to, subject, html, text })
    console.log(`[Mailer] Sent to ${to} — messageId: ${info.messageId}`)
    return { ok: true, messageId: info.messageId, accepted: info.accepted }
  } catch (err) {
    // Never throw from the mailer — email is best-effort.
    console.error(`[Mailer] Failed to send to ${to}: ${err.message}`)
    return { ok: false, error: err.message }
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
 *
 * @param {object} args
 * @param {string} args.recipientEmail
 * @param {Array<{ title?: string, message?: string, type?: string }>} args.notifications
 * @param {string} [args.appUrl]
 * @returns {{ subject: string, html: string, text: string }}
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
