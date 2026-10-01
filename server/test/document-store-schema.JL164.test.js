// JL-164 — the Document Store schema, against real PostgreSQL.
//
// The unit suite mocks db.js, so an INSERT there never meets a constraint.
// That is precisely how JL-157 shipped: wiki_pages.project_id was NOT NULL
// with no matching migration, every mocked test passed, and creating a page
// in a Space was a guaranteed 23502 in production.
//
// The decisions worth proving with a real column are the nullability ones,
// because each encodes a product rule:
//
//   documents.folder_id      NULL  — a document sits at the Space root until
//                                    filed, and losing a folder must not
//                                    destroy the documents inside it
//   document_folders.parent  NULL  — NULL means a root folder
//   ON DELETE SET NULL on folder_id, CASCADE on space_id
//
// Follows the JL-468 pattern: the DDL is extracted from db.js source and run
// verbatim, so the schema under test is the schema the application creates,
// not one the harness wrote. server/test/setup.js's initTestSchema builds only
// the ten RBAC tables and does not include these.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestDb, cleanTestDb } from './setup.js'

const here = dirname(fileURLToPath(import.meta.url))
// Normalised to LF: the repo's files are CRLF and a regex anchored on a bare
// newline silently matches nothing rather than failing loudly.
const dbSrc = readFileSync(resolve(here, '..', 'db.js'), 'utf8').replace(/\r\n/g, '\n')

/** A `CREATE TABLE IF NOT EXISTS <name> (...)` block exactly as db.js writes it. */
function extractCreateTable(name) {
  const m = dbSrc.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\s*\\)\\n`))
  expect(m, `could not find the ${name} CREATE TABLE in db.js`).toBeTruthy()
  return m[0]
}

/**
 * Every CREATE INDEX db.js issues against the three document tables, in
 * source order. The GIN full-text index is skipped: it is an expression index
 * over to_tsvector and adds nothing to the constraints under test here.
 */
function extractIndexStatements() {
  const out = []
  const re = /await pool\.query\((?:`|')(CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [\s\S]*?)(?:`|')\)/g
  let m = re.exec(dbSrc)
  while (m) {
    const stmt = m[1]
    if (/ON (documents|document_versions|document_folders)\b/.test(stmt) && !/USING GIN/.test(stmt)) {
      out.push(stmt)
    }
    m = re.exec(dbSrc)
  }
  expect(out.length, 'no document index statements found in db.js').toBeGreaterThan(0)
  return out
}

describe('JL-164 db.js states the Document Store contract', () => {
  it('declares all three tables', () => {
    for (const t of ['documents', 'document_versions', 'document_folders']) {
      expect(extractCreateTable(t)).toBeTruthy()
    }
  })

  it('does not store binary content in PostgreSQL (section 14)', () => {
    /*
     * The spec is explicit that files live outside the database. A BYTEA or
     * large-object column here would be the whole storage architecture
     * quietly reversed.
     */
    const documents = extractCreateTable('documents')
    expect(documents).not.toMatch(/BYTEA|OID|LARGE OBJECT/i)
    expect(documents).toMatch(/storage_key TEXT NOT NULL/)
  })

  it('keeps folder_id nullable and SET NULL, not CASCADE', () => {
    // Losing a folder must never destroy the documents filed in it.
    const documents = extractCreateTable('documents')
    expect(documents).toMatch(/folder_id INTEGER REFERENCES document_folders\(id\) ON DELETE SET NULL/)
    expect(documents).not.toMatch(/folder_id INTEGER NOT NULL/)
  })
})

describe('JL-164 a schema built from db.js behaves', () => {
  let db

  beforeAll(async () => {
    db = createTestDb()
    await db.initSchema()
    // Minimal stub for the FK target so db.js's statements run VERBATIM.
    // Editing them to drop their foreign keys would test statements the
    // application never executes.
    await db.run('CREATE TABLE spaces (id SERIAL PRIMARY KEY)')
    await db.run(extractCreateTable('document_folders'))
    await db.run(extractCreateTable('documents'))
    await db.run(extractCreateTable('document_versions'))
    /*
     * The indexes are separate pool.query calls in db.js, so extracting only
     * the CREATE TABLE statements would leave the UNIQUE constraints out and
     * quietly turn the uniqueness assertions below into no-ops — a test that
     * passes because the rule it checks was never created.
     */
    for (const stmt of extractIndexStatements()) await db.run(stmt)
  })

  afterAll(async () => {
    if (db) {
      await cleanTestDb(db)
      await db.close()
    }
  })

  const makeSpace = async () => (await db.run('INSERT INTO spaces DEFAULT VALUES RETURNING id')).lastID

  const insertDoc = (spaceId, folderId, name) => db.run(
    `INSERT INTO documents
       (space_id, folder_id, file_name, original_file_name, file_extension,
        mime_type, file_size, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $3, 'pdf', 'application/pdf', 1024, $4, 'a@test.com')
     RETURNING id`,
    [spaceId, folderId, name, `key-${name}-${Math.random()}`],
  )

  it('accepts a document with no folder — the Space root', async () => {
    const spaceId = await makeSpace()
    const created = await insertDoc(spaceId, null, 'Root.pdf')
    const row = await db.get('SELECT * FROM documents WHERE id = $1', [created.lastID])
    expect(row.folder_id).toBeNull()
    expect(row.current_version).toBe(1)
    expect(row.status).toBe('active')
    expect(row.deleted_at).toBeNull()
  })

  it('leaves documents in place, unfiled, when their folder is deleted', async () => {
    /*
     * ON DELETE SET NULL. This is why the route refuses to delete a folder
     * that still holds documents — without that check, deleting a folder
     * silently tips its contents back into the root rather than deleting
     * them, which is neither outcome the user intends.
     */
    const spaceId = await makeSpace()
    const folder = await db.run(
      `INSERT INTO document_folders (space_id, folder_name, created_by)
       VALUES ($1, 'Design', 'a@test.com') RETURNING id`,
      [spaceId],
    )
    const doc = await insertDoc(spaceId, folder.lastID, 'Filed.pdf')

    await db.run('DELETE FROM document_folders WHERE id = $1', [folder.lastID])

    const row = await db.get('SELECT * FROM documents WHERE id = $1', [doc.lastID])
    expect(row, 'the document must survive its folder').toBeTruthy()
    expect(row.folder_id).toBeNull()
  })

  it('takes documents with the Space, which does own them', async () => {
    const spaceId = await makeSpace()
    const doc = await insertDoc(spaceId, null, 'Doomed.pdf')
    await db.run('DELETE FROM spaces WHERE id = $1', [spaceId])
    const row = await db.get('SELECT * FROM documents WHERE id = $1', [doc.lastID])
    expect(row, 'a document cannot outlive its Space').toBeFalsy()
  })

  it('refuses two versions with the same number on one document', async () => {
    // The version number is the address used to restore and download; two
    // rows sharing one would make "version 2" ambiguous.
    const spaceId = await makeSpace()
    const doc = await insertDoc(spaceId, null, 'Versioned.pdf')
    const addVersion = (n) => db.run(
      `INSERT INTO document_versions
         (document_id, version_number, file_name, file_size, storage_key, uploaded_by)
       VALUES ($1, $2, 'Versioned.pdf', 10, $3, 'a@test.com') RETURNING id`,
      [doc.lastID, n, `k${n}`],
    )
    await addVersion(1)
    await expect(addVersion(1)).rejects.toThrow()
    await expect(addVersion(2)).resolves.toBeTruthy()
  })

  it('takes every version with the document', async () => {
    const spaceId = await makeSpace()
    const doc = await insertDoc(spaceId, null, 'Cascade.pdf')
    await db.run(
      `INSERT INTO document_versions
         (document_id, version_number, file_name, file_size, storage_key, uploaded_by)
       VALUES ($1, 1, 'Cascade.pdf', 10, 'kc', 'a@test.com') RETURNING id`,
      [doc.lastID],
    )
    await db.run('DELETE FROM documents WHERE id = $1', [doc.lastID])
    const rows = await db.all('SELECT * FROM document_versions WHERE document_id = $1', [doc.lastID])
    expect(rows).toHaveLength(0)
  })

  it('stores a file size beyond a 32-bit integer', async () => {
    /*
     * file_size is BIGINT, not INTEGER. A 100 MB cap fits in an int today,
     * but the cap is configurable and INTEGER tops out at 2.1 GB — a limit
     * nobody would remember was there until an upload failed with a type
     * error rather than a quota message.
     */
    const spaceId = await makeSpace()
    const created = await db.run(
      `INSERT INTO documents
         (space_id, file_name, original_file_name, file_extension, file_size, storage_key, uploaded_by)
       VALUES ($1, 'Huge.zip', 'Huge.zip', 'zip', $2, 'khuge', 'a@test.com') RETURNING id`,
      [spaceId, 5_000_000_000],
    )
    const row = await db.get('SELECT file_size FROM documents WHERE id = $1', [created.lastID])
    expect(Number(row.file_size)).toBe(5_000_000_000)
  })
})
