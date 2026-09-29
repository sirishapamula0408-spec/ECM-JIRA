// JL-157 — a wiki page belongs to a project, a Space, or both.
//
// Creating a page in a Space — the ONLY kind Confluence Lite creates —
// failed with a 23502 not-null violation on project_id, surfacing as a 500
// on /wiki/new. JL-88 added space_id as nullable but left project_id NOT NULL
// from the original per-project wiki (JL-48), and the CREATE TABLE carried the
// same NOT NULL, so a brand new database was born broken too.
//
// ── Why this suite is here and not in server/__tests__/ ──────────────────────
//
// Because that is the whole reason it shipped. The unit suites mock db.js, so
// an INSERT in them never meets a constraint: every route test for page
// creation passed for as long as this bug existed. A mocked INSERT proves the
// route builds the SQL it meant to. Only a real column proves the database
// will accept it.
//
// ── Why it extracts the DDL from db.js rather than writing its own ───────────
//
// server/test/setup.js's initTestSchema hand-builds ten core tables for the
// RBAC suites; wiki_pages is not among them, and adding it there would mean
// asserting against a definition written in the test harness rather than the
// one that ships. That is the JL-468 pattern instead: pull the statement out
// of db.js source and run it verbatim, so the schema under test is the schema
// the application creates.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestDb, cleanTestDb } from './setup.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// Normalised to LF. The repo's files are CRLF, and a regex anchored on a bare
// newline silently matches NOTHING against them rather than failing loudly —
// which is its own small trap, and cost a pass here already.
const dbSrc = fs.readFileSync(path.join(here, '..', 'db.js'), 'utf8')
  .replace(/\r\n/g, '\n')

/** The `CREATE TABLE ... wiki_pages (...)` block exactly as db.js writes it. */
function extractWikiPagesCreateTable() {
  const m = dbSrc.match(/CREATE TABLE IF NOT EXISTS wiki_pages \(([\s\S]*?)\n\s*\)\n/)
  expect(m, 'could not find the wiki_pages CREATE TABLE in db.js').toBeTruthy()
  return m[0]
}

/* ---------------------------------------------------------------- *
 * Both halves of the fix, read out of the source
 * ---------------------------------------------------------------- */
describe('JL-157 db.js states the right contract', () => {
  const create = extractWikiPagesCreateTable()

  it('does not declare project_id NOT NULL', () => {
    // A fresh install runs only the CREATE TABLE, so this half is what keeps a
    // new database from being born with the bug.
    expect(create).not.toMatch(/project_id INTEGER NOT NULL/)
    expect(create, 'the column should still exist').toMatch(/project_id INTEGER REFERENCES projects/)
  })

  it('still carries the migration for databases that already exist', () => {
    /*
     * The CREATE TABLE only runs on an empty database, so fixing it alone
     * fixes nothing already deployed. Both halves are required, and this is
     * the one that reaches an install that is already running.
     */
    expect(dbSrc).toMatch(
      /ALTER TABLE wiki_pages ALTER COLUMN project_id DROP NOT NULL/,
    )
  })
})

/* ---------------------------------------------------------------- *
 * And the same statement, actually executed
 * ---------------------------------------------------------------- */
describe('JL-157 a schema built from db.js accepts a Space-only page', () => {
  let db

  beforeAll(async () => {
    db = createTestDb()
    await db.initSchema()
    // Minimal stubs for the FK targets, so db.js's statement runs VERBATIM.
    // Editing it to drop its foreign keys would test a statement the
    // application never executes.
    await db.run('CREATE TABLE projects (id SERIAL PRIMARY KEY)')
    await db.run('CREATE TABLE spaces (id SERIAL PRIMARY KEY)')
    await db.run(extractWikiPagesCreateTable())
    // The columns Spaces added (JL-88/JL-95), applied the same way db.js does.
    await db.run('ALTER TABLE wiki_pages ADD COLUMN space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL')
    await db.run("ALTER TABLE wiki_pages ADD COLUMN status TEXT NOT NULL DEFAULT 'published'")
  })

  afterAll(async () => {
    if (db) {
      await cleanTestDb(db)
      await db.close()
    }
  })

  const insertPage = (projectId, spaceId, title) =>
    db.run(
      `INSERT INTO wiki_pages (project_id, space_id, title, content, parent_id, status, created_by, updated_by)
       VALUES ($1, $2, $3, '', NULL, 'published', 'a@test.com', 'a@test.com') RETURNING id`,
      [projectId, spaceId, title],
    )

  const makeSpace = async () => (await db.run('INSERT INTO spaces DEFAULT VALUES RETURNING id')).lastID
  const makeProject = async () => (await db.run('INSERT INTO projects DEFAULT VALUES RETURNING id')).lastID

  it('accepts a page with a Space and NO project — the failing case', async () => {
    // This is the exact row POST /api/wiki builds for Confluence Lite.
    const spaceId = await makeSpace()
    const created = await insertPage(null, spaceId, 'Runbook')
    const row = await db.get('SELECT * FROM wiki_pages WHERE id = $1', [created.lastID])

    expect(row.title).toBe('Runbook')
    expect(row.project_id).toBeNull()
    expect(row.space_id).toBe(spaceId)
  })

  it('reports project_id as nullable in the built schema', async () => {
    // Stated against information_schema too, so a future failure is legible
    // without re-deriving the cause from a 23502.
    const col = await db.get(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'wiki_pages' AND column_name = 'project_id'`,
    )
    expect(col.is_nullable).toBe('YES')
  })

  it('still accepts a page with only a project', async () => {
    // The per-project wiki (JL-48) predates Spaces and must keep working.
    const projectId = await makeProject()
    const created = await insertPage(projectId, null, 'Project notes')
    const row = await db.get('SELECT * FROM wiki_pages WHERE id = $1', [created.lastID])

    expect(row.project_id).toBe(projectId)
    expect(row.space_id).toBeNull()
  })

  it('accepts a page belonging to BOTH', async () => {
    const [projectId, spaceId] = [await makeProject(), await makeSpace()]
    const created = await insertPage(projectId, spaceId, 'Shared')
    const row = await db.get('SELECT * FROM wiki_pages WHERE id = $1', [created.lastID])

    expect(row.project_id).toBe(projectId)
    expect(row.space_id).toBe(spaceId)
  })

  it('leaves a page in place, space-less, when its Space is deleted', async () => {
    /*
     * ON DELETE SET NULL — which is precisely why DELETE /api/spaces refuses
     * while a Space still holds live pages (JL-156). Without that check this
     * is silent orphaning rather than deletion, so the two decisions are
     * pinned together.
     */
    const spaceId = await makeSpace()
    const created = await insertPage(null, spaceId, 'Orphan')
    await db.run('DELETE FROM spaces WHERE id = $1', [spaceId])

    const row = await db.get('SELECT * FROM wiki_pages WHERE id = $1', [created.lastID])
    expect(row, 'the page must not be cascaded away').toBeTruthy()
    expect(row.space_id).toBeNull()
  })
})
