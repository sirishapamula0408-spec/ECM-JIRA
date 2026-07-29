// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module so no live DB is touched (matches other __tests__ suites).
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

// Keep the real buildDigestEmail (pure template) but stub sendMail so no email
// is actually delivered and we can assert on delivery.
vi.mock('../utils/mailer.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, sendMail: vi.fn(async () => ({ ok: true, accepted: [] })) }
})

import { all, run } from '../db.js'
import { sendMail, buildDigestEmail } from '../utils/mailer.js'
import { isDigestDue, dueDigestPrefs, cadenceMs, runDigests } from '../services/notificationDigest.js'

const NOW = new Date('2026-07-27T09:00:00.000Z')

function pref(overrides = {}) {
  return { user_email: 'user@example.com', email_digest: 'daily', last_digest_sent_at: null, ...overrides }
}

// Route `all(sql, params)` to prefs vs notifications based on the SQL text so a
// single mock can serve the whole runner.
function wireDb({ prefs = [], notificationsByUser = {} } = {}) {
  all.mockImplementation(async (sql, params) => {
    if (/FROM notification_preferences/i.test(sql)) return prefs
    if (/FROM notifications/i.test(sql)) {
      const email = params[0]
      return notificationsByUser[email] || []
    }
    return []
  })
  run.mockImplementation(async () => ({ changes: 1 }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isDigestDue (pure)', () => {
  it('is due when the user has never received a digest', () => {
    expect(isDigestDue(pref({ email_digest: 'daily', last_digest_sent_at: null }), NOW)).toBe(true)
    expect(isDigestDue(pref({ email_digest: 'weekly', last_digest_sent_at: null }), NOW)).toBe(true)
  })

  it('is not due for off users', () => {
    expect(isDigestDue(pref({ email_digest: 'off', last_digest_sent_at: null }), NOW)).toBe(false)
  })

  it('respects the daily cadence', () => {
    const justSent = new Date(NOW.getTime() - 60 * 1000).toISOString() // 1 min ago
    const yesterday = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString() // 25h ago
    expect(isDigestDue(pref({ email_digest: 'daily', last_digest_sent_at: justSent }), NOW)).toBe(false)
    expect(isDigestDue(pref({ email_digest: 'daily', last_digest_sent_at: yesterday }), NOW)).toBe(true)
  })

  it('respects the weekly cadence', () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * cadenceMs('daily')).toISOString()
    const eightDaysAgo = new Date(NOW.getTime() - 8 * cadenceMs('daily')).toISOString()
    expect(isDigestDue(pref({ email_digest: 'weekly', last_digest_sent_at: threeDaysAgo }), NOW)).toBe(false)
    expect(isDigestDue(pref({ email_digest: 'weekly', last_digest_sent_at: eightDaysAgo }), NOW)).toBe(true)
  })

  it('filters a batch to only due prefs', () => {
    const list = [
      pref({ user_email: 'a@x.com', email_digest: 'daily', last_digest_sent_at: null }),
      pref({ user_email: 'b@x.com', email_digest: 'off' }),
      pref({ user_email: 'c@x.com', email_digest: 'daily', last_digest_sent_at: new Date(NOW.getTime() - 1000).toISOString() }),
    ]
    expect(dueDigestPrefs(list, NOW).map((p) => p.user_email)).toEqual(['a@x.com'])
  })
})

describe('buildDigestEmail (pure)', () => {
  it('summarises and lists the notifications', () => {
    const notifications = [
      { title: 'Issue ABC-1 assigned to you', message: 'by Dana' },
      { title: 'New comment on ABC-2', message: '' },
    ]
    const { subject, html, text } = buildDigestEmail({ recipientEmail: 'me@x.com', notifications, appUrl: 'https://app.test' })
    expect(subject).toContain('2 unread')
    expect(html).toContain('Issue ABC-1 assigned to you')
    expect(html).toContain('New comment on ABC-2')
    expect(html).toContain('https://app.test')
    expect(text).toContain('Issue ABC-1 assigned to you')
    expect(text).toContain('New comment on ABC-2')
  })

  it('uses singular wording for a single notification', () => {
    const { subject } = buildDigestEmail({ recipientEmail: 'me@x.com', notifications: [{ title: 'One' }] })
    expect(subject).toContain('1 unread notification')
    expect(subject).not.toContain('notifications')
  })
})

describe('runDigests', () => {
  it('sends ONE digest email to a due daily user with unread notifications', async () => {
    wireDb({
      prefs: [pref({ user_email: 'a@x.com', email_digest: 'daily', last_digest_sent_at: null })],
      notificationsByUser: {
        'a@x.com': [
          { id: 1, title: 'First', message: 'm1', created_at: '2026-07-27T08:00:00Z' },
          { id: 2, title: 'Second', message: 'm2', created_at: '2026-07-27T08:30:00Z' },
        ],
      },
    })

    const sent = await runDigests(NOW)

    expect(sent).toBe(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
    const arg = sendMail.mock.calls[0][0]
    expect(arg.to).toBe('a@x.com')
    // The single email lists both notifications.
    expect(arg.html).toContain('First')
    expect(arg.html).toContain('Second')
    // Watermark advanced.
    const updateCall = run.mock.calls.find(([sql]) => /UPDATE notification_preferences SET last_digest_sent_at/i.test(sql))
    expect(updateCall).toBeTruthy()
    expect(updateCall[1]).toEqual([NOW.toISOString(), 'a@x.com'])
  })

  it('skips off users (no email, no watermark update)', async () => {
    // 'off' users are excluded by the SQL filter, but the runner also guards via
    // isDigestDue — simulate one leaking through to prove the guard.
    wireDb({
      prefs: [pref({ user_email: 'off@x.com', email_digest: 'off', last_digest_sent_at: null })],
      notificationsByUser: { 'off@x.com': [{ id: 9, title: 'Nope' }] },
    })

    const sent = await runDigests(NOW)

    expect(sent).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('does not send when a due user has no unread notifications', async () => {
    wireDb({
      prefs: [pref({ user_email: 'a@x.com', email_digest: 'daily', last_digest_sent_at: null })],
      notificationsByUser: { 'a@x.com': [] },
    })

    const sent = await runDigests(NOW)

    expect(sent).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
    // No watermark advance when nothing was sent.
    const updateCall = run.mock.calls.find(([sql]) => /UPDATE notification_preferences/i.test(sql))
    expect(updateCall).toBeFalsy()
  })

  it('is idempotent — a second run within cadence with no new notifications sends nothing', async () => {
    const justSent = new Date(NOW.getTime() - 60 * 1000).toISOString() // 1 min ago
    wireDb({
      prefs: [pref({ user_email: 'a@x.com', email_digest: 'daily', last_digest_sent_at: justSent })],
      notificationsByUser: { 'a@x.com': [{ id: 1, title: 'Old' }] },
    })

    const sent = await runDigests(NOW)

    // Cadence not elapsed -> not due -> the notifications query is never even run.
    expect(sent).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('selects only unread notifications after the watermark and up to now', async () => {
    const watermark = '2026-07-26T09:00:00Z'
    wireDb({
      prefs: [pref({ user_email: 'a@x.com', email_digest: 'daily', last_digest_sent_at: watermark })],
      notificationsByUser: { 'a@x.com': [{ id: 5, title: 'Fresh' }] },
    })

    await runDigests(NOW)

    // Assert the notifications query passed the watermark + now bounds.
    const notifCall = all.mock.calls.find(([sql]) => /FROM notifications/i.test(sql))
    expect(notifCall).toBeTruthy()
    const [, params] = notifCall
    expect(params[0]).toBe('a@x.com')
    expect(params[1]).toBe(watermark) // "? IS NULL"
    expect(params[2]).toBe(watermark) // "created_at > ?"
    expect(params[3]).toBe(NOW.toISOString()) // "created_at <= ?"
  })
})
