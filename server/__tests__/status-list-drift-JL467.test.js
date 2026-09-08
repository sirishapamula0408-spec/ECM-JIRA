// JL-467 — no module keeps its own copy of the status list.
//
// This is the FOURTH time a private copy of a list that lives in validate.js
// has caused a defect:
//
//   JL-448  the importer rejected the app's own exports
//   JL-465  the List page labelled four statuses "TO DO"
//   JL-466  a backlog control turned Cancelled into Done
//   JL-467  reports omitted 46 of 330 issues
//
// JL-448 added a guard, but scoped to one file. Scoping a guard to the file
// that happened to break is why there were three more. This one is scoped to
// the RULE instead: scan every server module, and fail on any array literal of
// status names outside the module that owns it.
//
// It reads source rather than behaviour deliberately. The failure mode is a
// duplicated literal, and a duplicated literal is a textual property — a
// behavioural test would have to know in advance which report to check.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validStatuses, validPriorities, validIssueTypes } from '../middleware/validate.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.join(here, '..')

/*
 * Files allowed to name statuses in an array.
 *
 * validate.js OWNS the lists. The other two are not drift:
 *   workflowTemplates.js — a template DEFINES its own status set; that is the
 *     entire point of a template, and forcing it onto validStatuses would make
 *     every template identical.
 *   seed.js — fixture data, which names specific statuses because it is
 *     creating specific issues.
 *
 * db.js is NOT exempted, but note this guard does not catch it either: its
 * five-status CHECK lives inside a SQL template string, not a JS array, so the
 * literal scan below cannot see it. That is JL-468, and it needs a different
 * kind of check — creating a schema and inserting each status.
 */
const ALLOWED = new Set([
  'middleware/validate.js',
  'services/workflowTemplates.js',
  'seed.js',
])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'uploads') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Test directories legitimately name statuses in fixtures.
      if (entry.name === '__tests__' || entry.name === 'test') continue
      walk(full, out)
    } else if (entry.name.endsWith('.js')) {
      out.push(full)
    }
  }
  return out
}

const files = walk(serverRoot).map((f) => ({
  rel: path.relative(serverRoot, f).replace(/\\/g, '/'),
  src: fs.readFileSync(f, 'utf8'),
}))

/** An array literal holding two or more canonical status names. */
function statusArrayLiterals(src) {
  const hits = []
  for (const m of src.matchAll(/\[[^\]]{0,400}?\]/g)) {
    const named = validStatuses.filter((s) => m[0].includes(`'${s}'`) || m[0].includes(`"${s}"`))
    if (named.length >= 2) hits.push({ text: m[0].replace(/\s+/g, ' ').slice(0, 90), named: named.length })
  }
  return hits
}

describe('JL-467 — no private copies of the status list', () => {
  it('finds server files to scan at all', () => {
    // A walk that silently returns nothing would make every test below vacuous.
    expect(files.length).toBeGreaterThan(20)
  })

  const scanned = files.filter((f) => !ALLOWED.has(f.rel))

  it.each(scanned.map((f) => f.rel))('%s declares no status array', (rel) => {
    const file = scanned.find((f) => f.rel === rel)
    const hits = statusArrayLiterals(file.src)
    expect(
      hits,
      hits.length
        ? `${rel} holds its own status list:\n  ${hits.map((h) => h.text).join('\n  ')}\n` +
          'Import validStatuses from middleware/validate.js instead.'
        : '',
    ).toEqual([])
  })
})

describe('JL-467 — the four reporting modules derive their lists', () => {
  const MODULES = [
    ['routes/reports.js', 'CFD_STATUSES'],
    ['routes/biExport.js', 'DIM_STATUSES'],
    ['routes/timeInStatusReports.js', 'STATUS_ORDER'],
    ['routes/gitIntegration.js', 'SMART_STATUSES'],
  ]

  it.each(MODULES)('%s assigns %s from validStatuses', (rel, name) => {
    const file = files.find((f) => f.rel === rel)
    expect(file, `${rel} not found`).toBeTruthy()
    expect(file.src).toMatch(new RegExp(`const ${name} = validStatuses`))
  })

  it('biExport derives its priority and type dimensions too', () => {
    // DIM_TYPES omitted Epic — the same drift on a different axis, found while
    // fixing the status one.
    const src = files.find((f) => f.rel === 'routes/biExport.js').src
    expect(src).toMatch(/const DIM_PRIORITIES = validPriorities/)
    expect(src).toMatch(/const DIM_TYPES = validIssueTypes/)
  })
})

describe('JL-467 — the derived values are actually complete', () => {
  it('covers the whole QA lifecycle JL-306 added', () => {
    for (const s of ['In Testing', 'In Rework', 'In UAT', 'Cancelled']) {
      expect(validStatuses, `"${s}" missing from validStatuses`).toContain(s)
    }
  })

  it('includes Epic and Sub-task in the types', () => {
    expect(validIssueTypes).toContain('Epic')
    expect(validIssueTypes).toContain('Sub-task')
  })

  it('leaves priorities as the three this app has', () => {
    // Recorded so a reader knows this was checked rather than overlooked:
    // Highest/Lowest are import ALIASES (JL-451), not priorities.
    expect(validPriorities).toEqual(['Low', 'Medium', 'High'])
  })

  it('keeps validStatuses in workflow order', () => {
    // CFD bands and time-in-status columns take their ORDER from this array,
    // not just their membership. Reordering it silently reorders the charts.
    expect(validStatuses.indexOf('Backlog')).toBeLessThan(validStatuses.indexOf('To Do'))
    expect(validStatuses.indexOf('To Do')).toBeLessThan(validStatuses.indexOf('In Progress'))
    expect(validStatuses.indexOf('In Progress')).toBeLessThan(validStatuses.indexOf('Done'))
    expect(validStatuses.indexOf('In Testing')).toBeLessThan(validStatuses.indexOf('Done'))
  })
})
