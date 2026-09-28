// @vitest-environment node
/* ================================================================
   JL-74 Phase 11 — the non-functional guarantees that are actually
   testable in code.

   JL-140 audit, JL-141 immutability, and JL-138's index. The rest of
   the phase (browser support, backup coverage, the design system,
   and the p95 render target) are confirmations about the deployment
   and the UI rather than behaviour a unit test can assert — they are
   recorded on their tickets instead of being faked here.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8')

/* ---------------------------------------------------------------- *
 * JL-141 — version history is immutable
 * ---------------------------------------------------------------- */
describe('JL-141 no interface can edit or delete a version', () => {
  const wiki = read('routes/wiki.js')

  it('never UPDATEs a version row', () => {
    /*
     * A restore APPENDS a new version carrying the old content (JL-108). If
     * any path ever rewrites history instead, the version list stops being
     * evidence of what the page said and when.
     */
    expect(wiki).not.toMatch(/UPDATE\s+wiki_page_versions/i)
  })

  it('never DELETEs a version row', () => {
    expect(wiki).not.toMatch(/DELETE\s+FROM\s+wiki_page_versions/i)
  })

  it('exposes no route that targets a version for mutation', () => {
    // Only reads and the restore POST, which inserts.
    const versionRoutes = [...wiki.matchAll(/router\.(get|post|patch|put|delete)\('([^']*versions[^']*)'/g)]
    for (const [, method, route] of versionRoutes) {
      expect(['get', 'post'], `${method.toUpperCase()} ${route} can mutate history`).toContain(method)
    }
  })

  it('the only version write is an INSERT', () => {
    const writes = [...wiki.matchAll(/(INSERT INTO|UPDATE|DELETE FROM)\s+wiki_page_versions/gi)]
    expect(writes.length).toBeGreaterThan(0)
    for (const [, verb] of writes) {
      expect(verb.toUpperCase()).toBe('INSERT INTO')
    }
  })
})

/* ---------------------------------------------------------------- *
 * JL-140 — administrative actions reach the existing audit log
 * ---------------------------------------------------------------- */
describe('JL-140 Confluence Lite writes to the JIRA Lite audit log', () => {
  const wiki = read('routes/wiki.js')
  const spaces = read('routes/spaces.js')
  const templates = read('routes/wikiTemplates.js')

  it('uses the EXISTING audit service, not a second log', () => {
    for (const [name, src] of [['wiki', wiki], ['spaces', spaces], ['templates', templates]]) {
      expect(src, `${name} should import the shared audit service`)
        .toMatch(/from '\.\.\/services\/auditLog\.js'/)
    }
  })

  it('records page create, delete and restore', () => {
    for (const action of ['wikipage.created', 'wikipage.deleted', 'wikipage.restored']) {
      expect(wiki).toContain(action)
    }
  })

  it('records space and template administration', () => {
    expect(spaces).toContain('space.created')
    expect(templates).toContain('wikitemplate.created')
    expect(templates).toContain('wikitemplate.deleted')
  })

  it('uses safeAppendAudit, so a log failure cannot break the action', () => {
    expect(wiki).toMatch(/safeAppendAudit\(/)
    expect(wiki).not.toMatch(/await\s+safeAppendAudit/)
  })

  it('does NOT log ordinary edits', () => {
    /*
     * wiki_page_versions already records every edit with an author and a
     * timestamp. Duplicating that into the audit log would double the volume
     * while adding nothing a reader could not already see.
     */
    expect(wiki).not.toContain('wikipage.updated')
    expect(wiki).not.toContain('wikipage.edited')
  })
})

/* ---------------------------------------------------------------- *
 * JL-138 — the search is actually indexable
 * ---------------------------------------------------------------- */
describe('JL-138 search has an index that fits the query', () => {
  const db = read('db.js')

  it('creates trigram indexes, which a leading-wildcard ILIKE can use', () => {
    /*
     * A btree cannot serve ILIKE '%term%'. Without pg_trgm this is a
     * sequential scan and no query tuning changes that.
     */
    expect(db).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/)
    expect(db).toMatch(/idx_wiki_pages_title_trgm[^\n]*gin_trgm_ops/)
    expect(db).toMatch(/idx_wiki_pages_content_trgm[^\n]*gin_trgm_ops/)
  })

  it('does not fail startup when the extension cannot be created', () => {
    // CREATE EXTENSION needs privileges a hardened deployment may withhold.
    // An install that cannot index should still boot and still search.
    const block = db.slice(db.indexOf('CREATE EXTENSION IF NOT EXISTS pg_trgm'))
    expect(block.slice(0, 900)).toMatch(/catch/)
  })

  it('indexes the page read path too (JL-137)', () => {
    expect(db).toMatch(/idx_issue_wiki_links_page/)
    expect(db).toMatch(/idx_wiki_page_versions_page/)
  })
})
