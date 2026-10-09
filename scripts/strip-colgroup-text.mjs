#!/usr/bin/env node
/**
 * JL-186 (fosasoft) — one-time clean-up of table <colgroup> markup that was
 * saved into Confluence Lite pages as visible text.
 *
 * Until JL-186, sanitizeHtml escaped TipTap's `<colgroup><col …></colgroup>`
 * instead of dropping it, so wiki content was stored as
 *   <table>&lt;colgroup&gt;&lt;col style=…&gt;&lt;/colgroup&gt;<tbody>…
 * Reopening such a page in the editor moved that text into a paragraph above
 * the table, and saving again stored it there as well:
 *   <p>&lt;colgroup&gt;…&lt;/colgroup&gt;</p><table>&lt;colgroup&gt;…
 * This script removes both shapes from wiki_pages and wiki_page_versions.
 * It touches only that escaped colgroup run (and a paragraph holding nothing
 * else), never real markup, so running it twice is a no-op.
 *
 * USAGE
 *   node scripts/strip-colgroup-text.mjs           # dry run: report only
 *   node scripts/strip-colgroup-text.mjs --apply   # write the changes
 *
 * Connects to DATABASE_URL from .env, like the server.
 */
import { pathToFileURL } from 'node:url'

// One escaped colgroup run. Quotes inside it may be `&quot;` or literal `"`,
// depending on which path wrote it, so the body is matched loosely.
const COLGROUP_TEXT = '&lt;colgroup&gt;[\\s\\S]*?&lt;\\/colgroup&gt;'
const PARAGRAPH_OF_COLGROUPS = new RegExp(`<p>\\s*(?:${COLGROUP_TEXT}\\s*)+</p>`, 'gi')
const BARE_COLGROUP = new RegExp(COLGROUP_TEXT, 'gi')

/** `html` with every escaped colgroup run removed. Pure, for the tests. */
export function stripColgroupText(html) {
  if (!html) return html
  return html.replace(PARAGRAPH_OF_COLGROUPS, '').replace(BARE_COLGROUP, '')
}

const TABLES = ['wiki_pages', 'wiki_page_versions']

export async function cleanColgroupText(client, { apply = false } = {}) {
  const report = {}
  for (const table of TABLES) {
    const { rows } = await client.query(
      `SELECT id, content FROM ${table} WHERE content ILIKE '%&lt;colgroup&gt;%'`,
    )
    let changed = 0
    for (const row of rows) {
      const cleaned = stripColgroupText(row.content)
      if (cleaned === row.content) continue
      changed += 1
      if (apply) await client.query(`UPDATE ${table} SET content = $1 WHERE id = $2`, [cleaned, row.id])
    }
    report[table] = { matched: rows.length, changed }
  }
  return report
}

async function main() {
  await import('dotenv/config')
  const { default: pg } = await import('pg')
  const { DATABASE_URL } = await import('../server/config.js')
  const apply = process.argv.includes('--apply')
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const report = await cleanColgroupText(client, { apply })
    await client.query(apply ? 'COMMIT' : 'ROLLBACK')
    for (const [table, { matched, changed }] of Object.entries(report)) {
      console.log(`${table}: ${matched} row(s) contain colgroup text, ${changed} ${apply ? 'cleaned' : 'would be cleaned'}`)
    }
    if (!apply) console.log('Dry run — nothing written. Re-run with --apply to clean.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
