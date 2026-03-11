import pg from 'pg'
import crypto from 'node:crypto'

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://jira_lite:jira_lite_dev@localhost:5432/jira_lite_test'

/**
 * Creates a PostgreSQL test connection with promisified helpers.
 * Each call creates a unique schema to avoid parallel test conflicts.
 */
export function createTestDb() {
  const schemaName = `test_${crypto.randomBytes(4).toString('hex')}`
  const pool = new pg.Pool({
    connectionString: TEST_DB_URL,
    max: 2,
  })

  const run = async (sql, params = []) => {
    const result = await pool.query(sql, params)
    return { lastID: result.rows?.[0]?.id ?? null, changes: result.rowCount ?? 0 }
  }

  const get = async (sql, params = []) => {
    const result = await pool.query(sql, params)
    return result.rows[0] || null
  }

  const all = async (sql, params = []) => {
    const result = await pool.query(sql, params)
    return result.rows
  }

  const close = async () => {
    await pool.end()
  }

  // Hook into pool to set search_path on every new connection
  pool.on('connect', (client) => {
    client.query(`SET search_path TO ${schemaName}`)
  })

  // Create isolated schema
  const initSchema = async () => {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`)
    await pool.query(`SET search_path TO ${schemaName}`)
  }

  return { pool, run, get, all, close, schemaName, initSchema }
}

/**
 * Initializes the core schema tables needed for RBAC tests.
 */
export async function initTestSchema({ run, initSchema }) {
  await initSchema()
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      task_count INTEGER NOT NULL DEFAULT 0,
      invited_by TEXT,
      is_owner BOOLEAN NOT NULL DEFAULT FALSE
    )
  `)

  await run('CREATE INDEX IF NOT EXISTS idx_members_email ON members(email)')

  await run(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'Scrum',
      lead TEXT NOT NULL,
      lead_member_id INTEGER,
      avatar_color TEXT NOT NULL DEFAULT '#0052cc',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS project_members (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, member_id)
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS issues (
      id SERIAL PRIMARY KEY,
      issue_key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('Low', 'Medium', 'High')),
      assignee TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Backlog', 'To Do', 'In Progress', 'Code Review', 'Done')),
      issue_type TEXT NOT NULL CHECK(issue_type IN ('Story', 'Bug', 'Task')),
      sprint_id INTEGER,
      project_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS sprints (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      date_range TEXT NOT NULL,
      is_started BOOLEAN NOT NULL DEFAULT FALSE
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS activity (
      id SERIAL PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      happened_at TEXT NOT NULL
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS profile (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      department TEXT NOT NULL,
      timezone TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      user_id INTEGER
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS filters (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_email TEXT NOT NULL,
      criteria JSONB NOT NULL DEFAULT '{}',
      is_starred BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

/**
 * Seeds test members with different roles.
 */
export async function seedTestMembers({ run }) {
  await run(
    "INSERT INTO members (name, email, role, status, is_owner) VALUES ('Owner User', 'owner@test.com', 'Admin', 'Active', TRUE)",
  )
  await run(
    "INSERT INTO members (name, email, role, status) VALUES ('Admin User', 'admin@test.com', 'Admin', 'Active')",
  )
  await run(
    "INSERT INTO members (name, email, role, status) VALUES ('Member User', 'member@test.com', 'Member', 'Active')",
  )
  await run(
    "INSERT INTO members (name, email, role, status) VALUES ('Viewer User', 'viewer@test.com', 'Viewer', 'Active')",
  )
}

/**
 * Seeds a test project and project_members entries.
 */
export async function seedTestProject({ run }) {
  await run(
    "INSERT INTO projects (name, key, type, lead) VALUES ('Test Project', 'TP', 'Scrum', 'Owner User')",
  )
  await run("INSERT INTO project_members (project_id, member_id, role) VALUES (1, 1, 'Admin')")
  await run("INSERT INTO project_members (project_id, member_id, role) VALUES (1, 2, 'Admin')")
  await run("INSERT INTO project_members (project_id, member_id, role) VALUES (1, 3, 'Member')")
  await run("INSERT INTO project_members (project_id, member_id, role) VALUES (1, 4, 'Viewer')")
}

/**
 * Drops the test schema for clean state.
 */
export async function cleanTestDb({ pool, schemaName }) {
  await pool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
}
