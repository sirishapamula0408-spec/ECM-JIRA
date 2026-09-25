/* ================================================================
   JL-148 — issue links carry the key, not the internal row id.

   Every link in the app built `/issues/${issue.id}`, so clicking JL-63
   landed on /issues/402. issues.id is global across all projects and
   unrelated to the per-project key sequence — which is why it reads as
   a random number, and why id 305 turns out to be DM-266.

   What must hold:
     • a link uses the key when the issue has one
     • it degrades to the id when it does not, rather than breaking
     • a route param can be matched back to an issue either way
     • nothing in the app builds an id-based issue link any more,
       except the three places where only an id is available
   ================================================================ */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  isIssueKey, issueRefOf, issueHref, issueMatchesRef, numericIdFromRef,
} from '../utils/issueRef'

describe('JL-148 isIssueKey', () => {
  it('recognises a key', () => {
    expect(isIssueKey('JL-63')).toBe(true)
    expect(isIssueKey('DM-266')).toBe(true)
  })

  it('allows digits in the prefix — TP1-11 is a real key here', () => {
    expect(isIssueKey('TP1-11')).toBe(true)
  })

  it('rejects a bare number, so an id is never mistaken for a key', () => {
    expect(isIssueKey('402')).toBe(false)
    expect(isIssueKey('12-34')).toBe(false)
  })

  it('rejects malformed values', () => {
    for (const bad of ['', 'JL-', '-63', 'JL63', 'abc', null, undefined]) {
      expect(isIssueKey(bad), String(bad)).toBe(false)
    }
  })
})

describe('JL-148 issueRefOf / issueHref', () => {
  it('prefers the key', () => {
    expect(issueRefOf({ id: 402, key: 'JL-63' })).toBe('JL-63')
    expect(issueHref({ id: 402, key: 'JL-63' })).toBe('/browse/JL-63')
  })

  it('falls back to the id when the issue carries no key', () => {
    // A freshly created row, or a lightweight list row that omits the key.
    // A numeric link still resolves — it is only less pleasant to read.
    expect(issueRefOf({ id: 402 })).toBe('402')
    expect(issueHref({ id: 402 })).toBe('/browse/402')
  })

  it('treats a blank key as absent rather than emitting /issues/', () => {
    expect(issueRefOf({ id: 402, key: '   ' })).toBe('402')
  })

  it('does not throw on a missing or non-object issue', () => {
    expect(issueRefOf(null)).toBe('')
    expect(issueRefOf(undefined)).toBe('')
    expect(issueHref(null)).toBe('/browse')
  })

  it('encodes the ref, so a stray character cannot break the URL', () => {
    expect(issueHref({ id: 1, key: 'A B' })).toBe('/browse/A%20B')
  })
})

describe('JL-148 issueMatchesRef', () => {
  const ISSUE = { id: 402, key: 'JL-63' }

  it('matches on a numeric ref', () => {
    expect(issueMatchesRef(ISSUE, '402')).toBe(true)
    expect(issueMatchesRef(ISSUE, '403')).toBe(false)
  })

  it('matches on a key ref', () => {
    expect(issueMatchesRef(ISSUE, 'JL-63')).toBe(true)
    expect(issueMatchesRef(ISSUE, 'JL-64')).toBe(false)
  })

  it('matches a key case-insensitively, like the server does', () => {
    expect(issueMatchesRef(ISSUE, 'jl-63')).toBe(true)
  })

  it('does not match an id against the key, or vice versa', () => {
    expect(issueMatchesRef({ id: 63, key: 'JL-402' }, 'JL-63')).toBe(false)
  })

  it('is false for empty input rather than matching everything', () => {
    expect(issueMatchesRef(ISSUE, '')).toBe(false)
    expect(issueMatchesRef(ISSUE, null)).toBe(false)
    expect(issueMatchesRef(null, 'JL-63')).toBe(false)
  })
})

describe('JL-148 numericIdFromRef', () => {
  it('returns the number for a numeric ref', () => {
    expect(numericIdFromRef('402')).toBe(402)
  })

  it('returns null for a key — that needs a server lookup', () => {
    expect(numericIdFromRef('JL-63')).toBeNull()
    expect(numericIdFromRef('')).toBeNull()
  })
})

/* ---------------------------------------------------------------- *
 * Source guards
 * ---------------------------------------------------------------- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'test') walk(full, out)
    } else if (/\.jsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('JL-148 every issue link goes through issueHref', () => {
  /*
   * Two things this guards, and both have already been violated once:
   *
   *   1. An id-based link. /issues/402 is the internal row id — global across
   *      projects, unrelated to the key sequence, meaningless to a reader.
   *   2. A hardcoded path prefix. The canonical path moved from /issues to
   *      /browse mid-ticket; every site that had spelled the prefix out had to
   *      be swept again. issueHref() states it once so that cannot recur.
   *
   * Three call sites legitimately have an id and no key beside it. Each is
   * listed deliberately: a new one appearing is a regression, not an oversight.
   */
  const ALLOWED = [
    'n.issue_id',   // a notification row carries no key
    'target',       // SmartText has already resolved a route segment
    'issueId',      // the detail page's own param, already a ref
  ]

  const offendersIn = (prefix) => {
    const out = []
    // Matches `<prefix>/${expr}` in source text. Built with the RegExp
    // constructor from a plain string: a String.raw template swallows the
    // ${prefix} interpolation and produces a pattern that matches nothing,
    // which is how the first version of this guard passed while broken.
    const re = new RegExp(`(?<!/api)${prefix}/\\$\\{([^}]+)\\}`, 'g')
    for (const file of walk(resolve(process.cwd(), 'src'))) {
      if (file.endsWith('issueRef.js')) continue
      // src/api/* builds SERVER paths (/api/issues/:id), a different contract.
      if (/[\\/]api[\\/]/.test(file)) continue
      for (const m of readFileSync(file, 'utf8').matchAll(re)) {
        const expr = m[1].trim()
        if (ALLOWED.includes(expr)) continue
        out.push(`${file.split(/[\\/]/).slice(-2).join('/')}: ${prefix}/\${${expr}}`)
      }
    }
    return out
  }

  it('builds no /browse link by hand — the prefix belongs to issueHref', () => {
    const offenders = offendersIn('/browse')
    expect(offenders, `hand-built /browse links:\n${offenders.join('\n')}`).toEqual([])
  })

  it('leaves no id-based /issues link behind, bar the documented exceptions', () => {
    const offenders = offendersIn('/issues')
    expect(offenders, `id-based issue links found:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('JL-148 routing', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

  it('routes /browse/:issueId — the canonical, Atlassian-shaped path', () => {
    expect(app).toMatch(/path="\/browse\/:issueId"/)
  })

  it('keeps /issues/:issueId registered so links already shared still resolve', () => {
    expect(app).toMatch(/path="\/issues\/:issueId"/)
  })

  it('points both at the same page, so the alias needs no logic of its own', () => {
    const issuesRoute = app.match(/path="\/issues\/:issueId"[^\n]*/)[0]
    const browseRoute = app.match(/path="\/browse\/:issueId"[^\n]*/)[0]
    expect(browseRoute.replace('/browse/', '/issues/')).toBe(issuesRoute)
  })

  it('states the canonical prefix once, in issueRef', () => {
    const helper = readFileSync(resolve(process.cwd(), 'src/utils/issueRef.js'), 'utf8')
    expect(helper).toMatch(/ISSUE_PATH_PREFIX = '\/browse'/)
  })
})
