import pg from 'pg'
import { DATABASE_URL } from './config.js'

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message)
})

/**
 * Convert SQLite-style `?` placeholders to PostgreSQL `$1, $2, ...` style.
 * Ignores `?` inside single-quoted strings.
 */
function convertPlaceholders(sql) {
  let idx = 0
  let inString = false
  let result = ''
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'" && sql[i - 1] !== '\\') {
      inString = !inString
      result += ch
    } else if (ch === '?' && !inString) {
      idx++
      result += `$${idx}`
    } else {
      result += ch
    }
  }
  return result
}

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE).
 * Returns { lastID, changes } for compatibility with SQLite wrapper.
 */
export async function run(sql, params = []) {
  const pgSql = convertPlaceholders(sql)
  const isInsert = /^\s*INSERT\b/i.test(pgSql)

  // Auto-append RETURNING id for INSERT statements that don't already have it
  let finalSql = pgSql
  if (isInsert && !/RETURNING\b/i.test(pgSql)) {
    finalSql = pgSql.replace(/;?\s*$/, ' RETURNING id')
  }

  const result = await pool.query(finalSql, params)
  return {
    lastID: result.rows?.[0]?.id ?? null,
    changes: result.rowCount ?? 0,
  }
}

/**
 * Query multiple rows.
 */
export async function all(sql, params = []) {
  const pgSql = convertPlaceholders(sql)
  const result = await pool.query(pgSql, params)
  return result.rows
}

/**
 * Query a single row.
 */
export async function get(sql, params = []) {
  const pgSql = convertPlaceholders(sql)
  const result = await pool.query(pgSql, params)
  return result.rows[0] || null
}

/**
 * Check if a column exists in a table (replaces PRAGMA table_info).
 */
export async function columnExists(table, column) {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  )
  return result.rows.length > 0
}

/**
 * Check if a table exists.
 */
export async function tableExists(table) {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  return result.rows.length > 0
}

/**
 * Initialize all database tables with PostgreSQL-native types.
 */
export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
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

  await pool.query('CREATE INDEX IF NOT EXISTS idx_members_email ON members(email)')

  await pool.query(`
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_members (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'Member',
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, member_id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sprints (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      date_range TEXT NOT NULL,
      is_started BOOLEAN NOT NULL DEFAULT FALSE
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id SERIAL PRIMARY KEY,
      issue_key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('Low', 'Medium', 'High')),
      assignee TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Backlog', 'To Do', 'In Progress', 'Code Review', 'Done')),
      issue_type TEXT NOT NULL CHECK(issue_type IN ('Story', 'Bug', 'Task')),
      sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_sprint_id ON issues(sprint_id)')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity (
      id SERIAL PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      happened_at TEXT NOT NULL
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roadmap_epics (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phase TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflows (
      id SERIAL PRIMARY KEY,
      issue_type TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      workflow_status TEXT NOT NULL
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query('CREATE INDEX IF NOT EXISTS idx_comments_issue_id ON comments(issue_id)')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      department TEXT NOT NULL,
      timezone TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  await pool.query(`
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

  // Add FK from projects to members (can't add inline due to table creation order)
  const fkExists = await get(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'fk_projects_lead_member' AND table_name = 'projects'`,
  )
  if (!fkExists) {
    await pool.query(`
      ALTER TABLE projects
      ADD CONSTRAINT fk_projects_lead_member
      FOREIGN KEY (lead_member_id) REFERENCES members(id) ON DELETE SET NULL
    `).catch(() => {}) // Ignore if already exists
  }

  const { seedDatabase } = await import('./seed.js')
  await seedDatabase()
}

/**
 * Gracefully close the connection pool.
 */
export async function closePool() {
  await pool.end()
}

// Graceful shutdown
process.on('SIGINT', () => { pool.end(); process.exit(0) })
process.on('SIGTERM', () => { pool.end(); process.exit(0) })
