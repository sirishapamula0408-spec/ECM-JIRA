// JL-451 — the importer resolves values that are ALMOST one of ours.
//
// Two separate problems, found by importing a real Atlassian export:
//
//   1. CASE. "in testing" was rejected while "In Testing" passed. A CSV that
//      has been through Excel or a hand edit loses casing constantly, and
//      nobody means a different status by it.
//
//   2. FOREIGN VALUES. "In Prod", "Bug raised", "UAT bug raised", "Highest"
//      are real — in somebody else's Jira. This app has its own workflow, and
//      its board columns, filters and reports are built on the set in
//      validate.js. Widening that set to suit one import would change the
//      application's model.
//
// So foreign values are MAPPED, not adopted, and every mapping is REPORTED so
// the user approves it in the dry-run. That reporting is the part that makes
// this honest rather than a silent data change, which is why it is tested as
// hard as the mapping itself.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validStatuses, validPriorities, validIssueTypes } from '../middleware/validate.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'routes', 'importExport.js'), 'utf8')

/** Pull the VALUE_ALIASES literal out of the route source. */
function aliasesFor(field) {
  const block = src.match(new RegExp(`${field}:\\s*\\{([\\s\\S]*?)\\n  \\}`))
  if (!block) return {}
  const out = {}
  for (const m of block[1].matchAll(/['"]?([\w\s-]+?)['"]?:\s*'([^']+)'/g)) out[m[1].trim()] = m[2]
  return out
}

describe('JL-451 — case-insensitive matching', () => {
  it('resolves values case-insensitively rather than by exact string', () => {
    // The bug was `accepted.includes(raw)`. Anything that still tests raw
    // membership without lowering has regressed.
    expect(src).toMatch(/toLowerCase\(\)\s*===\s*raw\.toLowerCase\(\)/)
  })

  it('stores the canonical spelling, not what the file happened to say', () => {
    // resolveValue returns the entry FOUND in the accepted list, so "in
    // testing" is stored as "In Testing" and the board can group on it.
    expect(src).toMatch(/const exact = accepted\.find/)
    expect(src).toMatch(/if \(exact\) return \{ value: exact \}/)
  })
})

describe('JL-451 — foreign values map onto this app\'s set', () => {
  const statusAliases = aliasesFor('status')
  const priorityAliases = aliasesFor('priority')

  it.each([
    ['in prod', 'Done'],
    ['uat bug raised', 'In Rework'],
    ['bug raised', 'In Rework'],
    ['waiting for client response', 'To Do'],
    ['ot ticket', 'To Do'],
  ])('maps status "%s" to "%s"', (from, to) => {
    expect(statusAliases[from]).toBe(to)
  })

  it.each([
    ['highest', 'High'],
    ['lowest', 'Low'],
  ])('maps priority "%s" to "%s"', (from, to) => {
    expect(priorityAliases[from]).toBe(to)
  })

  it('only ever maps ONTO a value the app actually accepts', () => {
    // The failure this guards: someone adds an alias pointing at a status that
    // does not exist, and every row using it is written with a status the
    // board cannot render. Checked for all three fields at once.
    const bad = []
    for (const [field, valid] of [['status', validStatuses], ['priority', validPriorities], ['issue_type', validIssueTypes]]) {
      for (const [from, to] of Object.entries(aliasesFor(field))) {
        if (!valid.includes(to)) bad.push(`${field}: "${from}" -> "${to}" is not in validate.js`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('does not map a value the app already accepts', () => {
    // An alias for a real value would shadow it and could silently rewrite it.
    const shadowed = []
    for (const [field, valid] of [['status', validStatuses], ['priority', validPriorities], ['issue_type', validIssueTypes]]) {
      for (const from of Object.keys(aliasesFor(field))) {
        const clash = valid.find((v) => v.toLowerCase() === from.toLowerCase() && aliasesFor(field)[from] !== v)
        if (clash) shadowed.push(`${field}: alias "${from}" shadows the real value "${clash}"`)
      }
    }
    expect(shadowed, shadowed.join('\n')).toEqual([])
  })
})

describe('JL-451 — every translation is reported', () => {
  it('records a warning whenever an alias is applied', () => {
    expect(src).toMatch(/warnings\.push\(\{\s*row:[^}]*field[^}]*from[^}]*to/)
  })

  it('returns warnings and a count from the dry run', () => {
    // Without these in the response the mapping is invisible, and an invisible
    // remap is worse than the rejection it replaced.
    expect(src).toMatch(/warnings: warnings\.slice/)
    expect(src).toMatch(/warningCount: warnings\.length/)
  })

  it('still rejects a value that is neither valid nor aliased', () => {
    expect(src).toMatch(/return \{ error: `invalid \$\{field\}/)
  })

  it('names the accepted values in the rejection', () => {
    // A bare "invalid status" leaves the user guessing at a list they cannot
    // see anywhere in the UI.
    expect(src).toMatch(/accepted: \$\{accepted\.join\(', '\)\}/)
  })
})
