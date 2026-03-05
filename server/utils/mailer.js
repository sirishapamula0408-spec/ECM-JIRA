import nodemailer from 'nodemailer'

let transporter = null

function getTransporter() {
  if (transporter) return transporter

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT) || 587
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    console.warn('[Mailer] SMTP not configured — emails will be logged to console.')
    return null
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })

  return transporter
}

export async function sendMail({ to, subject, html, text }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@ecm-jira.local'
  const transport = getTransporter()

  if (!transport) {
    // Fallback: log to console so the dev can verify it works
    console.log('─────────────────────────────────────────')
    console.log('[Mailer] Email (console fallback)')
    console.log(`  To:      ${to}`)
    console.log(`  Subject: ${subject}`)
    console.log(`  Body:    ${text || '(HTML only)'}`)
    console.log('─────────────────────────────────────────')
    return { accepted: [to], messageId: 'console-fallback' }
  }

  const info = await transport.sendMail({ from, to, subject, html, text })
  console.log(`[Mailer] Sent to ${to} — messageId: ${info.messageId}`)
  return info
}

export function buildInviteEmail({ recipientName, invitedBy, role, appUrl }) {
  const url = appUrl || process.env.APP_URL || 'http://localhost:5173'
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
