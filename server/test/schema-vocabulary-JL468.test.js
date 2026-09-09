// JL-468 — a database built by db.js accepts every value validate.js allows.
//
// This is the check the JL-467 guard cannot make. That one scans for ARRAY
// LITERALS naming statuses, and db.js's constraints lived inside a SQL template
// string — invisible to a literal scan, and invisible to every unit test, since
// they only bind when a schema is actually created.
//
// A correction worth recording, because the ticket was raised on it: JL-468
// originally claimed a fresh install would REJECT the four QA statuses. It would
// not have. initializeDatabase() ran the CREATE TABLE and then, in the same
// function, dropped the priority and status CHECKs and recreated the issue_type
// one with the correct five (JL-76). By the time it returned, a fresh database
// accepted all nine. Measured before changing anything:
//
//   after CREATE TABLE only         rejected: In Testing, In Rework, In UAT,
//                                             Cancelled, Epic, Sub-task
//   after the migrations also ran   rejected: none
//
// So the defect was never behavioural. It was that CREATE TABLE stated a
// vocabulary it revoked moments later — a rule a reader would reasonably trust,
// contradicted further down the same function. That is worth fixing, and worth
// being accurate about.
//
// The test is written against the REAL CREATE TABLE, extracted from db.js
// source, so it fails if someone reintroduces a vocabulary CHECK there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestDb, cleanTestDb } from './setup.js'
import { validStatuses, validPriorities, validIssueTypes } from '../middleware/validate.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dbSrc = fs.readFileSync(path.join(here, '..', 'db.js'), 'utf8')

/** The `CREATE TABLE ... issues (...)` block exactly as db.js writes it. */
function extractIssuesCreateTable() {
  const m = dbSrc.match(/CREATE TABLE IF NOT EXISTS issues \(([\s\S]*?)\n\s*\)/)
  expect(m, 'could not find the issues CREATE TABLE in db.js').toBeTruthy()
  return m[0]
}

describe('JL-468 — db.js states no stale vocabulary', () => {
  const create = extractIssuesCreateTable()

  it('puts no CHECK on status, priority or issue_type', () => {
    // These are owned by validate.js. A CHECK here is a second source of truth
    // that no test outside this file can see.
    expect(create).not.toMatch(/CHECK\s*\(\s*status\s+IN/i)
    expect(create).not.toMatch(/CHECK\s*\(\s*priority\s+IN/i)
    expect(create).not.toMatch(/CHECK\s*\(\s*issue_type\s+IN/i)
  })

  it('still declares the three columns NOT NULL', () => {
    // Dropping the CHECK must not have dropped the column contract with it.
    for (const col of ['priority', 'status', 'issue_type']) {
      expect(create, `${col} should stay NOT NULL`).toMatch(new RegExp(`${col} TEXT NOT NULL`))
    }
  })
})

describe('JL-468 — a schema built from db.js accepts every canonical value', () => {
  let db

  beforeAll(async () => {
    db = createTestDb()
    await db.initSchema()
    // Minimal stubs for the two FK targets. The point of this test is to run
    // db.js's issues DDL VERBATIM — editing the statement to drop its foreign
    // keys would mean testing a statement the application never executes.
    await db.run('CREATE TABLE sprints (id SERIAL PRIMARY KEY)')
    await db.run('CREATE TABLE projects (id SERIAL PRIMARY KEY)')
    await db.run(extractIssuesCreateTable())
  })

  afterAll(async () => {
    if (db) {
      await cleanTestDb(db)
      await db.close()
    }
  })

  // issue_key is NOT NULL and UNIQUE, so each row needs its own.
  let n = 0
  const insert = (status, issueType, priority = 'Low') =>
    db.run(
      `INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type)
       VALUES ($1, 't', 'd', $2, 'a', $3, $4) RETURNING id`,
      [`JL468-${++n}`, priority, status, issueType],
    )

  it.each(validStatuses)('accepts status %s', async (status) => {
    await expect(insert(status, 'Task')).resolves.toBeTruthy()
  })

  it.each(validIssueTypes)('accepts issue type %s', async (issueType) => {
    await expect(insert('To Do', issueType)).resolves.toBeTruthy()
  })

  it.each(validPriorities)('accepts priority %s', async (priority) => {
    await expect(insert('To Do', 'Task', priority)).resolves.toBeTruthy()
  })

  it('accepts a status the app has never heard of', async () => {
    // Deliberate. The CHECKs were dropped so per-project configured statuses
    // (JL-78) can be stored; the route layer decides what is valid, not the
    // schema. If someone reinstates a CHECK generated from validStatuses, this
    // is the test that says why they should not.
    await expect(insert('Awaiting Sign-off', 'Task')).resolves.toBeTruthy()
  })
})
