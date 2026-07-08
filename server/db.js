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

  // Add optional columns to activity for filtering (Module 4)
  const hasActivityType = await columnExists('activity', 'activity_type')
  if (!hasActivityType) {
    await pool.query("ALTER TABLE activity ADD COLUMN activity_type TEXT NOT NULL DEFAULT 'general'")
    await pool.query('ALTER TABLE activity ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL')
    await pool.query('ALTER TABLE activity ADD COLUMN issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL')
    await pool.query("ALTER TABLE activity ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
  }

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

  // --- Module 1: @Mentions ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mentions (
      id SERIAL PRIMARY KEY,
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      mentioned_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_mentions_comment_id ON mentions(comment_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_mentions_email ON mentions(mentioned_email)')

  // --- Module 2: Notifications ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      recipient_email TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      actor_email TEXT,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_email)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(recipient_email, is_read)')

  // --- Module 3: Watch/Follow Issues ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchers (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(issue_id, user_email)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_watchers_issue ON watchers(issue_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_watchers_email ON watchers(user_email)')

  // --- Module 5: Approval Workflows ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS approval_rules (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      required_approvals INTEGER NOT NULL DEFAULT 1,
      approver_role TEXT NOT NULL DEFAULT 'Admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, from_status, to_status)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS approvals (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      approver_email TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('approved', 'rejected', 'pending')),
      comment TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_approvals_issue ON approvals(issue_id)')

  // --- Module 6: Shared Dashboards ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_dashboards (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_email TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      visibility TEXT NOT NULL DEFAULT 'private',
      layout JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_shared_dashboards_owner ON shared_dashboards(owner_email)')

  // --- Module 7: Webhook Integrations ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT DEFAULT '',
      events JSONB NOT NULL DEFAULT '[]',
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // --- JL-59: Event-type subscriptions (idempotent migration for pre-existing DBs) ---
  if (!(await columnExists('webhooks', 'events'))) {
    await pool.query("ALTER TABLE webhooks ADD COLUMN events JSONB NOT NULL DEFAULT '[]'")
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id SERIAL PRIMARY KEY,
      webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      response_status INTEGER,
      response_body TEXT DEFAULT '',
      success BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id)')

  // --- Module 8: Project Wiki ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiki_pages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      parent_id INTEGER REFERENCES wiki_pages(id) ON DELETE SET NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_wiki_pages_project ON wiki_pages(project_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent ON wiki_pages(parent_id)')

  // --- JL-42: Notification Preferences ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL UNIQUE,
      in_app BOOLEAN NOT NULL DEFAULT TRUE,
      email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      email_digest TEXT NOT NULL DEFAULT 'off',
      muted_types JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // --- JL-48: Wiki Page Versions ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiki_page_versions (
      id SERIAL PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      edited_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_wiki_versions_page ON wiki_page_versions(page_id)')

  // --- JL-48: Issue-Wiki Page Links ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_wiki_links (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      wiki_page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(issue_id, wiki_page_id)
    )
  `)

  // --- Theme-1 #1: Sub-tasks ---
  // Nullable self-referencing parent; deleting a parent cascades to its sub-tasks.
  if (!(await columnExists('issues', 'parent_id'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN parent_id INTEGER REFERENCES issues(id) ON DELETE CASCADE')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_parent_id ON issues(parent_id)')
  }
  // Widen the issue_type CHECK to allow 'Sub-task' and 'Epic' (JL-76)
  await pool.query('ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_issue_type_check')
  await pool.query("ALTER TABLE issues ADD CONSTRAINT issues_issue_type_check CHECK (issue_type IN ('Epic', 'Story', 'Bug', 'Task', 'Sub-task'))")

  // --- JL-76: Epic issue type & Epic→Story→Sub-task hierarchy ---
  // A Story/Task/Bug can belong to a parent Epic via epic_id; clearing the Epic
  // detaches children (SET NULL) rather than deleting them.
  if (!(await columnExists('issues', 'epic_id'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN epic_id INTEGER REFERENCES issues(id) ON DELETE SET NULL')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_epic_id ON issues(epic_id)')
  }

  // --- JL-82: Per-issue change history / audit log ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_history (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      actor TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_history_issue ON issue_history(issue_id)')

  // --- Theme-1 #5: Time Tracking ---
  if (!(await columnExists('issues', 'original_estimate_minutes'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN original_estimate_minutes INTEGER')
  }

  // --- JL-77: Expanded issue field model ---
  // reporter, due/start date, resolution, environment, components, updated_at.
  // Idempotent per-column migrations (Story points / fix versions are out of scope).
  if (!(await columnExists('issues', 'reporter'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN reporter TEXT')
  }
  if (!(await columnExists('issues', 'due_date'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN due_date DATE')
  }
  if (!(await columnExists('issues', 'start_date'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN start_date DATE')
  }
  if (!(await columnExists('issues', 'resolution'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN resolution TEXT')
  }
  if (!(await columnExists('issues', 'environment'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN environment TEXT')
  }
  if (!(await columnExists('issues', 'components'))) {
    // Comma-separated list for v1.
    await pool.query('ALTER TABLE issues ADD COLUMN components TEXT')
  }
  if (!(await columnExists('issues', 'updated_at'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN updated_at TIMESTAMPTZ')
  }

  // --- JL-86: Reporting data foundation ---
  // Story points on issues (nullable). Real sprint dates + completion timestamp.
  if (!(await columnExists('issues', 'story_points'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN story_points INTEGER')
  }
  if (!(await columnExists('sprints', 'start_date'))) {
    await pool.query('ALTER TABLE sprints ADD COLUMN start_date TIMESTAMPTZ')
  }
  if (!(await columnExists('sprints', 'end_date'))) {
    await pool.query('ALTER TABLE sprints ADD COLUMN end_date TIMESTAMPTZ')
  }
  if (!(await columnExists('sprints', 'completed_at'))) {
    await pool.query('ALTER TABLE sprints ADD COLUMN completed_at TIMESTAMPTZ')
  }
  // Scope snapshot per sprint: what issues (and their points) were in scope,
  // when they were added, and if/when removed. Drives burndown/burnup/CFD later.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sprint_scope (
      id SERIAL PRIMARY KEY,
      sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      points INTEGER,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      removed_at TIMESTAMPTZ
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sprint_scope_sprint ON sprint_scope(sprint_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sprint_scope_issue ON sprint_scope(issue_id)')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS worklogs (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      time_spent_minutes INTEGER NOT NULL,
      description TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_worklogs_issue ON worklogs(issue_id)')

  // --- Theme-1 #8: Automation Rules ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_rules (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      condition_value TEXT DEFAULT '',
      action_type TEXT NOT NULL,
      action_value TEXT DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_logs (
      id SERIAL PRIMARY KEY,
      rule_id INTEGER REFERENCES automation_rules(id) ON DELETE CASCADE,
      issue_id INTEGER,
      status TEXT NOT NULL,
      message TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_automation_rules_project ON automation_rules(project_id)')

  // --- Theme-1 #7: Custom Fields (EAV) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_fields (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL CHECK(field_type IN ('text', 'number', 'date', 'dropdown')),
      options JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_custom_field_values (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
      value TEXT,
      UNIQUE(issue_id, field_id)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cfv_issue ON issue_custom_field_values(issue_id)')

  // --- Theme-1 #4: Issue Linking ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_links (
      id SERIAL PRIMARY KEY,
      source_issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      target_issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_issue_id, target_issue_id, link_type)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_links_source ON issue_links(source_issue_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_links_target ON issue_links(target_issue_id)')

  // --- Theme-1 #3: Attachments ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      storage_path TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_attachments_issue ON attachments(issue_id)')

  // --- Theme-1 #2: Labels / Tags ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS labels (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#42526E',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, name)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_labels (
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (issue_id, label_id)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_labels_label ON issue_labels(label_id)')

  // --- JL-57: Release Management ---
  // Named releases per project with a target date; issues are assigned via issues.release_id.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS releases (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      release_date DATE,
      status TEXT NOT NULL DEFAULT 'unreleased' CHECK (status IN ('unreleased', 'released')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_releases_project ON releases(project_id)')
  // Nullable FK on issues; unassigning is handled by setting to NULL on release delete.
  if (!(await columnExists('issues', 'release_id'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN release_id INTEGER REFERENCES releases(id) ON DELETE SET NULL')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_release_id ON issues(release_id)')
  }

  // --- JL-78: Configurable priorities & statuses per project ---
  // project_id NULL => global default. Non-null => project-level override.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_priorities (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#42526E',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_priorities_project ON issue_priorities(project_id)')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_statuses (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#42526E',
      category TEXT NOT NULL DEFAULT 'todo' CHECK(category IN ('todo', 'inprogress', 'done')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_statuses_project ON issue_statuses(project_id)')

  // Seed global defaults (project_id NULL) only if the table has no global rows.
  const prioSeeded = await get('SELECT 1 FROM issue_priorities WHERE project_id IS NULL LIMIT 1')
  if (!prioSeeded) {
    const defaultPriorities = [
      ['Lowest', 0, '#57D9A3'],
      ['Low', 1, '#79E2F2'],
      ['Medium', 2, '#FFAB00'],
      ['High', 3, '#FF7452'],
      ['Highest', 4, '#FF5630'],
    ]
    for (const [name, position, color] of defaultPriorities) {
      await pool.query(
        'INSERT INTO issue_priorities (project_id, name, position, color) VALUES (NULL, $1, $2, $3)',
        [name, position, color],
      )
    }
  }
  const statusSeeded = await get('SELECT 1 FROM issue_statuses WHERE project_id IS NULL LIMIT 1')
  if (!statusSeeded) {
    const defaultStatuses = [
      ['Backlog', 0, '#42526E', 'todo'],
      ['To Do', 1, '#42526E', 'todo'],
      ['In Progress', 2, '#0052CC', 'inprogress'],
      ['Code Review', 3, '#0052CC', 'inprogress'],
      ['Done', 4, '#36B37E', 'done'],
    ]
    for (const [name, position, color, category] of defaultStatuses) {
      await pool.query(
        'INSERT INTO issue_statuses (project_id, name, position, color, category) VALUES (NULL, $1, $2, $3, $4)',
        [name, position, color, category],
      )
    }
  }

  // Relax the hardcoded CHECK constraints on issues so custom values are allowed.
  // Validation now happens in the route layer against the configured lists.
  await pool.query('ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_priority_check')
  await pool.query('ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_check')

  // --- JL-84: Public REST API tokens ---
  // Stores only a SHA-256 hash of each token; plaintext is shown once at creation.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL DEFAULT '',
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_email)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)')

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
