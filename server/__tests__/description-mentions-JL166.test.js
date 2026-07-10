import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  get: vi.fn(),
  run: vi.fn(),
  all: vi.fn(),
}))
vi.mock('../routes/notifications.js', () => ({
  createNotification: vi.fn(),
}))

import { extractMentions, processMentions } from '../services/mentions.js'
import { get, run } from '../db.js'
import { createNotification } from '../routes/notifications.js'

describe('extractMentions (JL-166)', () => {
  it('extracts unique @emails and ignores non-email @tokens', () => {
    expect(
      extractMentions('hi @a@x.com and @b@x.com and again @a@x.com plus @notanemail'),
    ).toEqual(['a@x.com', 'b@x.com'])
  })

  it('returns [] for empty / undefined / no-mention text', () => {
    expect(extractMentions('')).toEqual([])
    expect(extractMentions(undefined)).toEqual([])
    expect(extractMentions('no mentions here')).toEqual([])
  })
})

describe('processMentions — issue description mentions (JL-166)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a mention + notification per existing member, skips unknown emails, dedups', async () => {
    get.mockImplementation((sql, params) => {
      if (/FROM issues/.test(sql)) return Promise.resolve({ issue_key: 'VER-1', project_id: 7 })
      if (/FROM members/.test(sql)) {
        // only a@x.com is a real member; b@x.com is unknown
        return Promise.resolve(params[0] === 'a@x.com' ? { email: 'a@x.com' } : null)
      }
      return Promise.resolve(null)
    })
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const notified = await processMentions({
      text: 'ping @a@x.com and @b@x.com and @a@x.com',
      issueId: 42,
      actorEmail: 'me@x.com',
      requireMember: true,
    })

    // b@x.com unknown → skipped; a@x.com deduped to a single notify
    expect(notified).toEqual(['a@x.com'])
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO mentions'),
      [null, 42, 'a@x.com'],
    )
    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'a@x.com',
        type: 'mention',
        issueId: 42,
        projectId: 7,
        actorEmail: 'me@x.com',
      }),
    )
  })

  it('does nothing and returns [] when the text has no mentions', async () => {
    const notified = await processMentions({
      text: 'a plain description',
      issueId: 1,
      actorEmail: 'me@x.com',
      requireMember: true,
    })
    expect(notified).toEqual([])
    expect(run).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })
})
