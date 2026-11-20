// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db so createNotification's INSERT + preference lookup are controllable.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

// Mock the mailer so nothing hits the network and we can assert on sendMail.
vi.mock('../utils/mailer.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    sendMail: vi.fn().mockResolvedValue({ ok: true, messageId: 'test' }),
  }
})

import { run, get } from '../db.js'
import { sendMail, buildNotificationEmail } from '../utils/mailer.js'
import { createNotification } from '../routes/notifications.js'

// createNotification fires the email as a fire-and-forget promise. Yield to the
// microtask/event queue so that promise settles before we assert on sendMail.
const flush = () => new Promise((resolve) => setImmediate(resolve))

const base = {
  recipientEmail: 'recipient@test.com',
  type: 'comment',
  title: 'New comment on JL-1',
  message: 'Someone commented',
  actorEmail: 'actor@test.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  run.mockResolvedValue({ lastID: 42, changes: 1 })
})

describe('JL-302 — pref-gated notification email delivery', () => {
  it('sends email when email_enabled=true, digest=off, and type is not muted', async () => {
    get.mockResolvedValue({ email_enabled: true, email_digest: 'off', muted_types: [] })

    const id = await createNotification({ ...base })
    await flush()

    expect(id).toBe(42)
    expect(run).toHaveBeenCalledTimes(1) // notification still inserted
    expect(sendMail).toHaveBeenCalledTimes(1)
    const arg = sendMail.mock.calls[0][0]
    expect(arg.to).toBe('recipient@test.com')
    expect(arg.subject).toContain('New comment on JL-1')
    expect(arg.text).toContain('New comment on JL-1')
    expect(arg.html).toBeUndefined() // plain text only
  })

  it('treats missing muted_types digest default as off (null digest still sends)', async () => {
    get.mockResolvedValue({ email_enabled: true, email_digest: null, muted_types: [] })

    await createNotification({ ...base })
    await flush()

    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('does NOT send when email is disabled', async () => {
    get.mockResolvedValue({ email_enabled: false, email_digest: 'off', muted_types: [] })

    await createNotification({ ...base })
    await flush()

    expect(run).toHaveBeenCalledTimes(1) // still inserted
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('does NOT send when the notification type is muted', async () => {
    get.mockResolvedValue({ email_enabled: true, email_digest: 'off', muted_types: ['comment'] })

    await createNotification({ ...base })
    await flush()

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('parses muted_types when stored as a JSON string', async () => {
    get.mockResolvedValue({ email_enabled: true, email_digest: 'off', muted_types: '["comment"]' })

    await createNotification({ ...base })
    await flush()

    expect(sendMail).not.toHaveBeenCalled()
  })

  // Changed with issue email notifications: email is ON by default, as in Jira.
  // It used to be off, so almost nobody received a notification email.
  it('sends when the user has no preferences row (email is on by default)', async () => {
    get.mockResolvedValue(null)

    await createNotification({ ...base })
    await flush()

    expect(run).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0].to).toBe('recipient@test.com')
  })

  it('skips self-notifications regardless of letter case', async () => {
    get.mockResolvedValue(null)

    const id = await createNotification({ ...base, recipientEmail: 'Actor@Test.com' })
    await flush()

    expect(id).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('points the email button at the issue when a link is given', async () => {
    get.mockResolvedValue(null)

    await createNotification({ ...base, link: '/browse/JL-1' })
    await flush()

    const arg = sendMail.mock.calls[0][0]
    expect(arg.text).toContain('/browse/JL-1')
  })

  it('does NOT send an immediate email when digest is daily (handled by JL-303)', async () => {
    get.mockResolvedValue({ email_enabled: true, email_digest: 'daily', muted_types: [] })

    await createNotification({ ...base })
    await flush()

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('does NOT send an immediate email when digest is weekly', async () => {
    get.mockResolvedValue({ email_enabled: true, email_digest: 'weekly', muted_types: [] })

    await createNotification({ ...base })
    await flush()

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('skips self-notifications entirely (no insert, no email)', async () => {
    get.mockResolvedValue({ email_enabled: true, email_digest: 'off', muted_types: [] })

    const id = await createNotification({ ...base, recipientEmail: 'actor@test.com' })
    await flush()

    expect(id).toBeNull()
    expect(run).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('never lets an email failure break the notification insert', async () => {
    get.mockResolvedValue({ email_enabled: true, email_digest: 'off', muted_types: [] })
    sendMail.mockRejectedValueOnce(new Error('smtp down'))

    // Should resolve normally despite the mailer rejecting.
    const id = await createNotification({ ...base })
    await flush()

    expect(id).toBe(42)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('JL-302 — buildNotificationEmail template', () => {
  it('is plain text only — no HTML part, so no styling', () => {
    const out = buildNotificationEmail({
      title: 'PROJ-9 assigned to you: Login fails',
      message: 'Alice assigned this bug to you.\nStatus: To Do · Priority: High',
      appUrl: 'https://example.test',
      link: '/browse/PROJ-9',
    })
    expect(out.html).toBeUndefined()
    expect(Object.keys(out).sort()).toEqual(['subject', 'text'])
    expect(out.subject).toBe('PROJ-9 assigned to you: Login fails')
    expect(out.text).toBe([
      'PROJ-9 assigned to you: Login fails',
      '',
      'Alice assigned this bug to you.',
      'Status: To Do · Priority: High',
      '',
      'View issue: https://example.test/browse/PROJ-9',
      '',
      '--',
      "You're receiving this because email notifications are on. Change them in your profile: https://example.test/profile",
    ].join('\n'))
  })

  it('carries user-typed text verbatim — plain text cannot render markup', () => {
    const out = buildNotificationEmail({ title: 'PROJ-1: <img src=x onerror=alert(1)>', appUrl: 'https://example.test' })
    expect(out.text).toContain('<img src=x onerror=alert(1)>')
    expect(out.subject).toBe('PROJ-1: <img src=x onerror=alert(1)>')
  })

  it('links to the issue, and only ever to a path inside the app', () => {
    const issue = buildNotificationEmail({ title: 't', appUrl: 'https://example.test/', link: '/browse/PROJ-12' })
    expect(issue.text).toContain('View issue: https://example.test/browse/PROJ-12')

    for (const link of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)']) {
      const out = buildNotificationEmail({ title: 't', appUrl: 'https://example.test', link })
      expect(out.text).toContain('Open ECM-JIRA: https://example.test\n')
      expect(out.text).not.toContain('evil.example')
      expect(out.text).not.toContain('javascript:')
    }
  })

  it('keeps line breaks out of the subject header', () => {
    const out = buildNotificationEmail({ title: 'a\r\nBcc: x@evil.example' })
    expect(out.subject).not.toMatch(/[\r\n]/)
  })
})
