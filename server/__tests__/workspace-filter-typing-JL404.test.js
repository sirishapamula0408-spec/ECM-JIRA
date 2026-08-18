// @vitest-environment node
//
// JL-404 — a bind parameter used only in `IS NULL` must carry a cast.
//
// PostgreSQL cannot infer a type for a parameter whose sole use is `IS NULL`,
// so `(? IS NULL OR workspace_id = ?)` was rejected by the planner before it
// ever ran: "could not determine data type of parameter $3". Both /portfolio
// and /advanced-roadmap returned 500 for every caller, and the pages rendered
// their zero-state, which is why it was reported as "no data" rather than as an
// error.
//
// The source scan below is the important one: it catches the whole class rather
// than the five instances that happened to be found, so a new query written the
// old way fails here instead of in production.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(here, '..')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'test') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

const read = (rel) => fs.readFileSync(path.join(serverDir, rel), 'utf8')

describe('JL-404 — no untyped parameter can reach an IS NULL test', () => {
  it('finds no bare `? IS NULL` anywhere under server/', () => {
    // A cast (`?::int IS NULL`) is fine; a bare `? IS NULL` is the bug.
    const offenders = []
    for (const file of walk(serverDir)) {
      const src = fs.readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (/\?\s+IS\s+NULL/i.test(line)) {
          offenders.push(`${path.relative(serverDir, file)}:${i + 1}  ${line.trim()}`)
        }
      })
    }
    expect(offenders, `untyped bind parameter in IS NULL:\n${offenders.join('\n')}`).toEqual([])
  })

  it('casts the workspace filter in both portfolio branches', () => {
    // Both the member and the non-member branch carried the bug, so neither
    // path worked for any caller.
    const src = read('routes/portfolio.js')
    const clauses = src.match(/\(\?[^)]*IS NULL OR[^)]*\)/g) || []
    expect(clauses).toHaveLength(2)
    clauses.forEach((c) => expect(c).toMatch(/\?::int IS NULL/))
  })

  it('casts the workspace filter in both advanced-roadmap branches', () => {
    const src = read('routes/advancedRoadmap.js')
    const clauses = src.match(/\(\?[^)]*IS NULL OR[^)]*\)/g) || []
    expect(clauses).toHaveLength(2)
    clauses.forEach((c) => expect(c).toMatch(/\?::int IS NULL/))
  })

  it('casts the digest cutoff, which is NULL on a user first digest', () => {
    // Latent rather than a 500: no route surfaces it, but the query fails for
    // exactly the first digest of every user, inside a background job.
    const src = read('services/notificationDigest.js')
    expect(src).toMatch(/\?::timestamptz IS NULL OR created_at > \?/)
  })

  it('casts to the column types the schema actually declares', () => {
    // workspace_id is INTEGER and last_digest_sent_at is TIMESTAMPTZ; a cast to
    // the wrong type would compare or coerce incorrectly rather than error.
    const db = read('db.js')
    expect(db).toMatch(/workspace_id INTEGER/)
    expect(db).toMatch(/last_digest_sent_at TIMESTAMPTZ/)
  })
})
