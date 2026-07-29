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
    expect(arg.html).toContain('New comment on JL-1')
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

  it('does NOT send when the user has no preferences row (default off)', async () => {
    get.mockResolvedValue(null)

    await createNotification({ ...base })
    await flush()

    expect(run).toHaveBeenCalledTimes(1) // still inserted
    expect(sendMail).not.toHaveBeenCalled()
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
  it('produces subject/html/text with the title, message and actor', () => {
    const out = buildNotificationEmail({
      title: 'Assigned to you',
      message: 'JL-9 was assigned',
      type: 'assignment',
      actorEmail: 'boss@test.com',
      appUrl: 'https://example.test',
    })
    expect(out.subject).toContain('Assigned to you')
    expect(out.html).toContain('Assigned to you')
    expect(out.html).toContain('JL-9 was assigned')
    expect(out.html).toContain('boss@test.com')
    expect(out.html).toContain('https://example.test')
    expect(out.text).toContain('Assigned to you')
  })
})
