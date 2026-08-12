import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'

import {
  AVATAR_PALETTE,
  AVATAR_SURFACE,
  avatarIdentity,
  avatarColourIndex,
  avatarStyle,
  hashIdentity,
} from '../utils/avatarColour'

/**
 * JL-386 — deterministic avatar colour per user.
 *
 * Before this change every avatar in the app rendered on the same fixed blue
 * (`background: var(--jira-blue)` on .user-management-avatar and .af-avatar,
 * `#0052cc` on .avatar / .id-comment-avatar--me), so the two-letter initials
 * were the only thing telling one person from another — a column of avatars in
 * the backlog was uniformly blue.
 *
 * The four invariants that matter, and why each is tested here rather than
 * eyeballed:
 *
 *  - determinism: the colour must be a property of the *person*, not of when or
 *    where they were rendered.
 *  - independence from list position: this is the JL-345 chart-colour bug class.
 *    Colouring by array index means filtering or sorting a list silently
 *    repaints people, so the reordering test is the regression guard.
 *  - contrast: the ticket treats this as a hard requirement, so the WCAG maths
 *    is implemented below and run over the palette rather than asserted against
 *    a hardcoded list of "known good" ratios. Adding a ninth hue therefore
 *    cannot ship a failing contrast unnoticed.
 *  - no throw on an unidentifiable user: half-loaded rows still paint.
 */

// ── WCAG 2.1 relative-luminance / contrast maths, implemented locally ────────
// Deliberately NOT imported from src/utils/color.js: this suite is the check on
// the palette, and a bug in the shared helper would otherwise cancel itself out
// on both sides of the assertion.

function parseHex(hex) {
  const m = String(hex).trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) throw new Error(`palette colour is not a 6-digit hex: ${hex}`)
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

function relativeLuminance(hex) {
  const { r, g, b } = parseHex(hex)
  const channel = (value) => {
    const s = value / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG AA for normal text. Avatar initials are small and bold, so AA it is. */
const AA_TEXT = 4.5
/** WCAG 1.4.11 for a non-text graphical object — the disc against the canvas. */
const AA_NON_TEXT = 3

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(here, '..')
const read = (...parts) => fs.readFileSync(path.join(srcDir, ...parts), 'utf8')

describe('JL-386 avatar colour — the contrast maths itself', () => {
  it('agrees with the WCAG reference values for black/white', () => {
    // Sanity-check the implementation before trusting it on the palette:
    // white-on-black is the definitional 21:1, and a colour against itself 1:1.
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#0747A6', '#0747A6')).toBeCloseTo(1, 5)
    // #767676 on white is the canonical "just passes AA" grey.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(AA_TEXT)
  })
})

describe('JL-386 avatar colour — contrast across the whole palette', () => {
  it('has a palette with more than one entry', () => {
    expect(AVATAR_PALETTE.length).toBeGreaterThan(1)
  })

  it.each(AVATAR_PALETTE.map((entry, index) => [index, entry.name, entry]))(
    'entry %i (%s) keeps the initials legible in light and dark theme',
    (_index, _name, entry) => {
      for (const theme of ['light', 'dark']) {
        const { bg, fg } = entry[theme]
        const ratio = contrastRatio(bg, fg)
        expect(
          ratio,
          `${entry.name} ${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${AA_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT)
      }
    },
  )

  it.each(AVATAR_PALETTE.map((entry, index) => [index, entry.name, entry]))(
    'entry %i (%s) stays visible against the canvas it is drawn on',
    (_index, _name, entry) => {
      // The avatar disc is a graphical object: if the fill sank into the page
      // background the initials would read as floating text, which is how the
      // deep light-theme fills would behave on the dark canvas. This is what
      // forces the palette to be theme-aware rather than one flat set of hexes.
      for (const theme of ['light', 'dark']) {
        const ratio = contrastRatio(entry[theme].bg, AVATAR_SURFACE[theme])
        expect(
          ratio,
          `${entry.name} ${theme}: fill ${entry[theme].bg} on ${AVATAR_SURFACE[theme]} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NON_TEXT)
      }
    },
  )
})

describe('JL-386 avatar colour — determinism', () => {
  it('returns the same colour for the same numeric id every call', () => {
    const first = avatarColourIndex({ id: 42, name: 'Priya Kumar' })
    for (let i = 0; i < 50; i += 1) {
      expect(avatarColourIndex({ id: 42, name: 'Priya Kumar' })).toBe(first)
    }
  })

  it('ignores fields that are not the identity', () => {
    // Renaming a user, or loading a row with a different display name, must not
    // repaint them — the id is the identity.
    const a = avatarColourIndex({ id: 42, name: 'Priya Kumar', email: 'p@x.com' })
    const b = avatarColourIndex({ id: 42, name: 'Priya K.', email: 'PRIYA@Y.COM' })
    expect(b).toBe(a)
  })

  it('treats an email as the identity when there is no id, case/space insensitively', () => {
    const base = avatarColourIndex({ email: 'sam@example.com' })
    expect(avatarColourIndex({ email: '  SAM@Example.COM  ' })).toBe(base)
    expect(avatarIdentity({ email: '  SAM@Example.COM  ' })).toBe('email:sam@example.com')
  })

  it('prefers the id over the email when both are present', () => {
    expect(avatarIdentity({ id: 7, email: 'sam@example.com' })).toBe('id:7')
  })

  it('falls back to the display name for the sites that only carry one', () => {
    // issue.assignee is a member *name*, not an object — BacklogIssueRow,
    // ActiveSprintPage and FiltersPage all pass one.
    expect(avatarIdentity('Priya Kumar')).toBe('name:priya kumar')
    expect(avatarColourIndex('Priya Kumar')).toBe(avatarColourIndex(' priya KUMAR '))
  })

  it('does not collide the id space with the name space', () => {
    // A user whose display name is literally "7" must not be forced onto user
    // #7's colour just because both stringify to "7".
    expect(avatarIdentity({ id: 7 })).not.toBe(avatarIdentity('7'))
  })

  it('is a pure function of the identity string', () => {
    expect(hashIdentity('id:42')).toBe(hashIdentity('id:42'))
    expect(hashIdentity('id:42')).not.toBe(hashIdentity('id:43'))
  })

  it('produces the same style object contents across separate calls', () => {
    expect(avatarStyle({ id: 9 })).toEqual(avatarStyle({ id: 9 }))
  })
})

describe('JL-386 avatar colour — distribution', () => {
  const people = [
    { id: 1, name: 'Priya Kumar', email: 'priya@example.com' },
    { id: 2, name: 'Sam Patel', email: 'sam@example.com' },
    { id: 3, name: 'Ana Ruiz', email: 'ana@example.com' },
    { id: 4, name: 'Lee Chen', email: 'lee@example.com' },
    { id: 5, name: 'Nia Obi', email: 'nia@example.com' },
    { id: 6, name: 'Tom Ford', email: 'tom@example.com' },
    { id: 7, name: 'Zoe Hall', email: 'zoe@example.com' },
    { id: 8, name: 'Ravi Nair', email: 'ravi@example.com' },
  ]

  it('does not collapse a team onto a single colour', () => {
    // The whole point of the ticket: a column of avatars must not be uniform.
    const distinct = new Set(people.map((p) => avatarColourIndex(p)))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('spreads a realistic team across most of the palette', () => {
    const distinct = new Set(people.map((p) => avatarColourIndex(p)))
    // Hashing eight ids into eight slots will collide sometimes; requiring more
    // than half the palette is a meaningful spread without pinning the hash.
    expect(distinct.size).toBeGreaterThanOrEqual(Math.ceil(AVATAR_PALETTE.length / 2))
  })

  it('uses every palette slot over a larger population', () => {
    const used = new Set()
    for (let id = 1; id <= 400; id += 1) used.add(avatarColourIndex({ id }))
    expect(used.size).toBe(AVATAR_PALETTE.length)
  })

  it('spreads similar emails rather than clustering them', () => {
    // A naive charCode sum would map these onto very few slots.
    const emails = ['ab@x.com', 'ba@x.com', 'ac@x.com', 'ca@x.com', 'bc@x.com', 'cb@x.com']
    const distinct = new Set(emails.map((e) => avatarColourIndex({ email: e })))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('always lands inside the palette', () => {
    for (let id = 0; id < 500; id += 1) {
      const index = avatarColourIndex({ id })
      expect(Number.isInteger(index)).toBe(true)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(AVATAR_PALETTE.length)
    }
  })
})

describe('JL-386 avatar colour — stability under reordering and filtering', () => {
  const team = [
    { id: 11, name: 'Priya Kumar' },
    { id: 12, name: 'Sam Patel' },
    { id: 13, name: 'Ana Ruiz' },
    { id: 14, name: 'Lee Chen' },
    { id: 15, name: 'Nia Obi' },
  ]

  const colourByName = (list) =>
    Object.fromEntries(list.map((m) => [m.name, avatarColourIndex(m)]))

  it('keeps each person their colour when the list is sorted', () => {
    const before = colourByName(team)
    const sorted = [...team].sort((a, b) => a.name.localeCompare(b.name))
    expect(colourByName(sorted)).toEqual(before)
  })

  it('keeps each person their colour when the list is reversed', () => {
    const before = colourByName(team)
    expect(colourByName([...team].reverse())).toEqual(before)
  })

  it('keeps each remaining person their colour when the list is filtered', () => {
    // This is the JL-345 failure mode: dropping the first entry shifts every
    // later array index by one, so index-based colouring would repaint people
    // the user never touched.
    const before = colourByName(team)
    const filtered = team.filter((m) => m.id !== 11)
    for (const member of filtered) {
      expect(avatarColourIndex(member)).toBe(before[member.name])
    }
  })

  it('is unaffected by the object being a fresh copy from a later fetch', () => {
    const refetched = team.map((m) => ({ ...m, extra: Math.random() }))
    expect(colourByName(refetched)).toEqual(colourByName(team))
  })
})

describe('JL-386 avatar colour — fallback for unidentifiable users', () => {
  const unidentifiable = [
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['empty string', ''],
    ['whitespace string', '   '],
    ['blank fields', { id: '', email: '', name: '' }],
    ['null fields', { id: null, email: null, name: null }],
    ['a boolean', true],
    ['an array', []],
  ]

  it.each(unidentifiable)('does not throw for %s', (_label, value) => {
    expect(() => avatarStyle(value)).not.toThrow()
    const index = avatarColourIndex(value)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(AVATAR_PALETTE.length)
  })

  it('gives every unidentifiable user the same deterministic slot', () => {
    expect(avatarColourIndex(null)).toBe(avatarColourIndex({}))
    expect(avatarColourIndex(undefined)).toBe(avatarColourIndex('   '))
  })

  it('still returns a usable style object', () => {
    const style = avatarStyle(null)
    expect(style.background).toEqual(expect.any(String))
    expect(style.color).toEqual(expect.any(String))
    expect(style.background.length).toBeGreaterThan(0)
  })
})

describe('JL-386 avatar colour — the style handed to call sites', () => {
  it('sets only background and color, so sizing and typography are untouched', () => {
    // The ticket is colour-only: if this helper ever grew a width/font-size the
    // 20-odd call sites would silently lose their own sizing.
    expect(Object.keys(avatarStyle({ id: 3 })).sort()).toEqual(['background', 'color'])
  })

  it('references the themed CSS token with the light hex as a fallback', () => {
    const index = avatarColourIndex({ id: 3 })
    const entry = AVATAR_PALETTE[index]
    expect(avatarStyle({ id: 3 }).background).toBe(`var(--avatar-bg-${index}, ${entry.light.bg})`)
    expect(avatarStyle({ id: 3 }).color).toBe(`var(--avatar-fg-${index}, ${entry.light.fg})`)
  })

  it('actually paints two different users differently when rendered', () => {
    function Row({ user }) {
      return <span data-testid={`a-${user.id}`} style={avatarStyle(user)}>{user.name[0]}</span>
    }
    const a = { id: 101, name: 'Ana' }
    // Pick a second user that genuinely lands on another slot, so the assertion
    // tests the rendering path rather than the hash's luck.
    let b = null
    for (let id = 102; id < 200 && !b; id += 1) {
      if (avatarColourIndex({ id }) !== avatarColourIndex(a)) b = { id, name: 'Bo' }
    }
    render(<div><Row user={a} /><Row user={b} /></div>)
    const styleA = screen.getByTestId(`a-${a.id}`).getAttribute('style')
    const styleB = screen.getByTestId(`a-${b.id}`).getAttribute('style')
    expect(styleA).not.toBe(styleB)
    expect(styleA).toContain('--avatar-bg-')
  })
})

describe('JL-386 avatar colour — CSS tokens match the JS palette', () => {
  // The palette lives in JS (so the contrast tests above can compute on it) but
  // the per-theme values are emitted as CSS custom properties (so no call site
  // has to read ThemeContext). That split can drift; these tests close it.

  const variablesCss = read('styles', 'variables.css')
  const themeCss = read('styles', 'theme.css')

  const tokensIn = (css, kind) => {
    const found = {}
    for (const m of css.matchAll(new RegExp(`--avatar-${kind}-(\\d+):\\s*(#[0-9a-fA-F]{6})`, 'g'))) {
      found[Number(m[1])] = m[2].toUpperCase()
    }
    return found
  }

  it('defines a light-theme token pair for every palette entry in variables.css', () => {
    const bg = tokensIn(variablesCss, 'bg')
    const fg = tokensIn(variablesCss, 'fg')
    AVATAR_PALETTE.forEach((entry, index) => {
      expect(bg[index], `--avatar-bg-${index} missing from variables.css`).toBe(entry.light.bg.toUpperCase())
      expect(fg[index], `--avatar-fg-${index} missing from variables.css`).toBe(entry.light.fg.toUpperCase())
    })
  })

  it('overrides every token for dark theme in theme.css', () => {
    const darkBlock = themeCss.slice(themeCss.indexOf('.app-theme-dark'))
    const bg = tokensIn(darkBlock, 'bg')
    const fg = tokensIn(darkBlock, 'fg')
    AVATAR_PALETTE.forEach((entry, index) => {
      expect(bg[index], `--avatar-bg-${index} missing from .app-theme-dark`).toBe(entry.dark.bg.toUpperCase())
      expect(fg[index], `--avatar-fg-${index} missing from .app-theme-dark`).toBe(entry.dark.fg.toUpperCase())
    })
  })

  it('leaves no palette slot defined in only one theme', () => {
    const lightCount = Object.keys(tokensIn(variablesCss, 'bg')).length
    const darkCount = Object.keys(tokensIn(themeCss, 'bg')).length
    expect(lightCount).toBe(AVATAR_PALETTE.length)
    expect(darkCount).toBe(AVATAR_PALETTE.length)
  })
})

describe('JL-386 avatar colour — the fixed blue is gone from the call sites', () => {
  it('no longer hardcodes a background on the Users-table avatar', () => {
    // This exact rule is the one the ticket points at.
    const css = read('pages', 'UserManagementPage', 'UserManagementPage.css')
    const rule = css.slice(css.indexOf('.user-management-avatar'))
    expect(rule.slice(0, rule.indexOf('}'))).not.toMatch(/background\s*:/)
  })

  it('no longer hardcodes a background on the Activity-feed avatar', () => {
    const css = read('pages', 'ActivityFeedPage', 'ActivityFeedPage.css')
    const rule = css.slice(css.indexOf('.af-avatar'))
    expect(rule.slice(0, rule.indexOf('}'))).not.toMatch(/background\s*:/)
  })

  it.each([
    ['Users table', ['pages', 'UserManagementPage', 'UserManagementPage.jsx']],
    ['Activity feed', ['pages', 'ActivityFeedPage', 'ActivityFeedPage.jsx']],
    ['Topbar user menu', ['components', 'layout', 'Topbar.jsx']],
    ['Teams table', ['pages', 'TeamsPage', 'TeamsPage.jsx']],
    ['Project settings access tab', ['pages', 'ProjectSettingsPage', 'ProjectSettingsPage.jsx']],
    ['Issue detail', ['pages', 'IssueDetailPage', 'IssueDetailPage.jsx']],
    ['Backlog issue row', ['components', 'issues', 'BacklogIssueRow.jsx']],
    ['Board issue row', ['components', 'issues', 'IssueRow.jsx']],
    ['Mention autocomplete', ['components', 'mentions', 'MentionInput.jsx']],
    ['Active sprint card', ['pages', 'ActiveSprintPage', 'ActiveSprintPage.jsx']],
    ['Filters table', ['pages', 'FiltersPage', 'FiltersPage.jsx']],
    ['Profile avatar fallback', ['pages', 'ProfilePage', 'ProfilePage.jsx']],
    ['Project summary', ['pages', 'ProjectSummaryPage', 'ProjectSummaryPage.jsx']],
    ['Projects table', ['pages', 'ProjectsPage', 'ProjectsPage.jsx']],
    ['Project detail', ['pages', 'ProjectDetailPage', 'ProjectDetailPage.jsx']],
    ['List view presence', ['pages', 'ListPage', 'IssueListPage.jsx']],
    ['Create-issue reporter', ['components', 'issues', 'CreateIssueModal.jsx']],
  ])('%s derives its avatar colour from the shared helper', (_label, parts) => {
    const source = read(...parts)
    expect(source).toMatch(/from '(\.\.\/)+utils\/avatarColour'/)
    expect(source).toContain('avatarStyle(')
  })

  it('leaves the reporter avatar without its hardcoded #0052cc', () => {
    const source = read('pages', 'IssueDetailPage', 'IssueDetailPage.jsx')
    expect(source).not.toContain("style={{ background: '#0052cc', color: '#fff' }}")
  })
})
