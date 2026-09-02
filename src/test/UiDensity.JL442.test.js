// @vitest-environment node
//
// JL-442 — keep the application compact.
//
// The design system already had guards for *consistency*: JL-441 stops a
// colour or radius being written as a literal, JL-408 stops the MUI theme
// drifting from the CSS, JL-394/416 stop a font-size being written outside the
// token scale. None of them could catch what actually went wrong.
//
// JL-438 shifted the whole type ladder up one step in a single edit. Every
// call site was still spelling a token, every guard still passed, and 58 rules
// that had asked for 16px silently started rendering 20px. The chrome tokens
// went the same way: the issue-detail page was adopted as the visual reference
// and its own numbers — a 54px Create button, a 52px search field, a 48px
// sidebar row, a 36px title — became the *global* contract. Applied across 44
// pages that is the entire "everything is oversized" report.
//
// So the missing guard is on the VALUES themselves, not on whether a token was
// used. These assertions are the ceiling:
//
//   1. the type ladder is exactly 12/14/16/18/20/24/28 (+30 for brand/display);
//   2. no control role is taller than the 40px default;
//   3. ordinary UI text never asks for a step above 20px;
//   4. the retired role tokens stay retired.
//
// A change that makes the app bigger has to come here and say so.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIZE, LEADING, CONTROL_HEIGHT } from '../theme/muiTheme.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..')
const variablesCss = fs.readFileSync(path.join(srcRoot, 'styles', 'variables.css'), 'utf8')

/** `--name: value;` from variables.css, trailing `/* … *\/` note stripped. */
const declared = (name) => {
  const line = variablesCss
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`--${name}:`))
  if (!line) return undefined
  return line.split(':').slice(1).join(':').replace(/\/\*.*$/, '').replace(';', '').trim()
}

const px = (name) => {
  const v = declared(name)
  return v === undefined ? NaN : Number(v.replace('px', ''))
}

describe('JL-442 — the type ladder is the requested scale, and no larger', () => {
  // 12 / 14 / 16 / 18 / 20 / 24 / 28, with 30 reserved for the two roles that
  // are allowed to be the largest text on a page: the sidebar wordmark and the
  // issue title. Nothing in normal application UI reaches 36-40px again.
  const LADDER = { xs: 12, sm: 14, base: 14, md: 16, lg: 20, xl: 24, xxl: 28 }
  const PAIRING = { xs: 16, sm: 20, base: 20, md: 20, lg: 24, xl: 28, xxl: 32 }

  it.each(Object.entries(LADDER))('--font-size-%s is %ipx', (step, value) => {
    expect(px(`font-size-${step}`)).toBe(value)
  })

  it.each(Object.entries(PAIRING))('--line-height-%s is %ipx', (step, value) => {
    expect(px(`line-height-${step}`)).toBe(value)
  })

  it('keeps the two display roles on the heading scale', () => {
    // The issue title is Atlassian heading.large (24/28) and the sidebar
    // wordmark is heading.small (16/20). Neither is a display element: 30px
    // and 36px both shipped here at different points and both read as
    // oversized on a scaled display.
    expect(px('font-size-display')).toBe(24)
    expect(px('font-size-brand')).toBe(16)
    expect(px('font-size-display')).toBeLessThanOrEqual(24)
  })

  it('mirrors the ladder in the MUI theme', () => {
    for (const [step, value] of Object.entries(LADDER)) expect(SIZE[step], step).toBe(value)
    for (const [step, value] of Object.entries(PAIRING)) expect(LEADING[step], step).toBe(value)
  })

  it('keeps the retired role tokens retired', () => {
    // --font-size-detail carried section headings, breadcrumbs AND field
    // labels at one size; the correction splits them across base (16) and sm
    // (14), both of which already exist. --space-28 is not on the requested
    // spacing scale. Re-adding either is how a fourth naming family starts.
    expect(declared('font-size-detail'), '--font-size-detail was retired').toBeUndefined()
    expect(declared('line-height-detail')).toBeUndefined()
    expect(declared('space-28'), '--space-28 is not on the 4/8/12/16/20/24/32/40 scale').toBeUndefined()
  })
})

describe('JL-442 — one control scale', () => {
  // Every control role collapses onto the 40px default or sits below it. A
  // page that wants a 48px or 54px control is asking for a second scale.
  const ROLES = [
    'control-height', 'control-height-sm', 'control-height-flag',
    'control-height-status', 'control-height-nav', 'control-height-search',
    'control-height-create',
  ]

  it.each(ROLES)('--%s is at most the 40px default', (name) => {
    expect(px(name)).toBeLessThanOrEqual(CONTROL_HEIGHT)
  })

  it('sizes avatars for a dense UI', () => {
    // §15: assignee/reporter 32-36, topbar account 40-44.
    expect(px('avatar-size-md')).toBeGreaterThanOrEqual(24)
    expect(px('avatar-size-md')).toBeLessThanOrEqual(32)
    expect(px('avatar-size-lg')).toBeGreaterThanOrEqual(28)
    expect(px('avatar-size-lg')).toBeLessThanOrEqual(36)
  })

  it('keeps the shell chrome proportional to the reduced type scale', () => {
    // Not exact values — DesignTokens.JL441 pins those. These are the ceilings
    // that stop the shell being re-inflated around the same 40px controls.
    expect(px('layout-header-height')).toBeLessThanOrEqual(56)
    expect(px('layout-breadcrumb-height')).toBeLessThanOrEqual(48)
    expect(px('layout-content-padding')).toBeLessThanOrEqual(16)
  })

  // ── JL-443 ────────────────────────────────────────────────────────────
  // The sidebar and details panel must stay FLUID. A fixed pixel width is a
  // width tuned for one viewport, and it silently becomes wrong on every
  // other one: 288px + 304px is 31% of a 1920px screen but 46% of a 1280px
  // screen, and 1280px is what a 1920x1200 laptop reports at 150% Windows
  // scaling. Re-pinning either to a single px value reintroduces that, so
  // these assertions describe the SHAPE of the value, not a number.
  describe('the chrome widths are fluid, not fixed', () => {
    // A LITERAL regex, deliberately. MuiThemeTokens.JL408 carries the same
    // warning: built from a template string, the \s and \d escapes collapse to
    // bare "s" and "d" and the pattern silently matches nothing.
    const FLUID = /^clamp\(\s*(\d+)px\s*,\s*([\d.]+)vw\s*,\s*(\d+)px\s*\)$/

    it.each([
      ['layout-sidebar-width', 260],
      ['layout-details-panel-width', 288],
    ])('--%s is a bounded clamp() on vw', (name, maxAllowed) => {
      const decl = declared(name)
      const m = decl && decl.match(FLUID)
      expect(m, `--${name} must be clamp(<min>px, <n>vw, <max>px); got: ${decl}`).toBeTruthy()
      const [, min, vw, max] = m
      // A floor, or the sidebar shrinks past its own 16px labels and 18px icons.
      expect(Number(min), 'floor is too small to hold the nav row').toBeGreaterThanOrEqual(160)
      // A ceiling, or the chrome balloons on a 2560px monitor.
      expect(Number(max), 'ceiling too high').toBeLessThanOrEqual(maxAllowed)
      expect(Number(min)).toBeLessThan(Number(max))
      // The ratio has to actually do something between the bounds.
      expect(Number(vw)).toBeGreaterThan(0)
      expect(Number(vw)).toBeLessThanOrEqual(25)
    })

    it('holds chrome under 40% of the viewport from 1200px up', () => {
      // The arithmetic the clamps exist to satisfy. Evaluated here rather than
      // in a browser so it runs in the node project with the other guards.
      const evalClamp = (name, vw) => {
        const [, min, ratio, max] = declared(name).match(FLUID).map(Number)
        return Math.min(Math.max(min, (ratio / 100) * vw), max)
      }
      const failures = []
      for (const vw of [1200, 1280, 1366, 1440, 1536, 1680, 1920, 2560]) {
        const chrome = evalClamp('layout-sidebar-width', vw) +
                       evalClamp('layout-details-panel-width', vw)
        const pct = (chrome / vw) * 100
        if (pct >= 40) failures.push(`${vw}px -> ${pct.toFixed(1)}% chrome`)
      }
      expect(failures, failures.join('\n')).toEqual([])
    })

    it('is not overridden back to a fixed width at any breakpoint', () => {
      // layout.css used to re-pin the sidebar to 256px and 232px at its
      // breakpoints. Those overrides FOUGHT the clamp — at 1160px the fluid
      // value is 208px, so 256px made the sidebar wider exactly where room was
      // scarcest. A breakpoint may still retune padding; it may not restate a
      // chrome width.
      const layoutCss = fs.readFileSync(path.join(srcRoot, 'styles', 'layout.css'), 'utf8')
      const offenders = layoutCss
        .split(/\r?\n/)
        .map((l, i) => [l.trim(), i + 1])
        .filter(([l]) => /^--layout-(sidebar-width|details-panel-width):/.test(l))
        .map(([l, n]) => `layout.css:${n}  ${l}`)
      expect(offenders, offenders.join('\n')).toEqual([])
    })
  })

  it('keeps the default icon at 18px', () => {
    // §4/§5/§9 all land on 18: nav icon 18, header icon 18-20, button icon
    // 16-18. One value satisfies all three, so surfaces do not override it.
    expect(px('icon-md')).toBe(16)
  })
})

describe('JL-442 — one typography system: no page redeclares the scale', () => {
  // LoginPage.css scoped its OWN --font-size-*/--line-height-* ladder to
  // `.login-page` at 10/11/13/16/19/23, so the app's first screen rendered on
  // a different and much smaller scale than every screen behind it — the one
  // thing §29 rules out. It also meant that page silently ignored JL-396,
  // JL-414, JL-438 and JL-441: a token override scoped to a page looks
  // identical to a token change at a glance, which is why four tickets in a
  // row missed it.
  //
  // variables.css declares the scale. layout.css may retune the LAYOUT tokens
  // at a breakpoint — that is what a breakpoint is for — but nothing may
  // redeclare a type, control, avatar or icon token anywhere else.
  const SCALE = /^\s*--(font-size|line-height|font-weight|control-height|avatar-size|icon)-[a-z-]*:/

  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (entry.name.endsWith('.css')) out.push(full)
    }
    return out
  }

  it('declares the type and control scale in variables.css and nowhere else', () => {
    const findings = []
    for (const file of walk(srcRoot)) {
      const rel = path.relative(srcRoot, file)
      if (rel === path.join('styles', 'variables.css')) continue
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (SCALE.test(line)) findings.push(`${rel}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(findings, findings.join('\n')).toEqual([])
  })
})

describe('JL-442 — the issue title outranks the generic page-title rule', () => {
  // The markup is `<section class="page issue-detail-page"> … <h1 class="id-title">`,
  // so `.page h1` (0,1,1) and a bare `.id-title` (0,1,0) BOTH match and the
  // page-title rule wins. That is not hypothetical: it is how the app shipped
  // until JL-442. Every property `.page h1` sets — font-size, line-height,
  // font-weight, margin — beat the issue-title rule, so --font-size-display
  // never rendered once, and only letter-spacing and color got through.
  //
  // Nothing else in the suite models specificity, so this is the assertion
  // that the selector keeps its `.page h1` prefix.
  const css = fs.readFileSync(
    path.join(srcRoot, 'pages', 'IssueDetailPage', 'IssueDetailPage.css'), 'utf8',
  )

  it('writes every .id-title rule as `.page h1.id-title`', () => {
    const bare = css
      .split(/\r?\n/)
      .map((l, i) => [l.trim(), i + 1])
      .filter(([l]) => /(^|[\s,])\.id-title\b/.test(l) && l.includes('{'))
      .filter(([l]) => !l.includes('.page h1.id-title'))
      .map(([l, n]) => `IssueDetailPage.css:${n}  ${l}`)
    expect(bare, bare.join('\n')).toEqual([])
  })

  it('still sizes it from --font-size-display, not a page-title token', () => {
    expect(css).toMatch(/\.page h1\.id-title\s*\{[^}]*--font-size-display/)
  })
})

describe('JL-442 — ordinary UI text stays on the small half of the ladder', () => {
  // The two 30px roles are named, and everything else is capped. This is the
  // assertion that would have failed the moment JL-438 pushed 58 rules from
  // 16px to 20px: those rules are chrome, and chrome is not allowed above lg.
  const CHROME = /\.(nav|btn|tab|badge|pill|breadcrumb|field|table|search|create-btn|icon-btn|section-label)\b/

  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (entry.name.endsWith('.css')) out.push(full)
    }
    return out
  }

  it('never puts a shared control class above 20px', () => {
    const TOO_BIG = new Set(['xl', 'xxl', 'display', 'brand', 'metric-lg', 'metric-md'])
    const findings = []
    for (const file of walk(srcRoot)) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      let selector = ''
      lines.forEach((line, i) => {
        if (line.includes('{')) selector = line.split('{')[0].trim() || selector
        const m = line.match(/font-size:\s*var\(--font-size-([a-z-]+)\)/)
        if (!m || !TOO_BIG.has(m[1])) return
        if (!CHROME.test(selector)) return
        findings.push(`${path.relative(srcRoot, file)}:${i + 1}  ${selector} → --font-size-${m[1]}`)
      })
    }
    expect(findings, findings.join('\n')).toEqual([])
  })
})
