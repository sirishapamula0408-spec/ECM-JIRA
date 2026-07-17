// @vitest-environment node
//
// JL-186 — Performance indexes (from the JL-177 performance review).
//
// The unit test suites mock ../db.js, so we cannot exercise real index
// creation here. Instead this suite reads server/db.js as text and asserts
// that every intended `CREATE INDEX IF NOT EXISTS idx_<table>_<column>`
// statement is present in initializeDatabase(). This documents the intended
// index set and guards against accidental removal. The statements are purely
// additive and idempotent (IF NOT EXISTS), so they cause no behavior change.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbSource = readFileSync(join(__dirname, '..', 'db.js'), 'utf8')

// Index name -> the CREATE INDEX statement it must appear in.
const EXPECTED_INDEXES = [
  // High-value issues hot columns.
  ['idx_issues_issue_key', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_issue_key ON issues(issue_key)'],
  ['idx_issues_status', 'CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)'],
  ['idx_issues_assignee', 'CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee)'],
  ['idx_issues_priority', 'CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority)'],
  ['idx_issues_updated_at', 'CREATE INDEX IF NOT EXISTS idx_issues_updated_at ON issues(updated_at)'],
  // FK / filter columns flagged as unindexed join hotspots.
  ['idx_automation_logs_rule_id', 'CREATE INDEX IF NOT EXISTS idx_automation_logs_rule_id ON automation_logs(rule_id)'],
  ['idx_automation_logs_issue_id', 'CREATE INDEX IF NOT EXISTS idx_automation_logs_issue_id ON automation_logs(issue_id)'],
  ['idx_incidents_issue_id', 'CREATE INDEX IF NOT EXISTS idx_incidents_issue_id ON incidents(issue_id)'],
  ['idx_portal_requests_issue_id', 'CREATE INDEX IF NOT EXISTS idx_portal_requests_issue_id ON portal_requests(issue_id)'],
  ['idx_portal_requests_request_type_id', 'CREATE INDEX IF NOT EXISTS idx_portal_requests_request_type_id ON portal_requests(request_type_id)'],
  ['idx_notifications_issue_id', 'CREATE INDEX IF NOT EXISTS idx_notifications_issue_id ON notifications(issue_id)'],
  ['idx_notifications_project_id', 'CREATE INDEX IF NOT EXISTS idx_notifications_project_id ON notifications(project_id)'],
  ['idx_project_members_member_id', 'CREATE INDEX IF NOT EXISTS idx_project_members_member_id ON project_members(member_id)'],
  ['idx_issue_wiki_links_wiki_page_id', 'CREATE INDEX IF NOT EXISTS idx_issue_wiki_links_wiki_page_id ON issue_wiki_links(wiki_page_id)'],
]

describe('JL-186 performance indexes in server/db.js', () => {
  it.each(EXPECTED_INDEXES)('declares %s', (_name, statement) => {
    expect(dbSource).toContain(statement)
  })

  it('creates the high-value issue_key lookup index as UNIQUE and idempotent', () => {
    expect(dbSource).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_issue_key')
  })

  it('uses idempotent IF NOT EXISTS for every JL-186 index', () => {
    for (const [name] of EXPECTED_INDEXES) {
      // Each index name must be created via an IF NOT EXISTS statement.
      const re = new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ${name}\\b`)
      expect(dbSource).toMatch(re)
    }
  })

  it('does not add a redundant JL-186-named installed_apps.workspace_id index', () => {
    // installed_apps.workspace_id is already indexed as idx_installed_apps_workspace;
    // JL-186 intentionally does not add an idx_installed_apps_workspace_id duplicate.
    expect(dbSource).not.toContain('idx_installed_apps_workspace_id')
  })
})
