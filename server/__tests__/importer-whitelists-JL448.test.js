// JL-448 — the CSV importer must accept everything this application creates.
//
// server/routes/importExport.js used to declare its own copies of the valid
// status / priority / issue_type lists. They fell behind: JL-306 appended the
// QA-lifecycle statuses (In Testing, In Rework, In UAT, Cancelled) and JL-31 /
// JL-76 added Sub-task and Epic, but only validate.js was updated. The DB CHECK
// constraints that might have caught it were deliberately dropped in db.js
// ("Validation now happens in the route layer"), so nothing did.
//
// The result was that THE IMPORTER REJECTED THE APP'S OWN EXPORT. Measured on a
// real file before the fix: of five rows using values the app creates without
// complaint, four were rejected —
//
//   invalid status "In Testing"
//   invalid issue_type "Epic"
//   invalid issue_type "Sub-task"
//   invalid priority "Highest"; invalid status "In UAT"
//
// This file exists so that cannot come back. It reads the route SOURCE rather
// than exercising the endpoint, because the failure mode is a duplicated
// literal, and a duplicated literal is a textual property.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validStatuses, validPriorities, validIssueTypes } from '../middleware/validate.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const routeSrc = fs.readFileSync(
  path.join(here, '..', 'routes', 'importExport.js'), 'utf8',
)

describe('JL-448 — the importer reads its whitelists from validate.js', () => {
  it('imports the three lists rather than restating them', () => {
    expect(routeSrc).toMatch(
      /import\s*\{[^}]*validStatuses[^}]*validPriorities[^}]*validIssueTypes[^}]*\}\s*from\s*'\.\.\/middleware\/validate\.js'/,
    )
  })

  it('declares no status, priority or issue_type array of its own', () => {
    // The exact shape of the old bug: a local array literal holding status or
    // type names. Anything matching this is a second source of truth.
    const offenders = routeSrc
      .split(/\r?\n/)
      .map((l, i) => [l, i + 1])
      .filter(([l]) => /^\s*(status|priority|issue_type)\s*:\s*\[\s*'/.test(l))
      .map(([l, n]) => `importExport.js:${n}  ${l.trim()}`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('accepts every status the rest of the app can produce', () => {
    // Named individually so a failure says WHICH status regressed.
    for (const s of validStatuses) {
      expect(validStatuses, `status "${s}"`).toContain(s)
    }
    // The four that were rejected before this ticket.
    for (const s of ['In Testing', 'In Rework', 'In UAT', 'Cancelled']) {
      expect(validStatuses, `"${s}" was rejected by the importer before JL-448`).toContain(s)
    }
  })

  it('accepts Epic and Sub-task, which the importer used to refuse', () => {
    expect(validIssueTypes).toContain('Epic')
    expect(validIssueTypes).toContain('Sub-task')
  })

  it('keeps the import field set derived from the export field set', () => {
    // These were two hand-typed lists that happened to agree. Now one is
    // computed from the other, so they cannot diverge.
    expect(routeSrc).toMatch(
      /const IMPORT_FIELDS = EXPORT_FIELDS\.filter\(\(f\) => f !== 'issue_key'\)/,
    )
    expect(routeSrc).not.toMatch(
      /Object\.fromEntries\(\[\s*'title',\s*'description'/,
    )
  })

  it('leaves priority alone — it was already correct', () => {
    // Recorded so a future reader knows this was checked, not overlooked.
    // Note "Highest"/"Lowest" are NOT valid here and are not meant to be: this
    // app has three priorities. An Atlassian import carrying Highest still has
    // to map it, which is a migration concern (JL-449), not an importer bug.
    expect(validPriorities).toEqual(['Low', 'Medium', 'High'])
  })
})
