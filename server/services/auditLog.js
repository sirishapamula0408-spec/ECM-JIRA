import crypto from 'node:crypto'
import { get, run } from '../db.js'

/**
 * JL-132: Tamper-evident audit log with a SHA-256 hash chain.
 *
 * Each entry stores `prev_hash` (the hash of the entry before it) and `hash`
 * (the hash of this entry's canonical fields + prev_hash). Recomputing the
 * chain lets us detect any tampering: if a stored field or hash was altered,
 * the recomputed hash will no longer match.
 */

const GENESIS_HASH = '0'.repeat(64)

/**
 * Canonicalize the metadata into a stable string so hashing is deterministic
 * regardless of object key insertion order. Non-object values are stringified.
 */
function canonicalMetadata(metadata) {
  if (metadata === null || metadata === undefined) return ''
  if (typeof metadata === 'string') return metadata
  return stableStringify(metadata)
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

/**
 * Pure: compute the SHA-256 hex hash for a single audit entry over a canonical
 * serialization of its fields. Deterministic — changing any field changes the
 * hash. UNIT-TESTABLE.
 */
export function computeEntryHash({ seq, actor, action, target, metadata, prevHash, createdAt }) {
  const canonical = [
    `seq:${seq ?? ''}`,
    `actor:${actor ?? ''}`,
    `action:${action ?? ''}`,
    `target:${target ?? ''}`,
    `metadata:${canonicalMetadata(metadata)}`,
    `prevHash:${prevHash ?? ''}`,
    `createdAt:${createdAt ?? ''}`,
  ].join('|')
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

/**
 * Normalize a stored DB row (snake_case) into the shape computeEntryHash and
 * verifyChain expect. `metadata` may be a JSON string, an object, or null.
 */
function normalizeEntry(row) {
  let metadata = row.metadata
  if (typeof metadata === 'string' && metadata.length) {
    try { metadata = JSON.parse(metadata) } catch { /* keep raw string */ }
  }
  return {
    seq: row.seq,
    actor: row.actor,
    action: row.action,
    target: row.target ?? null,
    metadata: metadata ?? null,
    prevHash: row.prev_hash ?? row.prevHash ?? null,
    hash: row.hash ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
  }
}

/**
 * Pure: verify a hash chain over an ordered array of entries (ascending seq).
 * Recomputes each entry's hash from its fields + the previous entry's hash.
 * Returns { ok, brokenAt } where brokenAt is the seq of the first entry whose
 * stored hash does not match the recomputed hash (or whose prev_hash does not
 * link to the previous entry). UNIT-TESTABLE with plain arrays.
 */
export function verifyChain(entries) {
  const list = (entries || []).map((e) => (e && e.prev_hash !== undefined ? normalizeEntry(e) : e))
  let prevHash = GENESIS_HASH
  for (const entry of list) {
    const expectedPrev = entry.prevHash ?? GENESIS_HASH
    // The stored prev_hash must link to the actual previous entry's hash.
    if (expectedPrev !== prevHash) {
      return { ok: false, brokenAt: entry.seq }
    }
    const recomputed = computeEntryHash({
      seq: entry.seq,
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      metadata: entry.metadata,
      prevHash: expectedPrev,
      createdAt: entry.createdAt,
    })
    if (recomputed !== entry.hash) {
      return { ok: false, brokenAt: entry.seq }
    }
    prevHash = entry.hash
  }
  return { ok: true, brokenAt: null }
}

/**
 * Pure: given an array of entries, `now`, and a retention window in days,
 * return the subset that is older than the window (should be purged).
 * An entry with no createdAt is never purged. UNIT-TESTABLE.
 */
export function entriesToPurge(entries, now, retentionDays) {
  if (!retentionDays || retentionDays <= 0) return []
  const cutoff = new Date(now).getTime() - retentionDays * 24 * 60 * 60 * 1000
  return (entries || []).filter((e) => {
    const created = e.created_at ?? e.createdAt
    if (!created) return false
    return new Date(created).getTime() < cutoff
  })
}

/**
 * Append a new audit entry, chaining on the latest stored entry's hash.
 * Reads the latest entry (highest seq) to derive prev_hash + the next seq,
 * computes this entry's hash, and inserts. Best-effort: failures are swallowed
 * so audit logging never breaks the primary action.
 */
export async function appendAudit({ actor, action, target = null, metadata = null }) {
  const last = await get('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1', [])
  const seq = (last?.seq ?? 0) + 1
  const prevHash = last?.hash ?? GENESIS_HASH
  const createdAt = new Date().toISOString()
  const metaJson = metadata === null || metadata === undefined ? null : JSON.stringify(metadata)
  const hash = computeEntryHash({ seq, actor, action, target, metadata, prevHash, createdAt })

  await run(
    `INSERT INTO audit_log (seq, actor, action, target, metadata, prev_hash, hash, created_at)
     VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?)`,
    [seq, actor, action, target, metaJson, prevHash, hash, createdAt],
  )
  return { seq, prevHash, hash, createdAt }
}

/** Best-effort wrapper: log an audit event, never throwing to the caller. */
export async function safeAppendAudit(entry) {
  try {
    await appendAudit(entry)
  } catch {
    /* audit logging must never break the primary action */
  }
}

export { GENESIS_HASH }
