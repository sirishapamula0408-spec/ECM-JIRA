// @vitest-environment node
//
// JL-441 — keep the design system a system.
//
// JL-438/439/440 put one value in one place: styles/variables.css holds the
// numbers, styles/shared.css applies them to the hand-rolled controls, and
// theme/muiTheme.js applies them to the MUI ones. The sweep that got there
// replaced 616 colour literals and 376 radius literals across 53 stylesheets —
// nearly all of which were value-preserving, meaning nobody had noticed the
// drift. 119 of those sites still wrote the pre-JL-438 brand blue and never saw
// the refresh.
//
// Nothing stops that happening again except a test, so:
//
//   1. a colour that HAS a token may not be written as a literal;
//   2. a border-radius must come from the radius scale;
//   3. the layout/control tokens must exist and hold the briefed values;
//   4. muiTheme.js must agree with the CSS about radius and control height.
//
// Rule 1 deliberately polices only the colours that have tokens. A stylesheet
// is still free to write #ff5630 — that value has no token yet, and inventing
// one to satisfy a test is how token layers turn into dumping grounds.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RADIUS, CONTROL_HEIGHT, CONTROL_HEIGHT_SM } from '../theme/muiTheme.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..')

/** Where the values themselves are declared — exempt by definition. */
const TOKEN_SOURCES = new Set([
  path.join('styles', 'variables.css'),
  path.join('styles', 'theme.css'),
])

/** literal -> the token that carries it. */
const TOKENISED_COLOURS = {
  '#0052cc': '--jira-blue (refreshed to #0c66e4 in JL-438)',
  '#0747a6': '--jira-blue-hover',
  '#0065ff': '--jira-blue-hover',
  '#4c9aff': '--jira-blue',
  '#deebff': '--jira-blue-soft',
  '#bf2600': '--jira-danger-text',
  '#ffebe6': '--jira-danger-bg',
  '#006644': '--jira-success-text',
  '#e3fcef': '--jira-success-bg',
  '#97a0af': '--jira-text-subtlest',
  '#42526e': '--jira-text-muted',
  '#de350b': '--jira-danger',
  '#172b4d': '--jira-text',
  '#5e6c84': '--jira-text-muted',
  '#6b778c': '--jira-text-subtlest',
  '#dfe1e6': '--jira-border',
  '#c1c7d0': '--jira-border-strong',
  '#ebecf0': '--jira-border-subtle',
  '#f4f5f7': '--jira-surface-sunken',
  '#f1f2f4': '--jira-surface-hover',
  '#fafbfc': '--jira-surface-subtle',
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.css')) out.push(full)
  }
  return out
}

const stylesheets = walk(srcRoot)
  .map((f) => ({ file: f, rel: path.relative(srcRoot, f) }))
  .filter(({ rel }) => !TOKEN_SOURCES.has(rel))

/** Byte ranges covered by comments, so prose about a colour is not a violation. */
function commentRanges(text) {
  const out = []
  const re = /\/\*[\s\S]*?\*\//g
  let m
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length])
  return out
}

/** True when the index sits inside the arguments of a var(), i.e. is a fallback. */
function insideVar(line, index) {
  const before = line.slice(0, index)
  const open = before.lastIndexOf('var(')
  return open !== -1 && !before.slice(open).includes(')')
}

function scan(file, matcher) {
  const text = fs.readFileSync(file, 'utf8')
  const comments = commentRanges(text)
  const inComment = (i) => comments.some(([a, b]) => i >= a && i < b)
  const findings = []
  // The newline width has to match the file's, or every comment range after the
  // first line is off by one per line and the "is this inside a comment?" check
  // silently starts reporting prose as violations.
  const nl = text.includes('\r\n') ? 2 : 1
  let offset = 0
  for (const line of text.split(/\r?\n/)) {
    matcher(line, (index, message) => {
      if (inComment(offset + index)) return
      if (insideVar(line, index)) return
      findings.push(`${line.trim()}  — ${message}`)
    })
    offset += line.length + nl
  }
  return findings
}

describe('JL-441 — a colour that has a token is never written as a literal', () => {
  it.each(stylesheets.map(({ file, rel }) => [rel, file]))('%s', (_rel, file) => {
    const findings = scan(file, (line, report) => {
      const re = /#[0-9a-fA-F]{6}\b/g
      let m
      while ((m = re.exec(line))) {
        const token = TOKENISED_COLOURS[m[0].toLowerCase()]
        if (token) report(m.index, `use var(${token.split(' ')[0]})`)
      }
    })
    expect(findings, findings.join('\n')).toEqual([])
  })
})

describe('JL-441 — border-radius comes from the radius scale', () => {
  // The brief allows 3 / 6 / 8 / 12, plus the pill shape for chips and
  // counters. `border-radius: 0` and percentage/circle radii are untouched:
  // they are shapes, not steps on a scale.
  it.each(stylesheets.map(({ file, rel }) => [rel, file]))('%s', (_rel, file) => {
    const findings = scan(file, (line, report) => {
      const m = line.match(/\bborder-radius:\s*(\d+)px\s*(?:!important)?\s*;/)
      if (m && m[1] !== '0') report(line.indexOf(m[0]), 'use var(--radius-xs|sm|md|lg|pill)')
    })
    expect(findings, findings.join('\n')).toEqual([])
  })
})

describe('JL-441 — the layout and control tokens hold the briefed values', () => {
  const variablesCss = fs.readFileSync(path.join(srcRoot, 'styles', 'variables.css'), 'utf8')
  const declared = (name) => {
    const line = variablesCss.split(/\r?\n/).find((l) => l.trim().startsWith(`--${name}:`))
    if (!line) return undefined
    // Most declarations carry a trailing `/* … */` note describing the role.
    return line.split(':').slice(1).join(':').replace(/\/\*.*$/, '').replace(';', '').trim()
  }

  // Every number stated for the application shell. If one of these has to
  // change, change it here too — that is the point.
  //
  // JL-442 rewrote most of this table. The shell had been sized against one
  // page's chrome — a 54px Create button, a 52px search field, a 48px sidebar
  // row, a 36px display title — and those numbers then WERE the global
  // contract, which is what made the whole app read oversized. The five
  // outsized control roles now collapse onto the 40px default, the widths come
  // down ~11% to match the reduced type scale, and --font-size-detail /
  // --space-28 are gone entirely (see variables.css for why).
  // JL-443: the two chrome WIDTHS left this table. They are no longer single
  // pixel values — they are clamp() expressions, because a fixed width tuned
  // at 1920px ate 46% of a 1280px viewport. Their contract is now a ratio with
  // bounds, which UiDensity.JL442 asserts instead. Heights and padding stay
  // here: those are genuinely fixed.
  const EXPECTED = {
    'layout-header-height': '52px',
    'layout-breadcrumb-height': '44px',
    'layout-content-padding': '16px',
    'control-height': '32px',
    'control-height-sm': '24px',
    'control-height-flag': '32px',
    'control-height-status': '32px',
    'control-height-nav': '32px',
    'control-height-search': '32px',
    'control-height-create': '32px',
    'control-width-status': '220px',
    'avatar-size-md': '24px',
    'avatar-size-lg': '32px',
    'radius-xs': '3px',
    'radius-sm': '6px',
    'radius-md': '8px',
    'radius-lg': '12px',
    'radius-pill': '999px',
    'font-size-display': '24px',
    'line-height-display': '28px',
    'font-size-brand': '20px',
    'space-20': '20px',
    'space-40': '40px',
  }

  it.each(Object.entries(EXPECTED))('--%s is %s', (name, expected) => {
    expect(declared(name)).toBe(expected)
  })

  it('every --color-* name the brief lists is declared', () => {
    const required = [
      'color-primary', 'color-primary-hover', 'color-text-primary',
      'color-text-secondary', 'color-text-muted', 'color-background',
      'color-background-page', 'color-background-hover',
      'color-background-selected', 'color-border', 'color-border-strong',
      'color-success', 'color-success-bg', 'color-warning', 'color-warning-bg',
      'color-danger', 'color-danger-bg',
    ]
    const missing = required.filter((n) => declared(n) === undefined)
    expect(missing, `undeclared: ${missing.join(', ')}`).toEqual([])
  })

  it('the MUI theme agrees with the CSS about radius and control height', () => {
    // muiTheme.js has to repeat these as numbers — MUI computes with them.
    // This is the assertion that stops the repetition becoming a divergence.
    expect(`${RADIUS.xs}px`).toBe(declared('radius-xs'))
    expect(`${RADIUS.sm}px`).toBe(declared('radius-sm'))
    expect(`${RADIUS.md}px`).toBe(declared('radius-md'))
    expect(`${RADIUS.lg}px`).toBe(declared('radius-lg'))
    expect(`${CONTROL_HEIGHT}px`).toBe(declared('control-height'))
    expect(`${CONTROL_HEIGHT_SM}px`).toBe(declared('control-height-sm'))
  })
})
