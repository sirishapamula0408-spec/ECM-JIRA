// JL-155 — the dependents check against real PostgreSQL.
//
// The route tests use an in-memory fake, which cannot tell whether the SQL in
// findDependents is valid, whether information_schema sees the isolated test
// schema, or whether the audit_log exclusions actually exclude. This does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, cleanTestDb } from './setup.js'
import { classifyExistingLogin, findDependents } from '../services/reRegistration.js'

let testDb
let db

// The service writes `?` placeholders (converted by db.js in the app).
const pgSql = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`) }

beforeAll(async () => {
  testDb = createTestDb()
  await testDb.initSchema()
  db = {
    get: (sql, p) => testDb.get(pgSql(sql), p),
    all: (sql, p) => testDb.all(pgSql(sql), p),
  }
  await testDb.run(`CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active', active BOOLEAN NOT NULL DEFAULT TRUE)`)
  await testDb.run('CREATE TABLE members (id SERIAL PRIMARY KEY, email TEXT NOT NULL, status TEXT NOT NULL)')
  await testDb.run('CREATE TABLE comments (id SERIAL PRIMARY KEY, author TEXT NOT NULL)')
  await testDb.run('CREATE TABLE audit_log (id SERIAL PRIMARY KEY, actor TEXT, action TEXT NOT NULL)')
  await testDb.run('CREATE TABLE user_audit_log (id SERIAL PRIMARY KEY, actor TEXT, action TEXT NOT NULL)')
  await testDb.run('CREATE TABLE oauth_identities (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE)')

  await testDb.run(`INSERT INTO users (id, email, password_hash, status) VALUES
    (1, 'unused@x.com', 'h', 'Deactivated'),
    (2, 'author@x.com', 'h', 'Deactivated'),
    (3, 'sso@x.com', 'h', 'Deactivated'),
    (4, 'live@x.com', 'h', 'Active'),
    (5, 'suspended@x.com', 'h', 'Deactivated')`)
  await testDb.run("INSERT INTO members (email, status) VALUES ('suspended@x.com', 'Deactivated')")
  // Someone else hammering the unused address must not make it count as used.
  await testDb.run(`INSERT INTO audit_log (actor, action) VALUES
    ('unused@x.com', 'auth.login.failed'), ('system', 'auth.signup.stale_login_deleted')`)
  await testDb.run(`INSERT INTO user_audit_log (actor, action) VALUES
    ('unused@x.com', 'login_blocked'), ('system', 'signup_rejected')`)
  await testDb.run("INSERT INTO comments (author) VALUES (' Author@X.com ')") // stored untrimmed, mixed case
  await testDb.run('INSERT INTO oauth_identities (user_id) VALUES (3)')
})

afterAll(async () => {
  await cleanTestDb(testDb)
  await testDb.close()
})

describe('JL-155 findDependents / classifyExistingLogin (real PostgreSQL)', () => {
  it('finds nothing for a login only ever acted upon, so it may be replaced', async () => {
    expect(await findDependents({ id: 1, email: 'unused@x.com' }, db)).toEqual([])
    expect((await classifyExistingLogin('unused@x.com', db)).kind).toBe('replace')
  })

  it('counts authored content case-insensitively and trimmed', async () => {
    const found = await classifyExistingLogin('author@x.com', db)
    expect(found.kind).toBe('reactivate')
    expect(found.dependents).toEqual([{ table: 'comments', column: 'author', count: 1 }])
  })

  it('counts a row that would CASCADE away with the login', async () => {
    const found = await classifyExistingLogin('sso@x.com', db)
    expect(found.kind).toBe('reactivate')
    expect(found.dependents).toEqual([{ table: 'oauth_identities', column: 'user_id', count: 1 }])
  })

  it('skips referenced tables that do not exist rather than erroring', async () => {
    // issues, worklogs, wiki_pages … are absent from this schema.
    await expect(findDependents({ id: 1, email: 'unused@x.com' }, db)).resolves.toEqual([])
  })

  it('classifies an active login and a suspended member', async () => {
    expect((await classifyExistingLogin('LIVE@x.com', db)).kind).toBe('active')
    expect(await classifyExistingLogin('suspended@x.com', db)).toMatchObject({ kind: 'refused', reason: 'suspended' })
    expect((await classifyExistingLogin('nobody@x.com', db)).kind).toBe('none')
  })
})
