import fs from 'node:fs'
import path from 'node:path'
import sqlite3 from 'sqlite3'
import { DB_PATH } from './config.js'

const dbPath = DB_PATH
const dataDir = path.dirname(dbPath)

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

export const db = new sqlite3.Database(dbPath)

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err)
        return
      }
      resolve(this)
    })
  })
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err)
        return
      }
      resolve(rows)
    })
  })
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err)
        return
      }
      resolve(row)
    })
  })
}

function normalizeStatus(status) {
  const raw = String(status || '').trim()
  const mapped = {
    'In Review': 'Code Review',
    InReview: 'Code Review',
    Todo: 'To Do',
  }[raw] || raw

  const allowed = new Set(['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'])
  return allowed.has(mapped) ? mapped : 'Backlog'
}

function normalizePriority(priority) {
  const raw = String(priority || '').trim()
  return ['Low', 'Medium', 'High'].includes(raw) ? raw : 'Medium'
}

function normalizeIssueType(issueType) {
  const raw = String(issueType || '').trim()
  return ['Story', 'Bug', 'Task'].includes(raw) ? raw : 'Task'
}

async function migrateLegacyIssuesTable() {
  const table = await get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'issues'")
  const tableSql = table?.sql || ''
  const isCurrentSchema =
    tableSql.includes('issue_key') &&
    tableSql.includes('issue_type') &&
    tableSql.includes("'To Do'") &&
    tableSql.includes("'Code Review'")

  if (isCurrentSchema) {
    return
  }

  await run('ALTER TABLE issues RENAME TO issues_legacy')
  await run(`
    CREATE TABLE issues (
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
    );
  `)

  const rows = await all('SELECT * FROM issues_legacy ORDER BY id ASC')
  for (const row of rows) {
    const issueKey = row.issue_key || `PROJ-${100 + Number(row.id || 0)}`
    const title = String(row.title || 'Untitled issue')
    const description = String(row.description || 'No description provided.')
    const priority = normalizePriority(row.priority)
    const assignee = String(row.assignee || 'Unassigned')
    const status = normalizeStatus(row.status)
    const issueType = normalizeIssueType(row.issue_type)
    const createdAt = row.created_at || new Date().toISOString()
    const sprintId = row.sprint_id ?? null
    const projectId = row.project_id ?? null

    await run(
      `INSERT INTO issues
        (id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, issueKey, title, description, priority, assignee, status, issueType, sprintId, projectId, createdAt],
    )
  }

  await run('DROP TABLE issues_legacy')
}

async function ensureIssuesColumns() {
  const columns = await all("PRAGMA table_info('issues')")
  const hasSprintId = columns.some((column) => column.name === 'sprint_id')
  if (!hasSprintId) {
    await run('ALTER TABLE issues ADD COLUMN sprint_id INTEGER')
  }
}

async function ensureIssuesProjectId() {
  const columns = await all("PRAGMA table_info('issues')")
  const hasProjectId = columns.some((column) => column.name === 'project_id')
  if (!hasProjectId) {
    await run('ALTER TABLE issues ADD COLUMN project_id INTEGER')
  }
}

async function backfillIssueSprintAssignments(defaultSprintId) {
  await run("UPDATE issues SET sprint_id = NULL WHERE status = 'Backlog'")
  await run("UPDATE issues SET sprint_id = ? WHERE status <> 'Backlog' AND sprint_id IS NULL", [defaultSprintId])
}

async function ensureMembersColumns() {
  const columns = await all("PRAGMA table_info('members')")
  const hasInvitedBy = columns.some((column) => column.name === 'invited_by')
  if (!hasInvitedBy) {
    await run('ALTER TABLE members ADD COLUMN invited_by TEXT')
  }
}

async function ensureRoadmapProjectId() {
  const columns = await all("PRAGMA table_info('roadmap_epics')")
  const hasProjectId = columns.some((column) => column.name === 'project_id')
  if (!hasProjectId) {
    await run('ALTER TABLE roadmap_epics ADD COLUMN project_id INTEGER')
    // Backfill existing epics: first 3 → project 1, rest → project 2
    await run('UPDATE roadmap_epics SET project_id = 1 WHERE id IN (SELECT id FROM roadmap_epics ORDER BY id ASC LIMIT 3)')
    await run('UPDATE roadmap_epics SET project_id = 2 WHERE project_id IS NULL')
  }
}

async function ensureProfileColumns() {
  const columns = await all("PRAGMA table_info('profile')")
  const hasAvatarUrl = columns.some((column) => column.name === 'avatar_url')
  if (!hasAvatarUrl) {
    await run('ALTER TABLE profile ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ""')
  }
  const hasUserId = columns.some((column) => column.name === 'user_id')
  if (!hasUserId) {
    await run('ALTER TABLE profile ADD COLUMN user_id INTEGER')
  }
}

export async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
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
    );
  `)
  await migrateLegacyIssuesTable()
  await ensureIssuesColumns()
  await ensureIssuesProjectId()

  await run(`
    CREATE TABLE IF NOT EXISTS sprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date_range TEXT NOT NULL,
      is_started INTEGER NOT NULL DEFAULT 0
    );
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      happened_at TEXT NOT NULL
    );
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      task_count INTEGER NOT NULL DEFAULT 0,
      invited_by TEXT
    );
  `)
  await ensureMembersColumns()

  await run(`
    CREATE TABLE IF NOT EXISTS roadmap_epics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phase TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      project_id INTEGER
    );
  `)
  await ensureRoadmapProjectId()

  await run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'Scrum',
      lead TEXT NOT NULL,
      avatar_color TEXT NOT NULL DEFAULT '#0052cc',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, member_id)
    );
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_type TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      workflow_status TEXT NOT NULL
    );
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      department TEXT NOT NULL,
      timezone TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT "",
      user_id INTEGER
    );
  `)
  await ensureProfileColumns()

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
    );
  `)

  const { seedDatabase } = await import('./seed.js')
  const defaultSprintId = await seedDatabase()
  await backfillIssueSprintAssignments(defaultSprintId)
}
