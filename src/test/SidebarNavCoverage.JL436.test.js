// @vitest-environment node
//
// JL-436 — a routed page must be reachable, or deliberately not.
//
// JL-421 added a nav item for the Team directory but never added its label to
// LAUNCH_NAV. LAUNCH_SIDEBAR is true, so launchFilter silently dropped it and
// the entire JL-419 Teams feature could only be reached by typing the URL.
//
// Nothing caught it, and every component involved was behaving correctly:
//   - the JL-421 suites render TeamDirectoryPage directly and pass
//   - Sidebar.launch.test.jsx asserts the allow-list filters, and it does
// The full client project was green with the flagship feature unreachable.
//
// This is the THIRD time an item has gone missing from this list — JL-282 put
// Projects back, JL-283 put the Filters-box utilities back. A list you must
// remember to update is a list that will be forgotten, so the fix is a test
// rather than another one-line patch.
//
// The rule is NOT "every item must be visible": most are hidden on purpose,
// which is what JL-277 built LAUNCH_SIDEBAR for. The rule is that every item
// must be a DELIBERATE choice — listed in LAUNCH_NAV, or named below.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(
  path.join(here, '..', 'components', 'layout', 'Sidebar.jsx'),
  'utf8',
)

/**
 * Nav items intentionally kept out of the launch sidebar (JL-277). Each is a
 * real page that exists and routes, but is not part of the launch surface.
 * Adding a label here is a deliberate act and should be reviewed as one.
 */
const DELIBERATELY_HIDDEN = new Set([
  'Recent',              // duplicated by the Projects entry at launch
  'Webhooks',            // admin integration surfaces, not launch scope
  'Inbound Email',
  'Automation',
  'Marketplace',
  'Apps',
  'Releases',            // delivery/planning surfaces beyond launch scope
  'Goals',
  'Advanced Roadmap',    // JL-403 hid these three from the launch nav
  'Shared Dashboards',
  'Cross-Project Boards',
  'Assets',              // ITSM surfaces
  'Knowledge Base',
  'Help Center',
  'Queues',
  'Incidents',
  'BI Export',
])

/** Every `{ label: 'X' …}` nav entry declared in Sidebar.jsx. */
function navLabels() {
  return [...new Set([...source.matchAll(/\{\s*label:\s*'([^']+)'/g)].map((m) => m[1]))]
}

/** The LAUNCH_NAV allow-list, as the component declares it. */
function launchNav() {
  const block = source.match(/const LAUNCH_NAV = \[([^\]]*)\]/)
  expect(block, 'LAUNCH_NAV not found in Sidebar.jsx').not.toBeNull()
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('JL-436 — every sidebar nav item is a deliberate choice', () => {
  it('finds a real corpus, so the parser cannot silently match nothing', () => {
    // Without this, a regex that stops matching would make every assertion
    // below vacuously true — the failure mode this whole file exists to stop.
    expect(navLabels().length).toBeGreaterThan(15)
    expect(launchNav().length).toBeGreaterThan(5)
  })

  it('shows or explicitly hides every nav item — none fall through', () => {
    const shown = new Set(launchNav())
    const orphans = navLabels().filter(
      (l) => !shown.has(l) && !DELIBERATELY_HIDDEN.has(l),
    )
    expect(
      orphans,
      'These nav items are neither in LAUNCH_NAV nor declared deliberately ' +
        'hidden, so launchFilter drops them and their pages are unreachable ' +
        'from the UI. Add each to LAUNCH_NAV, or to DELIBERATELY_HIDDEN with a ' +
        'reason:\n' + orphans.join('\n'),
    ).toEqual([])
  })

  it('keeps the Team directory reachable — the JL-436 regression itself', () => {
    expect(launchNav()).toContain('Team directory')
  })

  it('does not list a label in both places, which would be contradictory', () => {
    const both = launchNav().filter((l) => DELIBERATELY_HIDDEN.has(l))
    expect(both, `listed as both shown and hidden: ${both.join(', ')}`).toEqual([])
  })

  it('has no stale DELIBERATELY_HIDDEN entry for a nav item that no longer exists', () => {
    // Keeps this list honest as pages come and go, rather than accumulating
    // exemptions for things that were deleted years ago.
    const labels = new Set(navLabels())
    const stale = [...DELIBERATELY_HIDDEN].filter((l) => !labels.has(l))
    expect(stale, `no longer a nav item: ${stale.join(', ')}`).toEqual([])
  })
})
