// @vitest-environment node
/* ================================================================
   JL-474 — scripts/ecm-issue.mjs

   A CLI for querying and creating issues on any ECM Project Tracker
   deployment. The parts worth pinning down are the pure ones: how
   arguments are read, which credential a command gets, and how the
   two different issue shapes the server returns are reconciled.

   The auth-selection rules are not a style choice. `apiTokenAuth` is
   mounted only on publicApi.js at /api/public, and every route there
   is a GET — so an API token physically cannot write, and the CLI has
   to say so rather than let the server answer with a bare 401.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import {
  parseArgs, chooseAuth, normalizeBaseUrl, normalizeIssue, WRITE_COMMANDS,
} from '../../scripts/ecm-issue.mjs'

describe('JL-474 parseArgs', () => {
  it('separates the command from its positional arguments', () => {
    const { command, positional } = parseArgs(['status', '42', 'In Progress'])
    expect(command).toBe('status')
    expect(positional).toEqual(['42', 'In Progress'])
  })

  it('reads --flag value', () => {
    expect(parseArgs(['list', '--project', '7']).flags.project).toBe('7')
  })

  it('reads --flag=value, so values containing spaces survive a shell', () => {
    expect(parseArgs(['create', '--title=Fix the thing']).flags.title).toBe('Fix the thing')
  })

  it('treats a flag with no value as boolean', () => {
    expect(parseArgs(['list', '--json']).flags.json).toBe(true)
  })

  it('does not swallow the next flag as a value', () => {
    const { flags } = parseArgs(['list', '--json', '--project', '3'])
    expect(flags.json).toBe(true)
    expect(flags.project).toBe('3')
  })

  it('accepts both -h and --help', () => {
    expect(parseArgs(['-h']).flags.help).toBe(true)
    expect(parseArgs(['list', '--help']).flags.help).toBe(true)
  })

  it('returns an undefined command for an empty argv', () => {
    expect(parseArgs([]).command).toBeUndefined()
  })
})

describe('JL-474 chooseAuth — reads', () => {
  it('prefers the token, the narrower credential, when both are present', () => {
    // Listing issues from CI should not require putting a password on the runner.
    expect(chooseAuth('list', {
      ECM_API_TOKEN: 't', ECM_EMAIL: 'a@b.c', ECM_PASSWORD: 'p',
    })).toEqual({ mode: 'token' })
  })

  it('falls back to credentials when there is no token', () => {
    expect(chooseAuth('list', { ECM_EMAIL: 'a@b.c', ECM_PASSWORD: 'p' })).toEqual({ mode: 'session' })
  })

  it('refuses when neither credential is set', () => {
    expect(chooseAuth('list', {}).error).toMatch(/ECM_API_TOKEN/)
  })

  it('does not accept a half-set credential pair as a session', () => {
    expect(chooseAuth('list', { ECM_EMAIL: 'a@b.c' }).error).toBeTruthy()
    expect(chooseAuth('list', { ECM_PASSWORD: 'p' }).error).toBeTruthy()
  })
})

describe('JL-474 chooseAuth — writes', () => {
  it('knows which commands write', () => {
    expect([...WRITE_COMMANDS].sort()).toEqual(['create', 'status'])
  })

  for (const command of ['create', 'status']) {
    it(`'${command}' uses a session when credentials exist`, () => {
      expect(chooseAuth(command, { ECM_EMAIL: 'a@b.c', ECM_PASSWORD: 'p' }))
        .toEqual({ mode: 'session' })
    })

    it(`'${command}' refuses a token and explains why, rather than sending a doomed request`, () => {
      const { error, mode } = chooseAuth(command, { ECM_API_TOKEN: 't' })
      expect(mode).toBeUndefined()
      expect(error).toMatch(/api\/public/)
      expect(error).toMatch(/ECM_EMAIL/)
    })

    it(`'${command}' refuses when nothing is set`, () => {
      expect(chooseAuth(command, {}).error).toMatch(/ECM_EMAIL/)
    })
  }

  it('prefers credentials over a token for a write even when both exist', () => {
    expect(chooseAuth('create', {
      ECM_API_TOKEN: 't', ECM_EMAIL: 'a@b.c', ECM_PASSWORD: 'p',
    })).toEqual({ mode: 'session' })
  })
})

describe('JL-474 normalizeBaseUrl', () => {
  it('strips trailing slashes so paths never double up', () => {
    expect(normalizeBaseUrl('https://projects.fosasoft.com/')).toBe('https://projects.fosasoft.com')
    expect(normalizeBaseUrl('https://projects.fosasoft.com///')).toBe('https://projects.fosasoft.com')
  })

  it('keeps a port and a path prefix intact', () => {
    expect(normalizeBaseUrl('http://localhost:4000')).toBe('http://localhost:4000')
  })

  it('rejects a value with no scheme — a bare host would build a relative URL', () => {
    expect(normalizeBaseUrl('projects.fosasoft.com')).toBeNull()
  })

  it('rejects empty and undefined', () => {
    expect(normalizeBaseUrl('')).toBeNull()
    expect(normalizeBaseUrl(undefined)).toBeNull()
  })
})

describe('JL-474 normalizeIssue — one shape from two surfaces', () => {
  // /api/public returns raw DB columns; /api/issues returns mapIssue()'s
  // camelCase. The caller should not have to know which credential it used.
  const PUBLIC_ROW = {
    id: 42, issue_key: 'ECM-7', title: 'Raw row', status: 'To Do', priority: 'High',
    issue_type: 'Bug', assignee: 'a@x.com', project_id: 3, created_at: '2026-01-01T00:00:00Z',
  }
  const SESSION_ROW = {
    id: 42, key: 'ECM-7', title: 'Mapped row', status: 'To Do', priority: 'High',
    issueType: 'Bug', assignee: 'a@x.com', projectId: 3, createdAt: '2026-01-01T00:00:00Z',
  }

  it('reads the snake_case public shape', () => {
    expect(normalizeIssue(PUBLIC_ROW)).toMatchObject({
      key: 'ECM-7', type: 'Bug', projectId: 3, createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('reads the camelCase session shape', () => {
    expect(normalizeIssue(SESSION_ROW)).toMatchObject({
      key: 'ECM-7', type: 'Bug', projectId: 3, createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('produces identical output from both, apart from the differing title', () => {
    const fromPublic = { ...normalizeIssue(PUBLIC_ROW), title: '' }
    const fromSession = { ...normalizeIssue(SESSION_ROW), title: '' }
    expect(fromPublic).toEqual(fromSession)
  })

  it('always returns every key, so table rendering never hits undefined', () => {
    expect(Object.keys(normalizeIssue({ id: 1 })).sort()).toEqual(
      ['assignee', 'createdAt', 'id', 'key', 'priority', 'projectId', 'status', 'title', 'type'],
    )
  })

  it('preserves a genuine null project rather than coercing it to a string', () => {
    expect(normalizeIssue({ id: 1, project_id: null }).projectId).toBeNull()
  })

  it('returns null for a non-object', () => {
    expect(normalizeIssue(null)).toBeNull()
    expect(normalizeIssue('nope')).toBeNull()
  })
})
