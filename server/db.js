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
 * JL-94 — Run a set of writes inside a single database transaction.
 *
 * Checks out a dedicated client from the pool, issues BEGIN, then invokes
 * `fn(tx)` where `tx` exposes the same `run/get/all` interface as the module
 * wrappers — bound to that one client so every statement shares the same
 * transaction. Placeholders (`?` → `$n`) and the INSERT `RETURNING id`
 * auto-append behaviour match the non-transactional helpers exactly.
 *
 * On success the transaction is COMMITted and `fn`'s return value is returned.
 * On any error the transaction is ROLLBACKed and the error is rethrown. The
 * client is always released back to the pool.
 *
 * Usage:
 *   await withTransaction(async (tx) => {
 *     const { lastID } = await tx.run('INSERT INTO ... VALUES (?, ?)', [a, b])
 *     await tx.run('INSERT INTO ... VALUES (?)', [lastID])
 *   })
 */
export async function withTransaction(fn) {
  const client = await pool.connect()

  const txRun = async (sql, params = []) => {
    const pgSql = convertPlaceholders(sql)
    const isInsert = /^\s*INSERT\b/i.test(pgSql)
    let finalSql = pgSql
    if (isInsert && !/RETURNING\b/i.test(pgSql)) {
      finalSql = pgSql.replace(/;?\s*$/, ' RETURNING id')
    }
    const result = await client.query(finalSql, params)
    return {
      lastID: result.rows?.[0]?.id ?? null,
      changes: result.rowCount ?? 0,
    }
  }

  const txAll = async (sql, params = []) => {
    const result = await client.query(convertPlaceholders(sql), params)
    return result.rows
  }

  const txGet = async (sql, params = []) => {
    const result = await client.query(convertPlaceholders(sql), params)
    return result.rows[0] || null
  }

  try {
    await client.query('BEGIN')
    const out = await fn({ run: txRun, get: txGet, all: txAll })
    await client.query('COMMIT')
    return out
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failures; surface the original error below.
    }
    throw err
  } finally {
    client.release()
  }
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
 * JL-211 — Read a workspace-level setting from the `workspace_settings` key/value
 * store. Returns `fallback` when the key is absent (or the table isn't ready yet).
 */
export async function getSetting(key, fallback = null) {
  const row = await get('SELECT value FROM workspace_settings WHERE key = ?', [key])
  return row && row.value != null ? row.value : fallback
}

/**
 * JL-211 — Upsert a workspace-level setting. Explicit `RETURNING key` keeps the
 * `run()` wrapper from injecting `RETURNING id` (this table has no `id` column).
 */
export async function setSetting(key, value) {
  await run(
    `INSERT INTO workspace_settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
     RETURNING key`,
    [key, value == null ? null : String(value)],
  )
  return { key, value }
}

/**
 * Initialize all database tables with PostgreSQL-native types.
 */
export async function initializeDatabase() {
  // --- JL-95: Schema migration tracking (additive, idempotent) ---
  // Lightweight ledger of which versioned migrations have run. Layered on top of
  // the existing idempotent DDL below; it does not replace it. A 'baseline'
  // version is recorded once to mark the initial schema.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      name TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  const { recordMigration } = await import('./services/migrations.js')
  await recordMigration('baseline', 'Initial ECM JIRA schema baseline')

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

  // --- JL-192: account status for login gating (Active / Invited / Deactivated) ---
  // Mirrors members.status onto the auth `users` table so login can block
  // Deactivated accounts before issuing a JWT. Uses the ADD COLUMN migration style.
  if (!(await columnExists('users', 'status'))) {
    await pool.query("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'")
  }

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

  // JL-160: track when a comment was last edited
  if (!(await columnExists('comments', 'edited_at'))) {
    await pool.query('ALTER TABLE comments ADD COLUMN edited_at TIMESTAMPTZ')
  }

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

  // JL-74: Member invitations for self-serve workspace onboarding
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      token TEXT NOT NULL UNIQUE,
      invited_by TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'revoked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `)

  await pool.query('CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status)')

  // --- JL-81: MFA (TOTP) + OAuth/SSO identities ---
  // Per-user TOTP secret (base32) and enable flag. Idempotent column adds.
  if (!(await columnExists('users', 'mfa_secret'))) {
    await pool.query('ALTER TABLE users ADD COLUMN mfa_secret TEXT')
  }
  if (!(await columnExists('users', 'mfa_enabled'))) {
    await pool.query('ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE')
  }

  // Linked external identities (Google / GitHub / Microsoft, …). One row per
  // (provider, provider_user_id); a user may link several providers.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_identities (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider, provider_user_id)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id)')

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

  // --- JL-120: Shared & favourited saved filters ---
  // Visibility: 'private' (owner only) or 'shared' (whole workspace). Idempotent.
  if (!(await columnExists('filters', 'visibility'))) {
    await pool.query("ALTER TABLE filters ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'")
  }
  // Per-user favourites (star) for any filter the user can see.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS filter_favorites (
      id SERIAL PRIMARY KEY,
      filter_id INTEGER NOT NULL REFERENCES filters(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (filter_id, user_email)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_filter_favorites_user ON filter_favorites(user_email)')

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
  // JL-166: allow mentions that originate from an issue description (no comment).
  // comment_id becomes nullable; issue_id links the mention to its issue.
  await pool.query('ALTER TABLE mentions ALTER COLUMN comment_id DROP NOT NULL')
  if (!(await columnExists('mentions', 'issue_id'))) {
    await pool.query('ALTER TABLE mentions ADD COLUMN issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_mentions_issue_id ON mentions(issue_id)')
  }

  // --- JL-139: Comment reactions (emoji) ---
  // A user may react to a comment with several distinct emoji, but the same
  // (comment, emoji, user) combination is unique so a react toggles cleanly.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comment_reactions (
      id SERIAL PRIMARY KEY,
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      user_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(comment_id, emoji, user_email)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment_id ON comment_reactions(comment_id)')

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

  // --- JL-159: Star / favorite projects ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_favorites (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, user_email)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_project_favorites_email ON project_favorites(user_email)')

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

  // --- JL-92: Monotonic per-project issue-key counter ---
  // Replaces the fragile COUNT(*)+1 key generation (which reused numbers after a
  // delete and could collide under concurrency). Each project holds a counter that
  // is atomically incremented on issue create and never reused. On first add we
  // backfill each project's counter to the current MAX issue-key suffix so existing
  // keys keep advancing rather than restarting from 1.
  if (!(await columnExists('projects', 'issue_counter'))) {
    await pool.query('ALTER TABLE projects ADD COLUMN issue_counter INTEGER NOT NULL DEFAULT 0')
    await pool.query(`
      UPDATE projects p
      SET issue_counter = sub.max_num
      FROM (
        SELECT project_id,
               MAX((regexp_replace(issue_key, '^.*-', ''))::int) AS max_num
        FROM issues
        WHERE project_id IS NOT NULL AND issue_key ~ '-[0-9]+$'
        GROUP BY project_id
      ) sub
      WHERE p.id = sub.project_id
    `)
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

  // --- JL-52: SLA Tracking & Alerts ---
  // Per-project SLA targets keyed by issue priority. `target_hours` is the
  // budget an issue has before it breaches; `applies_to` distinguishes a
  // resolution SLA (time to Done) from a response SLA (time to first action).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sla_policies (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      priority TEXT NOT NULL,
      target_hours INTEGER NOT NULL,
      applies_to TEXT NOT NULL DEFAULT 'resolution'
        CHECK (applies_to IN ('resolution', 'response')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sla_policies_project ON sla_policies(project_id)')

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

  // --- JL-215: Flag issue as impediment ---
  // JIRA-style "Add flag" — a simple boolean toggled via PATCH /api/issues/:id
  // and surfaced as a warning indicator on board cards and backlog rows.
  await pool.query('ALTER TABLE issues ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE')

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

  // --- JL-53: Capacity Planning ---
  // Per-assignee capacity (in story points) for a given sprint. `assignee` is
  // the member key (matches issues.assignee). One row per (assignee, sprint).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_capacity (
      id SERIAL PRIMARY KEY,
      assignee TEXT NOT NULL,
      sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
      capacity_points INTEGER NOT NULL DEFAULT 0,
      UNIQUE (assignee, sprint_id)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_member_capacity_sprint ON member_capacity(sprint_id)')
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
  // JL-119: scheduled (time-based) automation triggers. trigger_type is a plain
  // TEXT column (no CHECK constraint), so a new 'scheduled' value needs no schema
  // relaxation — validation lives at the route layer. Add scheduling columns idempotently.
  await pool.query('ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS schedule_interval_minutes INTEGER')
  await pool.query('ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP')

  // --- JL-79: Configurable Workflow Engine (transitions, validators, post-functions) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_transitions (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      validators JSONB NOT NULL DEFAULT '[]'::jsonb,
      post_functions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_workflow_transitions_project ON workflow_transitions(project_id)')

  // --- Theme-1 #7: Custom Fields (EAV) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_fields (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL CHECK(field_type IN ('text', 'number', 'date', 'dropdown', 'multi_select', 'labels', 'user_picker', 'cascading_select', 'calculated')),
      options JSONB,
      config JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  // JL-113: extend existing installs with new field types + config column (idempotent)
  await pool.query('ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS config JSONB')
  await pool.query('ALTER TABLE custom_fields DROP CONSTRAINT IF EXISTS custom_fields_field_type_check')
  await pool.query(`
    ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_field_type_check
    CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'multi_select', 'labels', 'user_picker', 'cascading_select', 'calculated'))
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

  // --- JL-137: cloud storage backend + thumbnail key (idempotent) ---
  if (!(await columnExists('attachments', 'thumbnail_key'))) {
    await pool.query('ALTER TABLE attachments ADD COLUMN thumbnail_key TEXT')
  }
  if (!(await columnExists('attachments', 'storage_backend'))) {
    await pool.query("ALTER TABLE attachments ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'local'")
  }

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

  // --- JL-197: append-only audit trail for user-administration actions ---
  // Records who did what to which member (role change, create, invite,
  // deactivate/reactivate, delete, login block). No update/delete routes exist.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_audit_log (
      id SERIAL PRIMARY KEY,
      actor TEXT,
      target_member_id INTEGER,
      target_email TEXT,
      action TEXT NOT NULL,
      before_value TEXT,
      after_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_audit_target_email ON user_audit_log(target_email)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_audit_action ON user_audit_log(action)')

  // --- JL-111: First-class Components ---
  // Per-project component objects; issues link to components via issue_components.
  // (The legacy free-text issues.components column stays alongside this.)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS components (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      lead TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, name)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_components (
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
      PRIMARY KEY (issue_id, component_id)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_components_component ON issue_components(component_id)')

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

  // --- JL-112: Fix/Affects Versions ---
  // Multiple typed version associations per issue (fix vs affects). "Versions" are the
  // existing JL-57 releases; an issue may be tied to many releases under each type.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_versions (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      version_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('fix', 'affects')),
      UNIQUE (issue_id, version_id, type)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_versions_issue ON issue_versions(issue_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_versions_version ON issue_versions(version_id)')

  // --- JL-54: OKR / Goal Tracking ---
  // Objectives per project, each with measurable key results tracked to progress.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS goals (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      objective TEXT NOT NULL,
      description TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'on_track' CHECK (status IN ('on_track', 'at_risk', 'off_track', 'done')),
      due_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id)')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS key_results (
      id SERIAL PRIMARY KEY,
      goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      target_value NUMERIC NOT NULL DEFAULT 100,
      current_value NUMERIC NOT NULL DEFAULT 0,
      unit TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_key_results_goal ON key_results(goal_id)')
  // Optional link between a key result and an issue for issue-driven progress.
  if (!(await columnExists('key_results', 'issue_id'))) {
    await pool.query('ALTER TABLE key_results ADD COLUMN issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL')
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

  // --- JL-116: Issue-type schemes (which issue types apply per project) ---
  // project_id NULL => global default scheme. Non-null (UNIQUE) => project-level
  // override. `allowed_types` is a JSONB array of type names; `default_type` is
  // the pre-selected type in the Create Issue modal. Resolution mirrors JL-78:
  // a project's own row wins, else fall back to the global default.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_type_schemes (
      id SERIAL PRIMARY KEY,
      project_id INTEGER UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      allowed_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_type TEXT NOT NULL DEFAULT 'Task',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_type_schemes_project ON issue_type_schemes(project_id)')
  // Seed the single global-default scheme (project_id NULL) if none exists.
  const typeSchemeSeeded = await get('SELECT 1 FROM issue_type_schemes WHERE project_id IS NULL LIMIT 1')
  if (!typeSchemeSeeded) {
    await pool.query(
      "INSERT INTO issue_type_schemes (project_id, allowed_types, default_type) VALUES (NULL, $1::jsonb, $2)",
      [JSON.stringify(['Story', 'Bug', 'Task', 'Epic', 'Sub-task']), 'Task'],
    )
  }

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

  // --- JL-85: Board configuration (swimlanes, quick filters, WIP limits) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_configs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      swimlane_by TEXT NOT NULL DEFAULT 'none',
      wip_limits JSONB NOT NULL DEFAULT '{}',
      quick_filters JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_board_configs_project ON board_configs(project_id)')

  // --- JL-126: Configurable estimation statistic per board ---
  // Which statistic drives sprint/backlog totals:
  //   'story_points' | 'time_estimate' | 'issue_count'. Lives on the board config.
  await pool.query(
    "ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS estimation_statistic TEXT NOT NULL DEFAULT 'story_points'",
  )
  // Ensure story_points can hold fractional/large values (JIRA allows decimals).
  if (!(await columnExists('issues', 'story_points'))) {
    await pool.query('ALTER TABLE issues ADD COLUMN story_points NUMERIC')
  }

  // --- JL-55: Git Integration (branch / commit / PR linking) ---
  // Records links between issues and git refs. No live provider — records + ingest only.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS git_links (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL CHECK(link_type IN ('branch', 'commit', 'pull_request')),
      ref TEXT NOT NULL,
      url TEXT DEFAULT '',
      title TEXT DEFAULT '',
      author TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_git_links_issue ON git_links(issue_id)')

  // --- JL-56: CI/CD Pipeline Status ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ci_builds (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
      pipeline TEXT,
      branch TEXT,
      commit_ref TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'canceled')),
      url TEXT,
      duration_seconds INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ci_builds_issue ON ci_builds(issue_id, created_at DESC)')

  // --- JL-80: Permission & Notification Schemes ---
  // Assignable schemes that make the fixed role→capability map configurable.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permission_schemes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permission_grants (
      id SERIAL PRIMARY KEY,
      scheme_id INTEGER NOT NULL REFERENCES permission_schemes(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      role TEXT NOT NULL,
      UNIQUE(scheme_id, permission_key, role)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_permission_grants_scheme ON permission_grants(scheme_id)')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_schemes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_rules (
      id SERIAL PRIMARY KEY,
      scheme_id INTEGER NOT NULL REFERENCES notification_schemes(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL,
      notify_role TEXT NOT NULL,
      UNIQUE(scheme_id, event_key, notify_role)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notification_rules_scheme ON notification_rules(scheme_id)')

  // Nullable FKs on projects: a project may reference a scheme, else the default applies.
  if (!(await columnExists('projects', 'permission_scheme_id'))) {
    await pool.query('ALTER TABLE projects ADD COLUMN permission_scheme_id INTEGER REFERENCES permission_schemes(id) ON DELETE SET NULL')
  }
  if (!(await columnExists('projects', 'notification_scheme_id'))) {
    await pool.query('ALTER TABLE projects ADD COLUMN notification_scheme_id INTEGER REFERENCES notification_schemes(id) ON DELETE SET NULL')
  }

  // --- JL-124: Parallel (concurrent) active sprints (opt-in per project) ---
  // Default FALSE preserves the single-active-sprint behavior; admins may opt in.
  if (!(await columnExists('projects', 'allow_parallel_sprints'))) {
    await pool.query('ALTER TABLE projects ADD COLUMN allow_parallel_sprints BOOLEAN NOT NULL DEFAULT FALSE')
  }

  // Seed the DEFAULT permission scheme (mirrors the fixed role→capability map in
  // middleware/authorize.js + hooks/usePermissions.js). Grants store the MINIMUM
  // role that holds each capability; higher roles inherit via rank in the resolver.
  const permSchemeSeeded = await get('SELECT id FROM permission_schemes WHERE is_default = TRUE LIMIT 1')
  if (!permSchemeSeeded) {
    const permRes = await pool.query(
      "INSERT INTO permission_schemes (name, description, is_default) VALUES ('Default Permission Scheme', 'Mirrors the built-in role hierarchy: Members can create/edit issues and comment; Admins manage issues, sprints, members and workflows.', TRUE) RETURNING id",
    )
    const permSchemeId = permRes.rows[0].id
    const defaultGrants = [
      ['issue.create', 'Member'],
      ['issue.edit', 'Member'],
      ['comment.add', 'Member'],
      ['issue.delete', 'Admin'],
      ['sprints.manage', 'Admin'],
      ['project.settings', 'Admin'],
      ['members.manage', 'Admin'],
      ['workflows.edit', 'Admin'],
    ]
    for (const [permissionKey, role] of defaultGrants) {
      await pool.query(
        'INSERT INTO permission_grants (scheme_id, permission_key, role) VALUES ($1, $2, $3)',
        [permSchemeId, permissionKey, role],
      )
    }
  }

  // Seed the DEFAULT notification scheme.
  const notifSchemeSeeded = await get('SELECT id FROM notification_schemes WHERE is_default = TRUE LIMIT 1')
  if (!notifSchemeSeeded) {
    const notifRes = await pool.query(
      "INSERT INTO notification_schemes (name, description, is_default) VALUES ('Default Notification Scheme', 'Notifies Members and above when issues are created or comments are added.', TRUE) RETURNING id",
    )
    const notifSchemeId = notifRes.rows[0].id
    const defaultRules = [
      ['issue.created', 'Member'],
      ['comment.added', 'Member'],
    ]
    for (const [eventKey, notifyRole] of defaultRules) {
      await pool.query(
        'INSERT INTO notification_rules (scheme_id, event_key, notify_role) VALUES ($1, $2, $3)',
        [notifSchemeId, eventKey, notifyRole],
      )
    }
  }

  // --- JL-115: Field configuration schemes (required / hidden / default per field) ---
  // Per-project (optionally per issue-type) behavior overrides for built-in and
  // custom fields. issue_type NULL means the row applies to every issue type.
  // Enforced on issue create (missing required field → 400). Backward compatible:
  // a project with no rows behaves exactly as before.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS field_configurations (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      issue_type TEXT,
      field_key TEXT NOT NULL,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      default_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_field_configurations_unique ON field_configurations (project_id, COALESCE(issue_type, ''), field_key)",
  )
  await pool.query('CREATE INDEX IF NOT EXISTS idx_field_configurations_project ON field_configurations(project_id)')

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

  // --- JL-73: Multi-workspace / tenant data isolation (additive foundation) ---
  // Workspaces are the top-level tenant boundary. This ticket lays the schema,
  // request context, and management endpoints; full per-query row isolation is a
  // follow-on. Columns on existing tables stay NULLABLE so legacy inserts that
  // omit workspace_id keep working, and existing rows are backfilled to a single
  // seeded "default" workspace so nothing is orphaned.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner_email TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, member_email)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_workspace_members_email ON workspace_members(member_email)')

  // --- JL-122: Configurable result columns & saved list views ---
  // Per-user named views: an ordered set of visible column keys + optional JQL filter.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS list_views (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      columns JSONB NOT NULL DEFAULT '[]',
      filter_jql TEXT,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_list_views_owner ON list_views(owner_email)')

  // Seed a single default workspace (idempotent via the unique slug).
  await pool.query(
    "INSERT INTO workspaces (name, slug) VALUES ('Default Workspace', 'default') ON CONFLICT (slug) DO NOTHING",
  )
  const defaultWorkspace = await get("SELECT id FROM workspaces WHERE slug = 'default'")
  const defaultWorkspaceId = defaultWorkspace?.id ?? null

  // Nullable workspace_id on projects + members, FK → workspaces (SET NULL on delete).
  if (!(await columnExists('projects', 'workspace_id'))) {
    await pool.query('ALTER TABLE projects ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON projects(workspace_id)')
  }
  if (!(await columnExists('members', 'workspace_id'))) {
    await pool.query('ALTER TABLE members ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_members_workspace_id ON members(workspace_id)')
  }
  // Backfill existing rows to the default workspace so nothing is orphaned.
  if (defaultWorkspaceId) {
    await pool.query('UPDATE projects SET workspace_id = $1 WHERE workspace_id IS NULL', [defaultWorkspaceId])
    await pool.query('UPDATE members SET workspace_id = $1 WHERE workspace_id IS NULL', [defaultWorkspaceId])
  }

  // --- JL-114: Screen schemes (per-issue-type field screens) ---
  // A scheme describes which built-in + custom fields appear on the create/edit
  // screens for one issue type in one project. When no scheme exists for an issue
  // type, the resolved endpoint falls back to "all fields" so legacy projects are
  // unaffected.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS screen_schemes (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      issue_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, issue_type)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS screen_scheme_fields (
      id SERIAL PRIMARY KEY,
      scheme_id INTEGER NOT NULL REFERENCES screen_schemes(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      show_on_create BOOLEAN NOT NULL DEFAULT TRUE,
      show_on_edit BOOLEAN NOT NULL DEFAULT TRUE
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_screen_scheme_fields_scheme ON screen_scheme_fields(scheme_id)')

  // --- JL-127: Sprint templates, goals & retrospectives ---
  // Sprint goal (nullable free text) for planning.
  if (!(await columnExists('sprints', 'goal'))) {
    await pool.query('ALTER TABLE sprints ADD COLUMN goal TEXT')
  }
  // Retrospective notes: one row per note, categorized well/improve/action.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sprint_retros (
      id SERIAL PRIMARY KEY,
      sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('well', 'improve', 'action')),
      text TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sprint_retros_sprint ON sprint_retros(sprint_id)')
  // Lightweight reusable sprint templates: name + duration + default goal.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sprint_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 14,
      default_goal TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // --- JL-130: SCIM 2.0 provisioning ---
  // Deprovisioning flag + IdP linkage on users, plus a minimal groups model.
  // All idempotent so repeated boots are safe.
  if (!(await columnExists('users', 'active'))) {
    await pool.query('ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE')
  }
  if (!(await columnExists('users', 'display_name'))) {
    await pool.query('ALTER TABLE users ADD COLUMN display_name TEXT')
  }
  if (!(await columnExists('users', 'scim_external_id'))) {
    await pool.query('ALTER TABLE users ADD COLUMN scim_external_id TEXT')
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scim_groups (
      id SERIAL PRIMARY KEY,
      display_name TEXT NOT NULL,
      external_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scim_group_members (
      group_id INTEGER NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    )
  `)

  // --- JL-131: Issue-level security schemes ---
  // A named security level (e.g. 'Confidential') restricts an issue's visibility
  // to workspace Admins/Owners + the issue's assignee/reporter. A NULL level on
  // an issue means it stays public (backward compatible — the default).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_levels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  if (!(await columnExists('issues', 'security_level_id'))) {
    await pool.query(
      'ALTER TABLE issues ADD COLUMN security_level_id INTEGER REFERENCES security_levels(id) ON DELETE SET NULL',
    )
  }

  // --- JL-142: Asset / CMDB management ---
  // Lightweight Configuration Management Database. Asset types describe a class
  // of thing (Server, Laptop, Service, License...); assets are concrete
  // instances with typed attributes stored as JSONB. issue_assets links issues
  // to the assets they affect (JSM-style). All idempotent.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assets (
      id SERIAL PRIMARY KEY,
      asset_type_id INTEGER NOT NULL REFERENCES asset_types(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      attributes JSONB NOT NULL DEFAULT '{}',
      owner_email TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type_id)')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_assets (
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (issue_id, asset_id)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_assets_asset ON issue_assets(asset_id)')

  // --- JL-144: Customer-facing Knowledge Base ---
  // A JSM-style help-article store, workspace/global scoped and SEPARATE from
  // the project wiki (JL-48). Articles have draft/published states plus a
  // public read view; categories are optional grouping.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_articles (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES kb_categories(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      author_email TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON kb_articles(category_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_kb_articles_status ON kb_articles(status)')

  // --- JL-133: Session / device management ---
  // One row per issued login token, keyed by the JWT's `jti`. Lets a user list
  // and revoke active sessions/devices; authGuard best-effort checks `revoked`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      jti TEXT UNIQUE,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked BOOLEAN NOT NULL DEFAULT FALSE
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_email ON user_sessions(user_email)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_jti ON user_sessions(jti)')

  // --- JL-146: App registry / marketplace (catalog + per-workspace install state) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_apps (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      vendor TEXT DEFAULT '',
      description TEXT DEFAULT '',
      category TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      version TEXT DEFAULT '1.0.0',
      config_schema JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS installed_apps (
      id SERIAL PRIMARY KEY,
      app_id INTEGER NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
      workspace_id INTEGER,
      config JSONB NOT NULL DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      installed_by TEXT,
      installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (app_id, workspace_id)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_installed_apps_workspace ON installed_apps(workspace_id)')

  // --- JL-148: Inbound email → issue creation ---
  // Maps an inbound mailbox address to a target project. An email to that
  // mailbox creates a new issue (or, when its subject carries an issue key,
  // appends a comment). `inbound_email_log` audits every processed message.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbound_email_settings (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      mailbox_address TEXT NOT NULL,
      default_issue_type TEXT NOT NULL DEFAULT 'Task',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_inbound_email_settings_mailbox ON inbound_email_settings(mailbox_address)',
  )

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbound_email_log (
      id SERIAL PRIMARY KEY,
      from_address TEXT,
      subject TEXT,
      matched_issue_key TEXT,
      action TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // --- JL-140: Customer request portal (external-facing) ---
  // request_types: the catalog of request types customers can pick from, each
  // scoped to a target project. `fields` is a JSONB array describing the form
  // fields shown on the portal submission form.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_types (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_issue_type TEXT NOT NULL DEFAULT 'Task',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_request_types_project ON request_types(project_id)')

  // portal_requests: links a customer submission to the issue it created.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_requests (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      requester_email TEXT NOT NULL,
      request_type_id INTEGER REFERENCES request_types(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_portal_requests_email ON portal_requests(requester_email)')

  // --- JL-132: Tamper-evident audit log (append-only, hash-chained) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      seq INTEGER NOT NULL,
      actor TEXT,
      action TEXT NOT NULL,
      target TEXT,
      metadata JSONB,
      prev_hash TEXT,
      hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_seq ON audit_log(seq)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)')

  // JL-188: retention checkpoint. When a retention purge removes the oldest
  // entries, we record the hash + seq of the LAST purged entry here. Chain
  // verification then treats that hash as the expected genesis boundary for the
  // earliest surviving entry, so a legitimate purge no longer looks like
  // tampering — while a purge/edit of a SURVIVING entry is still detected.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_checkpoint (
      id BIGSERIAL PRIMARY KEY,
      purged_through_seq INTEGER NOT NULL,
      last_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // --- JL-134: Org-wide security policy (single-row) + password rotation ---
  // A single row (id = 1) holds the org's enforced 2FA + password-complexity
  // rules. Defaults are intentionally PERMISSIVE (min length 8, no other
  // requirements) so existing users/tests with valid passwords keep working.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_policy (
      id INTEGER PRIMARY KEY DEFAULT 1,
      require_mfa BOOLEAN NOT NULL DEFAULT FALSE,
      min_password_length INTEGER NOT NULL DEFAULT 8,
      require_uppercase BOOLEAN NOT NULL DEFAULT FALSE,
      require_number BOOLEAN NOT NULL DEFAULT FALSE,
      require_symbol BOOLEAN NOT NULL DEFAULT FALSE,
      password_max_age_days INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      CONSTRAINT security_policy_singleton CHECK (id = 1)
    )
  `)
  // Ensure the singleton row always exists (idempotent seed of defaults).
  await pool.query(`
    INSERT INTO security_policy (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `)
  // Track when each user last changed their password, for rotation enforcement.
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ')

  // --- JL-141: Queues & SLAs-as-a-product ---
  // A queue is a named, ordered, filtered list of issues a support team works
  // from. `filter` is a JSONB criteria object (statuses[], priorities[],
  // assignee, labels[]). `order_by` names a whitelisted sort column.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS queues (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      filter JSONB NOT NULL DEFAULT '{}'::jsonb,
      order_by TEXT NOT NULL DEFAULT 'created_at',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_queues_project ON queues(project_id)')

  // --- JL-143: Incident & on-call management ---
  // Operational incidents (optionally tied to an issue) with a timeline, plus
  // on-call schedules and their shifts so the current responder is always known.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'SEV3' CHECK (severity IN ('SEV1', 'SEV2', 'SEV3', 'SEV4')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'identified', 'monitoring', 'resolved')),
      issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
      commander_email TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incident_timeline (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'note',
      note TEXT NOT NULL DEFAULT '',
      actor TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident ON incident_timeline(incident_id)')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oncall_schedules (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      rotation_type TEXT NOT NULL DEFAULT 'weekly',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oncall_shifts (
      id SERIAL PRIMARY KEY,
      schedule_id INTEGER NOT NULL REFERENCES oncall_schedules(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_oncall_shifts_schedule ON oncall_shifts(schedule_id)')

  // --- JL-147: Deep Git integration (PR state, deployments, provider webhooks) ---
  // Extend git_links with pull-request state tracking (open/merged/closed).
  if (!(await columnExists('git_links', 'state'))) {
    await pool.query("ALTER TABLE git_links ADD COLUMN state TEXT DEFAULT ''")
  }
  if (!(await columnExists('git_links', 'merged_at'))) {
    await pool.query('ALTER TABLE git_links ADD COLUMN merged_at TIMESTAMPTZ')
  }
  // Deployment records surfaced against an issue (issue_id nullable — a deploy
  // may reference no known key). Populated by the provider webhook.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deployments (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
      environment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      version TEXT DEFAULT '',
      url TEXT DEFAULT '',
      deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_deployments_issue ON deployments(issue_id, deployed_at DESC)')

  // --- JL-151: Custom report builder — saved report definitions. ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_reports (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      definition JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_saved_reports_owner ON saved_reports(owner_email)')

  // --- JL-123: Cross-project boards ---
  // A saved board definition that aggregates issues from multiple projects into
  // one Kanban view. project_ids is a JSON array of project ids; swimlane_by
  // controls grouping ('project' | 'assignee' | 'none'); filter holds optional
  // status/assignee filters. Owner-scoped.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cross_project_boards (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      project_ids JSONB NOT NULL DEFAULT '[]',
      swimlane_by TEXT NOT NULL DEFAULT 'project',
      filter JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cross_project_boards_owner ON cross_project_boards(owner_email)')

  // --- JL-125: Advanced Roadmaps (multi-team, dependency- & capacity-aware) ---
  // Dependencies between epics (issues with issue_type='Epic'). Default type is
  // finish_to_start: the to-epic must not start before the from-epic finishes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roadmap_dependencies (
      id SERIAL PRIMARY KEY,
      from_epic_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      to_epic_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'finish_to_start',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (from_epic_id, to_epic_id)
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_roadmap_deps_from ON roadmap_dependencies(from_epic_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_roadmap_deps_to ON roadmap_dependencies(to_epic_id)')

  // Team capacity (in points) for a planning window, optionally scoped to a
  // project. Distinct from JL-53 member_capacity (per assignee/sprint): this is
  // per team/period across the advanced roadmap.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_capacity (
      id SERIAL PRIMARY KEY,
      team_name TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      capacity_points NUMERIC NOT NULL DEFAULT 0,
      period_start DATE,
      period_end DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_team_capacity_project ON team_capacity(project_id)')

  // --- JL-145: Plugin/app framework — declarative extension-point manifests. ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plugin_manifests (
      id SERIAL PRIMARY KEY,
      app_key TEXT,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      contributions JSONB NOT NULL DEFAULT '[]',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_plugin_manifests_enabled ON plugin_manifests(enabled)')

  // --- JL-186: Performance indexes (from JL-177 review). ---
  // Purely additive + idempotent (CREATE INDEX IF NOT EXISTS) — no behavior change.
  // Backs hot equality lookups (issue_key), dashboard/queue/report filters
  // (status/assignee/priority), BI-export sort (updated_at), and unindexed
  // join/FK columns flagged as full-scan hotspots. All target columns verified
  // to exist in the schema above. installed_apps.workspace_id was already
  // indexed (idx_installed_apps_workspace), so it is intentionally omitted here.
  // issues: issue_key is a constant equality lookup (git webhooks, JQL links,
  // releases). A UNIQUE index also enforces key uniqueness at no extra cost.
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_issue_key ON issues(issue_key)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issues_updated_at ON issues(updated_at)')
  // FK / filter columns flagged in the review as unindexed join hotspots.
  await pool.query('CREATE INDEX IF NOT EXISTS idx_automation_logs_rule_id ON automation_logs(rule_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_automation_logs_issue_id ON automation_logs(issue_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_incidents_issue_id ON incidents(issue_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_portal_requests_issue_id ON portal_requests(issue_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_portal_requests_request_type_id ON portal_requests(request_type_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_issue_id ON notifications(issue_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_project_id ON notifications(project_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_project_members_member_id ON project_members(member_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_issue_wiki_links_wiki_page_id ON issue_wiki_links(wiki_page_id)')
  // --- JL-189: Add missing foreign keys (installed_apps.workspace_id, automation_logs.issue_id) ---
  // These two columns were historically bare INTEGERs with no REFERENCES, unlike
  // every other such reference column, so orphan rows were possible and a
  // workspace/issue delete left dangling references. Both columns are NULLABLE,
  // so the safe fix is: (1) null out any pre-existing orphan rows, then (2) add
  // the FK with ON DELETE SET NULL, guarded so re-running (or an install where
  // the constraint already exists) never errors. ADD CONSTRAINT is not
  // IF NOT EXISTS in older PostgreSQL, so we check information_schema first —
  // matching the fk_projects_lead_member pattern above.
  await pool.query(
    'UPDATE installed_apps SET workspace_id = NULL WHERE workspace_id IS NOT NULL AND workspace_id NOT IN (SELECT id FROM workspaces)',
  )
  const installedAppsFkExists = await get(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'fk_installed_apps_workspace' AND table_name = 'installed_apps'`,
  )
  if (!installedAppsFkExists) {
    await pool.query(`
      ALTER TABLE installed_apps
      ADD CONSTRAINT fk_installed_apps_workspace
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
    `).catch(() => {}) // Ignore if already exists (race / older catalog)
  }

  await pool.query(
    'UPDATE automation_logs SET issue_id = NULL WHERE issue_id IS NOT NULL AND issue_id NOT IN (SELECT id FROM issues)',
  )
  const automationLogsFkExists = await get(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'fk_automation_logs_issue' AND table_name = 'automation_logs'`,
  )
  if (!automationLogsFkExists) {
    await pool.query(`
      ALTER TABLE automation_logs
      ADD CONSTRAINT fk_automation_logs_issue
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL
    `).catch(() => {}) // Ignore if already exists (race / older catalog)
  }

  // --- JL-211: Workspace settings (simple key/value store) ---
  // Backs configurable workspace-wide policies such as `project_creation_policy`.
  // Kept intentionally generic so future workspace toggles reuse the same table
  // via getSetting/setSetting.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `)

  // --- JL-95: Demo/seed data is gated behind SEED_DEMO_DATA (default off). ---
  // seedDemoData() is a no-op unless the flag is explicitly enabled, so
  // production/CI never auto-seed fictional data. The seeders themselves only
  // insert into empty tables, so this stays idempotent when enabled.
  const { seedDemoData } = await import('./seed.js')
  await seedDemoData()
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
