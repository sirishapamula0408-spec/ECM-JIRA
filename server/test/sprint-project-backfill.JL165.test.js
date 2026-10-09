// JL-165 (fosasoft) — giving existing sprints a project, against a real database.
//
// The migration in db.js runs once, on every deployed database, against data
// nobody has looked at. So its rule is pinned here with real rows rather than
// a mocked UPDATE: a sprint whose issues are all in ONE project gets that
// project; a sprint with issues from several projects, or with an issue that
// has no project, or with no issues at all, stays shared (project_id NULL),
// so no issue is ever left in a sprint its own project cannot see.
//
// The statements are pulled out of db.js and run verbatim (the JL-468 /
// JL-157 pattern), so what is tested is what ships.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestDb, cleanTestDb } from './setup.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// Normalised to LF: the repo's files are CRLF.
const dbSrc = fs.readFileSync(path.join(here, '..', 'db.js'), 'utf8').replace(/\r\n/g, '\n')

function extract(re, what) {
  const m = dbSrc.match(re)
  expect(m, `could not find ${what} in db.js`).toBeTruthy()
  return m[1] ?? m[0]
}

const ADD_COLUMN = extract(/'(ALTER TABLE sprints ADD COLUMN project_id[^']*)'/, 'the sprints.project_id column')
const BACKFILL = extract(/`(\s*UPDATE sprints s\s+SET project_id = one_project\.project_id[\s\S]*?)`/, 'the sprint backfill')

describe('JL-165 sprint → project backfill (real PostgreSQL)', () => {
  let db

  beforeAll(async () => {
    db = createTestDb()
    await db.initSchema()
    await db.run('CREATE TABLE projects (id INTEGER PRIMARY KEY)')
    await db.run('CREATE TABLE sprints (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    await db.run('CREATE TABLE issues (id SERIAL PRIMARY KEY, sprint_id INTEGER REFERENCES sprints(id), project_id INTEGER REFERENCES projects(id))')
    await db.run(ADD_COLUMN)
    await db.run('INSERT INTO projects (id) VALUES (1), (2)')
    await db.run(`INSERT INTO sprints (id, name) VALUES
      (1, 'all project 1'), (2, 'mixed projects'), (3, 'empty'),
      (4, 'one issue without a project'), (5, 'already placed')`)
    await db.run('UPDATE sprints SET project_id = 2 WHERE id = 5')
    await db.run(`INSERT INTO issues (sprint_id, project_id) VALUES
      (1, 1), (1, 1),
      (2, 1), (2, 2),
      (4, 1), (4, NULL),
      (5, 1)`)
    await db.run(BACKFILL)
  })

  afterAll(async () => {
    if (db) {
      await cleanTestDb(db)
      await db.close()
    }
  })

  const projectOf = async (id) => (await db.get('SELECT project_id FROM sprints WHERE id = $1', [id])).project_id

  it('gives a sprint whose issues are all in one project that project', async () => {
    expect(await projectOf(1)).toBe(1)
  })

  it('leaves a sprint holding several projects\' issues shared', async () => {
    expect(await projectOf(2)).toBeNull()
  })

  it('leaves an empty sprint shared', async () => {
    expect(await projectOf(3)).toBeNull()
  })

  it('leaves a sprint shared when one of its issues has no project', async () => {
    expect(await projectOf(4)).toBeNull()
  })

  it('never moves a sprint that already has a project', async () => {
    expect(await projectOf(5)).toBe(2)
  })

  it('is safe to run again', async () => {
    await db.run(BACKFILL)
    const rows = await db.all('SELECT id, project_id FROM sprints ORDER BY id')
    expect(rows.map((r) => r.project_id)).toEqual([1, null, null, null, 2])
  })

  it('deleting a project takes its sprints with it (ON DELETE CASCADE)', async () => {
    await db.run('UPDATE issues SET sprint_id = NULL WHERE sprint_id = 1')
    await db.run('DELETE FROM issues WHERE project_id = 1')
    await db.run('DELETE FROM projects WHERE id = 1')
    expect(await db.get('SELECT id FROM sprints WHERE id = 1')).toBeNull()
  })
})
