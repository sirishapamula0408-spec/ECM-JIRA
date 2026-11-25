// JL-488: the release check that runs when a release is marked Released.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ state: null }))
const notify = vi.hoisted(() => vi.fn(async () => 1))

function freshState() {
  return {
    release: { id: 5, name: 'v2.0', project_id: 16, release_date: null, project_name: 'Sixteen' },
    items: [
      { id: 1, issue_key: 'SIX-1', title: 'Shipped', status: 'Done' },
      { id: 2, issue_key: 'SIX-2', title: 'Still open', status: 'In Testing' },
    ],
    comments: [],
    checks: [],
    monitors: [{ email: 'monitor@x.com' }],
  }
}

vi.mock('../db.js', async () => {
  const m = {
  get: vi.fn(async (sql, params) => {
    const s = db.state
    if (sql.includes('FROM releases r JOIN projects')) return params[0] === s.release.id ? s.release : undefined
    if (sql.includes('FROM comments')) {
      return s.comments.find((c) => c.issue_id === params[0] && c.author === params[1] && c.text.startsWith(params[2].replace('%', '')))
    }
    if (sql.includes('FROM release_checks WHERE id')) return s.checks.find((c) => c.id === params[0])
    if (sql.includes('FROM release_checks WHERE release_id')) return s.checks.at(-1)
    throw new Error(`unexpected get: ${sql}`)
  }),
  all: vi.fn(async (sql) => {
    const s = db.state
    if (sql.includes('FROM issues i')) return s.items
    if (sql.includes('FROM project_members pm')) return s.monitors
    throw new Error(`unexpected all: ${sql}`)
  }),
  run: vi.fn(async (sql, params) => {
    const s = db.state
    if (sql.startsWith('INSERT INTO comments')) { s.comments.push({ issue_id: params[0], author: params[1], text: params[2] }); return { lastID: s.comments.length } }
    if (sql.startsWith('INSERT INTO release_checks') && s.failInsert) throw new Error('boom')
    if (sql.startsWith('INSERT INTO release_checks')) {
      const row = { id: s.checks.length + 1, release_id: params[0], checked_by: params[1], total: params[2], passed: params[3], failed: params[4], checked_at: '2026-11-23T10:00:00Z' }
      s.checks.push(row)
      return { lastID: row.id }
    }
    throw new Error(`unexpected run: ${sql}`)
  }),
  }
  // A real transaction: on error, roll back every comment written inside it.
  m.withTransaction = vi.fn(async (fn) => {
    const snapshot = db.state.comments.length
    try { return await fn({ get: m.get, all: m.all, run: m.run }) } catch (e) { db.state.comments.length = snapshot; throw e }
  })
  return m
})
vi.mock('../routes/notifications.js', () => ({ createNotification: notify }))

const { runReleaseCheck, checkMarker, RELEASE_MONITOR_ROLE } = await import('../services/releaseCheck.js')
const { ROLE_RANK } = await import('../middleware/authorize.js')

beforeEach(() => { db.state = freshState(); notify.mockClear() })

describe('runReleaseCheck', () => {
  it('passes Done work items and fails open ones, and stores the result', async () => {
    const check = await runReleaseCheck(5, { actorEmail: 'lead@x.com' })
    expect(check).toMatchObject({ releaseId: 5, total: 2, passed: 1, ok: false, checkedBy: 'lead@x.com' })
    expect(check.failed).toEqual([{ id: 2, key: 'SIX-2', title: 'Still open', status: 'In Testing' }])
  })

  it('comments once on each work item, as Release Monitor, tagged with the release', async () => {
    await runReleaseCheck(5)
    await runReleaseCheck(5) // a re-check must not repeat the comments
    expect(db.state.comments).toHaveLength(2)
    expect(db.state.comments.every((c) => c.author === 'Release Monitor' && c.text.startsWith(checkMarker(5)))).toBe(true)
    expect(db.state.comments[0].text).toMatch(/PASS/)
    expect(db.state.comments[1].text).toMatch(/FAILED.*In Testing/)
    expect(db.state.checks).toHaveLength(2) // but each run is recorded
  })

  it('adds a PASS comment once a failed work item is closed and re-checked', async () => {
    await runReleaseCheck(5)
    db.state.items[1] = { ...db.state.items[1], status: 'Done' }
    const check = await runReleaseCheck(5)
    expect(check.ok).toBe(true)
    const onItem2 = db.state.comments.filter((c) => c.issue_id === 2).map((c) => c.text)
    expect(onItem2).toHaveLength(2)
    expect(onItem2[0]).toMatch(/FAILED/)
    expect(onItem2[1]).toMatch(/PASS/)
  })

  it('sends every Release Monitor one summary that names the open work items', async () => {
    await runReleaseCheck(5, { actorEmail: 'lead@x.com' })
    expect(notify).toHaveBeenCalledTimes(1)
    const n = notify.mock.calls[0][0]
    expect(n).toMatchObject({ recipientEmail: 'monitor@x.com', type: 'release_check', projectId: 16, actorEmail: 'lead@x.com', link: '/projects/16/releases' })
    expect(n.title).toMatch(/FAILED: v2\.0 \(Sixteen\) - 1 of 2 work items still open/)
    expect(n.message).toContain('SIX-2 Still open (In Testing)')
  })

  it('reports a pass when everything is Done', async () => {
    db.state.items = db.state.items.slice(0, 1)
    const check = await runReleaseCheck(5)
    expect(check.ok).toBe(true)
    expect(notify.mock.calls[0][0].title).toMatch(/passed: v2\.0 .* all 1 work items closed/)
  })

  it('counts a Cancelled work item as a pass', async () => {
    db.state.items[1] = { ...db.state.items[1], status: 'Cancelled' }
    const check = await runReleaseCheck(5)
    expect(check).toMatchObject({ total: 2, passed: 2, ok: true })
    expect(db.state.comments.find((c) => c.issue_id === 2).text).toContain('Status is Cancelled. PASS.')
  })

  it('leaves no comments behind when the check cannot be stored', async () => {
    db.state.failInsert = true
    await expect(runReleaseCheck(5)).rejects.toThrow('boom')
    expect(db.state.comments).toHaveLength(0)
    expect(notify).not.toHaveBeenCalled()
  })

  it('returns null for an unknown release', async () => {
    expect(await runReleaseCheck(999)).toBeNull()
  })
})

describe('Release Monitor role', () => {
  it('is read-only: Viewer rank, below Member', () => {
    expect(RELEASE_MONITOR_ROLE).toBe('Release Monitor')
    expect(ROLE_RANK[RELEASE_MONITOR_ROLE]).toBe(ROLE_RANK.Viewer)
    expect(ROLE_RANK[RELEASE_MONITOR_ROLE]).toBeLessThan(ROLE_RANK.Member)
  })
})
