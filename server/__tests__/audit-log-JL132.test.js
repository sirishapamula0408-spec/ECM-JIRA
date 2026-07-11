// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  computeEntryHash,
  verifyChain,
  entriesToPurge,
  appendAudit,
  GENESIS_HASH,
} from '../services/auditLog.js'

/** Build an app with req.user stubbed to a given workspace role. */
async function createApp(role = 'Admin', isOwner = false) {
  const mod = await import('../routes/auditLog.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', mod.default)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   computeEntryHash — pure, deterministic
   ================================================================ */
describe('computeEntryHash', () => {
  const base = {
    seq: 1,
    actor: 'alice@test.com',
    action: 'login',
    target: 'alice@test.com',
    metadata: { remember: true },
    prevHash: GENESIS_HASH,
    createdAt: '2026-07-08T00:00:00.000Z',
  }

  it('returns a 64-char sha256 hex string', () => {
    const h = computeEntryHash(base)
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic for identical input', () => {
    expect(computeEntryHash(base)).toBe(computeEntryHash({ ...base }))
  })

  it('is order-independent for metadata keys', () => {
    const a = computeEntryHash({ ...base, metadata: { x: 1, y: 2 } })
    const b = computeEntryHash({ ...base, metadata: { y: 2, x: 1 } })
    expect(a).toBe(b)
  })

  it('changes when any field changes', () => {
    const h0 = computeEntryHash(base)
    expect(computeEntryHash({ ...base, seq: 2 })).not.toBe(h0)
    expect(computeEntryHash({ ...base, actor: 'bob@test.com' })).not.toBe(h0)
    expect(computeEntryHash({ ...base, action: 'logout' })).not.toBe(h0)
    expect(computeEntryHash({ ...base, target: 'other' })).not.toBe(h0)
    expect(computeEntryHash({ ...base, metadata: { remember: false } })).not.toBe(h0)
    expect(computeEntryHash({ ...base, prevHash: 'deadbeef' })).not.toBe(h0)
    expect(computeEntryHash({ ...base, createdAt: '2026-07-09T00:00:00.000Z' })).not.toBe(h0)
  })
})

/* ================================================================
   verifyChain — pure
   ================================================================ */
function buildChain(specs) {
  // specs: array of { actor, action, target, metadata, createdAt }
  let prevHash = GENESIS_HASH
  return specs.map((s, i) => {
    const seq = i + 1
    const entry = {
      seq,
      actor: s.actor,
      action: s.action,
      target: s.target ?? null,
      metadata: s.metadata ?? null,
      prev_hash: prevHash,
      created_at: s.createdAt,
    }
    entry.hash = computeEntryHash({
      seq,
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      metadata: entry.metadata,
      prevHash,
      createdAt: entry.created_at,
    })
    prevHash = entry.hash
    return entry
  })
}

describe('verifyChain', () => {
  const chain = buildChain([
    { actor: 'a@t.com', action: 'login', createdAt: '2026-07-01T00:00:00.000Z' },
    { actor: 'b@t.com', action: 'role.change', metadata: { to: 'Admin' }, createdAt: '2026-07-02T00:00:00.000Z' },
    { actor: 'c@t.com', action: 'webhook.create', createdAt: '2026-07-03T00:00:00.000Z' },
  ])

  it('returns ok for a valid chain', () => {
    expect(verifyChain(chain)).toEqual({ ok: true, brokenAt: null })
  })

  it('returns ok for an empty chain', () => {
    expect(verifyChain([])).toEqual({ ok: true, brokenAt: null })
  })

  it('pinpoints brokenAt when an entry field is tampered', () => {
    const tampered = chain.map((e) => ({ ...e }))
    tampered[1] = { ...tampered[1], action: 'role.delete' } // altered field, hash now stale
    const res = verifyChain(tampered)
    expect(res.ok).toBe(false)
    expect(res.brokenAt).toBe(2)
  })

  it('pinpoints brokenAt when a stored hash is tampered', () => {
    const tampered = chain.map((e) => ({ ...e }))
    tampered[0] = { ...tampered[0], hash: 'f'.repeat(64) }
    const res = verifyChain(tampered)
    expect(res.ok).toBe(false)
    expect(res.brokenAt).toBe(1)
  })

  it('detects a broken prev_hash link (deleted middle entry)', () => {
    const withGap = [chain[0], chain[2]] // seq jumps 1 -> 3, prev_hash no longer links
    const res = verifyChain(withGap)
    expect(res.ok).toBe(false)
    expect(res.brokenAt).toBe(3)
  })

  /* --- JL-188: chain survives a legitimate retention purge --- */
  it('verifies ok for a surviving-but-purged chain when re-anchored on the checkpoint', () => {
    // Simulate a purge that removed the first entry: the surviving entries are
    // [seq2, seq3], and the recorded checkpoint hash is the purged entry's hash.
    const survivors = [chain[1], chain[2]]
    const checkpointHash = chain[0].hash
    const res = verifyChain(survivors, checkpointHash)
    expect(res).toEqual({ ok: true, brokenAt: null })
  })

  it('still flags a tampered SURVIVING entry after a purge (re-anchored)', () => {
    const survivors = [chain[1], chain[2]].map((e) => ({ ...e }))
    survivors[1] = { ...survivors[1], action: 'HACKED' } // tamper the surviving tail
    const checkpointHash = chain[0].hash
    const res = verifyChain(survivors, checkpointHash)
    expect(res.ok).toBe(false)
    expect(res.brokenAt).toBe(3)
  })

  it('flags an un-recorded deletion — earliest survivor prev_hash != checkpoint', () => {
    // Purge recorded seq1 as the checkpoint, but an attacker also deleted seq2.
    // The new earliest survivor (seq3) links to seq2's hash, not the checkpoint.
    const survivors = [chain[2]]
    const checkpointHash = chain[0].hash
    const res = verifyChain(survivors, checkpointHash)
    expect(res.ok).toBe(false)
    expect(res.brokenAt).toBe(3)
  })
})

/* ================================================================
   entriesToPurge — pure
   ================================================================ */
describe('entriesToPurge', () => {
  const now = '2026-07-08T00:00:00.000Z'
  const entries = [
    { seq: 1, created_at: '2026-01-01T00:00:00.000Z' }, // ~188 days old
    { seq: 2, created_at: '2026-06-01T00:00:00.000Z' }, // ~37 days old
    { seq: 3, created_at: '2026-07-07T00:00:00.000Z' }, // 1 day old
    { seq: 4 }, // no timestamp — never purged
  ]

  it('selects only entries older than the retention window', () => {
    const purge = entriesToPurge(entries, now, 90)
    expect(purge.map((e) => e.seq)).toEqual([1])
  })

  it('selects more entries with a shorter window', () => {
    const purge = entriesToPurge(entries, now, 30)
    expect(purge.map((e) => e.seq)).toEqual([1, 2])
  })

  it('returns nothing for a non-positive retention window', () => {
    expect(entriesToPurge(entries, now, 0)).toEqual([])
    expect(entriesToPurge(entries, now, -5)).toEqual([])
  })

  it('never purges an entry without a timestamp', () => {
    const purge = entriesToPurge(entries, now, 1)
    expect(purge.map((e) => e.seq)).not.toContain(4)
  })
})

/* ================================================================
   appendAudit — chains on the latest hash
   ================================================================ */
describe('appendAudit', () => {
  it('chains on the latest stored hash and inserts prev_hash + hash', async () => {
    get.mockResolvedValueOnce({ seq: 5, hash: 'abc123prev' })
    run.mockResolvedValueOnce({ lastID: 6, changes: 1 })

    const result = await appendAudit({ actor: 'admin@test.com', action: 'role.change', target: 'bob', metadata: { to: 'Admin' } })

    expect(result.seq).toBe(6)
    expect(result.prevHash).toBe('abc123prev')

    expect(run).toHaveBeenCalledTimes(1)
    const [sql, params] = run.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO audit_log/i)
    // params order: seq, actor, action, target, metadata, prev_hash, hash, created_at
    expect(params[0]).toBe(6)          // seq
    expect(params[5]).toBe('abc123prev') // prev_hash
    expect(params[6]).toBe(result.hash)  // hash
    expect(params[6]).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses the genesis hash + seq 1 for the first entry', async () => {
    get.mockResolvedValueOnce(undefined)
    run.mockResolvedValueOnce({ lastID: 1, changes: 1 })

    const result = await appendAudit({ actor: 'admin@test.com', action: 'login' })
    expect(result.seq).toBe(1)
    expect(result.prevHash).toBe(GENESIS_HASH)
    const [, params] = run.mock.calls[0]
    expect(params[5]).toBe(GENESIS_HASH)
  })

  // JL-188: after a full purge the table is empty but a checkpoint exists —
  // the next entry must chain onto the checkpoint hash and continue the seq.
  it('chains onto the checkpoint when the table is empty after a full purge', async () => {
    get
      .mockResolvedValueOnce(undefined) // no latest entry (table emptied by purge)
      .mockResolvedValueOnce({ purged_through_seq: 9, last_hash: 'checkpointhash' })
    run.mockResolvedValueOnce({ lastID: 1, changes: 1 })

    const result = await appendAudit({ actor: 'admin@test.com', action: 'login' })
    expect(result.seq).toBe(10) // continues from purged_through_seq
    expect(result.prevHash).toBe('checkpointhash')
    const [, params] = run.mock.calls[0]
    expect(params[0]).toBe(10)
    expect(params[5]).toBe('checkpointhash')
  })
})

/* ================================================================
   Routes
   ================================================================ */
describe('GET /api/audit-log/verify', () => {
  it('returns the chain status over stored entries', async () => {
    const chain = buildChain([
      { actor: 'a@t.com', action: 'login', createdAt: '2026-07-01T00:00:00.000Z' },
      { actor: 'b@t.com', action: 'webhook.create', createdAt: '2026-07-02T00:00:00.000Z' },
    ])
    all.mockResolvedValueOnce(chain)

    const app = await createApp('Admin')
    const res = await request(app).get('/api/audit-log/verify')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, brokenAt: null, count: 2 })
    // JL-187: the chain load is bounded so it cannot exhaust memory.
    const [sql] = all.mock.calls[0]
    expect(sql).toMatch(/LIMIT 50000/)
  })

  it('reports a tampered chain', async () => {
    const chain = buildChain([
      { actor: 'a@t.com', action: 'login', createdAt: '2026-07-01T00:00:00.000Z' },
      { actor: 'b@t.com', action: 'webhook.create', createdAt: '2026-07-02T00:00:00.000Z' },
    ])
    chain[1] = { ...chain[1], action: 'HACKED' }
    all.mockResolvedValueOnce(chain)

    const app = await createApp('Admin')
    const res = await request(app).get('/api/audit-log/verify')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.brokenAt).toBe(2)
  })

  /* --- JL-188: verify is robust to a legitimate retention purge --- */
  it('returns ok for a purged chain re-anchored on the stored checkpoint', async () => {
    const chain = buildChain([
      { actor: 'a@t.com', action: 'login', createdAt: '2026-07-01T00:00:00.000Z' },
      { actor: 'b@t.com', action: 'role.change', createdAt: '2026-07-02T00:00:00.000Z' },
      { actor: 'c@t.com', action: 'webhook.create', createdAt: '2026-07-03T00:00:00.000Z' },
    ])
    // Purge removed seq 1; only seq 2 + 3 survive, checkpoint = seq1's hash.
    all.mockResolvedValueOnce([chain[1], chain[2]])
    get.mockResolvedValueOnce({ purged_through_seq: 1, last_hash: chain[0].hash })

    const app = await createApp('Admin')
    const res = await request(app).get('/api/audit-log/verify')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, brokenAt: null, count: 2 })
  })

  it('still detects tampering of a surviving entry after a purge', async () => {
    const chain = buildChain([
      { actor: 'a@t.com', action: 'login', createdAt: '2026-07-01T00:00:00.000Z' },
      { actor: 'b@t.com', action: 'role.change', createdAt: '2026-07-02T00:00:00.000Z' },
      { actor: 'c@t.com', action: 'webhook.create', createdAt: '2026-07-03T00:00:00.000Z' },
    ])
    const survivors = [{ ...chain[1] }, { ...chain[2], action: 'HACKED' }]
    all.mockResolvedValueOnce(survivors)
    get.mockResolvedValueOnce({ purged_through_seq: 1, last_hash: chain[0].hash })

    const app = await createApp('Admin')
    const res = await request(app).get('/api/audit-log/verify')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.brokenAt).toBe(3)
  })
})

describe('GET /api/audit-log — list', () => {
  it('returns entries with filters applied', async () => {
    all
      .mockResolvedValueOnce([{ id: 1, seq: 1, actor: 'a@t.com', action: 'login' }]) // rows
      .mockResolvedValueOnce([{ count: 1 }]) // total

    const app = await createApp('Admin')
    const res = await request(app).get('/api/audit-log?actor=a@t.com&action=login')
    expect(res.status).toBe(200)
    expect(res.body.entries).toHaveLength(1)
    expect(res.body.total).toBe(1)
    // The filter clause must be applied to the list query.
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/WHERE actor = \? AND action = \?/)
    expect(params).toContain('a@t.com')
    expect(params).toContain('login')
  })
})

describe('GET /api/audit-log/export', () => {
  const rows = [
    { seq: 1, actor: 'a@t.com', action: 'login', target: 'a@t.com', metadata: { x: 1 }, prev_hash: '0', hash: 'h1', created_at: '2026-07-01T00:00:00.000Z' },
  ]

  it('exports JSON with a Content-Disposition header', async () => {
    all.mockResolvedValueOnce(rows)
    const app = await createApp('Admin')
    const res = await request(app).get('/api/audit-log/export?format=json')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/audit-log\.json/)
    expect(res.body.entries).toHaveLength(1)
  })

  it('exports CSV with a header row and a Content-Disposition header', async () => {
    all.mockResolvedValueOnce(rows)
    const app = await createApp('Admin')
    const res = await request(app).get('/api/audit-log/export?format=csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/audit-log\.csv/)
    expect(res.text.split('\n')[0]).toBe('seq,actor,action,target,metadata,prev_hash,hash,created_at')
    expect(res.text).toMatch(/a@t\.com/)
  })

  it('bounds the export query with a hard row cap (JL-187)', async () => {
    all.mockResolvedValueOnce(rows)
    const app = await createApp('Admin')
    await request(app).get('/api/audit-log/export?format=json')
    const [sql] = all.mock.calls[0]
    expect(sql).toMatch(/LIMIT 50000/)
  })
})

describe('POST /api/audit-log/retention', () => {
  it('deletes entries older than the window and returns the count', async () => {
    run.mockResolvedValueOnce({ changes: 3 })
    const app = await createApp('Admin')
    const res = await request(app).post('/api/audit-log/retention').send({ retentionDays: 30 })
    expect(res.status).toBe(200)
    expect(res.body.purged).toBe(3)
    expect(res.body.retentionDays).toBe(30)
    const [sql] = run.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM audit_log WHERE created_at < \?/)
  })

  /* --- JL-188: a purge records a re-anchor checkpoint --- */
  it('records a checkpoint (last purged seq + hash) when entries are purged', async () => {
    get.mockResolvedValueOnce({ seq: 7, hash: 'lastpurgedhash' }) // boundary lookup
    run
      .mockResolvedValueOnce({ changes: 4 }) // DELETE
      .mockResolvedValueOnce({ lastID: 1 }) // INSERT checkpoint
    const app = await createApp('Admin')
    const res = await request(app).post('/api/audit-log/retention').send({ retentionDays: 30 })
    expect(res.status).toBe(200)
    expect(res.body.purged).toBe(4)

    // The second run() must insert the checkpoint with the boundary seq + hash.
    expect(run).toHaveBeenCalledTimes(2)
    const [ckSql, ckParams] = run.mock.calls[1]
    expect(ckSql).toMatch(/INSERT INTO audit_checkpoint/i)
    expect(ckParams).toEqual([7, 'lastpurgedhash'])
  })

  it('does not record a checkpoint when nothing was purged', async () => {
    get.mockResolvedValueOnce(undefined) // no boundary → nothing old enough
    run.mockResolvedValueOnce({ changes: 0 }) // DELETE
    const app = await createApp('Admin')
    const res = await request(app).post('/api/audit-log/retention').send({ retentionDays: 30 })
    expect(res.status).toBe(200)
    expect(res.body.purged).toBe(0)
    expect(run).toHaveBeenCalledTimes(1) // only the DELETE, no checkpoint insert
  })
})

describe('authorization', () => {
  it('rejects non-admins (Viewer) with 403', async () => {
    const app = await createApp('Viewer')
    const res = await request(app).get('/api/audit-log/verify')
    expect(res.status).toBe(403)
  })

  it('rejects Members with 403', async () => {
    const app = await createApp('Member')
    const res = await request(app).get('/api/audit-log')
    expect(res.status).toBe(403)
  })

  it('allows the workspace Owner even without Admin role', async () => {
    all.mockResolvedValueOnce([]) // verify query
    const app = await createApp('Viewer', true)
    const res = await request(app).get('/api/audit-log/verify')
    expect(res.status).toBe(200)
  })
})
