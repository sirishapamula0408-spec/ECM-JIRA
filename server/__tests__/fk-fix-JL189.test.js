// @vitest-environment node
// JL-189 — Data-model fix: add missing FKs
// (installed_apps.workspace_id → workspaces, automation_logs.issue_id → issues).
// These are lightweight text assertions over server/db.js: the mocked unit
// suites never run initializeDatabase against a real DB, so we verify that the
// idempotent, orphan-safe FK migration statements are present in the source.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbSource = readFileSync(join(__dirname, '..', 'db.js'), 'utf8')

describe('JL-189 missing foreign keys migration', () => {
  describe('installed_apps.workspace_id → workspaces(id)', () => {
    it('cleans up orphan rows by nulling dangling workspace_id before adding the FK', () => {
      expect(dbSource).toMatch(
        /UPDATE installed_apps SET workspace_id = NULL WHERE workspace_id IS NOT NULL AND workspace_id NOT IN \(SELECT id FROM workspaces\)/,
      )
    })

    it('adds the FK constraint referencing workspaces with ON DELETE SET NULL', () => {
      expect(dbSource).toMatch(/ADD CONSTRAINT fk_installed_apps_workspace/)
      expect(dbSource).toMatch(
        /FOREIGN KEY \(workspace_id\) REFERENCES workspaces\(id\) ON DELETE SET NULL/,
      )
    })

    it('guards the ADD CONSTRAINT with an information_schema existence check (idempotent)', () => {
      expect(dbSource).toMatch(/constraint_name = 'fk_installed_apps_workspace'/)
      expect(dbSource).toMatch(/if \(!installedAppsFkExists\)/)
    })
  })

  describe('automation_logs.issue_id → issues(id)', () => {
    it('cleans up orphan rows by nulling dangling issue_id before adding the FK', () => {
      expect(dbSource).toMatch(
        /UPDATE automation_logs SET issue_id = NULL WHERE issue_id IS NOT NULL AND issue_id NOT IN \(SELECT id FROM issues\)/,
      )
    })

    it('adds the FK constraint referencing issues with ON DELETE SET NULL', () => {
      expect(dbSource).toMatch(/ADD CONSTRAINT fk_automation_logs_issue/)
      expect(dbSource).toMatch(
        /FOREIGN KEY \(issue_id\) REFERENCES issues\(id\) ON DELETE SET NULL/,
      )
    })

    it('guards the ADD CONSTRAINT with an information_schema existence check (idempotent)', () => {
      expect(dbSource).toMatch(/constraint_name = 'fk_automation_logs_issue'/)
      expect(dbSource).toMatch(/if \(!automationLogsFkExists\)/)
    })
  })

  it('references the JL-189 ticket in a migration comment', () => {
    expect(dbSource).toMatch(/JL-189/)
  })
})
