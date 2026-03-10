import sqlite3 from 'sqlite3'

/**
 * Creates an in-memory SQLite database with the same schema as the app.
 * Returns promisified run/get/all helpers scoped to this DB instance.
 */
export function createTestDb() {
  const db = new sqlite3.Database(':memory:')

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) reject(err)
        else resolve(this)
      })
    })

  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })

  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })

  const close = () =>
    new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })

  return { db, run, get, all, close }
}

/**
 * Initializes the core schema tables needed for RBAC tests.
 */
export async function initTestSchema({ run }) {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      task_count INTEGER NOT NULL DEFAULT 0,
      invited_by TEXT,
      is_owner INTEGER NOT NULL DEFAULT 0
    )
  `)

  await run('CREATE INDEX IF NOT EXISTS idx_members_email ON members(email)')

  await run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'Scrum',
      lead TEXT NOT NULL,
      lead_member_id INTEGER,
      avatar_color TEXT NOT NULL DEFAULT '#0052cc',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, member_id)
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('Low', 'Medium', 'High')),
      assignee TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Backlog', 'To Do', 'In Progress', 'Code Review', 'Done')),
      issue_type TEXT NOT NULL CHECK(issue_type IN ('Story', 'Bug', 'Task')),
      sprint_id INTEGER,
      project_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS sprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date_range TEXT NOT NULL,
      is_started INTEGER NOT NULL DEFAULT 0
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      happened_at TEXT NOT NULL
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_email TEXT NOT NULL,
      criteria TEXT NOT NULL DEFAULT '{}',
      is_starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * Seeds test members with different roles.
 */
export async function seedTestMembers({ run }) {
  await run(
    "INSERT INTO members (name, email, role, status, is_owner) VALUES ('Owner User', 'owner@test.com', 'Admin', 'Active', 1)",
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
  // Owner is project Admin
  await run("INSERT INTO project_members (project_id, member_id, role) VALUES (1, 1, 'Admin')")
  // Admin is project Admin
  await run("INSERT INTO project_members (project_id, member_id, role) VALUES (1, 2, 'Admin')")
  // Member is project Member
  await run("INSERT INTO project_members (project_id, member_id, role) VALUES (1, 3, 'Member')")
  // Viewer is project Viewer
  await run("INSERT INTO project_members (project_id, member_id, role) VALUES (1, 4, 'Viewer')")
}
