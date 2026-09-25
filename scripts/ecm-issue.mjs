#!/usr/bin/env node
/*
 * ecm-issue — a CLI for querying and creating issues on any ECM Project Tracker
 * deployment (JL-474).
 *
 * ── Why this has two auth modes ──────────────────────────────────────────────
 *
 * Because the server does. They are not interchangeable, and the difference is
 * not a style choice this script gets to make:
 *
 *   API TOKEN  (ECM_API_TOKEN)
 *     `apiTokenAuth` is mounted on exactly one router — publicApi.js, at
 *     /api/public — and every route there is a GET. So a token reaches
 *     /api/public/me, /projects, /issues and /issues/:id, and nothing else.
 *     `authGuard` does not consult tokens, so presenting one to /api/issues is
 *     a 401.
 *
 *   SESSION  (ECM_EMAIL + ECM_PASSWORD -> POST /api/auth/login -> JWT)
 *     Reaches the full authenticated API, including writes.
 *
 * Note for whoever reads this next: `VALID_SCOPES` in routes/apiTokens.js is
 * ['read','write','*'], so the UI will happily mint a WRITE-scoped token — but
 * no endpoint in the codebase calls requireScope('write'). A write token is
 * issuable and does nothing. That is a server gap, not a gap here; this script
 * deliberately does not pretend otherwise, and tells you to use credentials
 * instead of failing with a bare 401.
 *
 * ── Shape differences it papers over ─────────────────────────────────────────
 *
 * The two surfaces return different field names for the same issue:
 *   /api/public/issues -> raw rows: issue_key, issue_type, project_id
 *   /api/issues        -> mapIssue(): key,      issueType,  projectId
 * `normalizeIssue` below reads either, so output is identical whichever
 * credential you used.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   ECM_BASE_URL=https://projects.fosasoft.com \
 *   ECM_API_TOKEN=ecm_... \
 *     node scripts/ecm-issue.mjs list --project 1
 *
 *   ECM_BASE_URL=https://projects.fosasoft.com \
 *   ECM_EMAIL=you@example.com ECM_PASSWORD=... \
 *     node scripts/ecm-issue.mjs create --title "..." --description "..." \
 *       --assignee you@example.com --type Bug --priority High --project 1
 *
 * Secrets come from the environment only — never from argv, which is visible to
 * every other process on the machine via the process list.
 *
 * No dependencies: Node's global fetch (18+). Exit codes: 0 ok, 1 usage or
 * request failure, 2 authentication/authorisation.
 */

const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_AUTH = 2

/*
 * The server validates both of these on create and defaults neither, so the CLI
 * supplies them. Chosen to match what 'file a ticket' ordinarily means: the
 * backlog, at normal priority. Both are overridable with --status / --priority.
 */
const DEFAULT_STATUS = 'Backlog'
const DEFAULT_PRIORITY = 'Medium'

/** Commands that write, and therefore cannot be served by an API token. */
const WRITE_COMMANDS = new Set(['create', 'status'])

const USAGE = `ecm-issue — query and create issues on an ECM Project Tracker instance

USAGE
  node scripts/ecm-issue.mjs <command> [options]

COMMANDS
  whoami                      Show who the current credential authenticates as
  projects                    List projects
  list                        List issues          [--project N] [--limit N] [--offset N]
  get <id>                    Fetch one issue by numeric id
  create                      Create an issue      (requires credentials, not a token)
  status <id> <status>        Change an issue's status (requires credentials)

CREATE OPTIONS
  --title <text>              required
  --description <text>        required
  --assignee <email|name>     required
  --project <id>              numeric project id
  --type <Story|Bug|Task|Sub-task|Epic>
  --priority <Low|Medium|High>            default: Medium
  --status <Backlog|To Do|In Progress|Code Review|In Testing
           |In Rework|In UAT|Done|Cancelled>   default: Backlog
  --points <n>                story points

GLOBAL OPTIONS
  --json                      Emit raw JSON instead of a table
  -h, --help                  This text

ENVIRONMENT
  ECM_BASE_URL                required, e.g. https://projects.fosasoft.com
  ECM_API_TOKEN               ecm_... — READ-ONLY (reaches /api/public only)
  ECM_EMAIL, ECM_PASSWORD     full access, including writes
  ECM_MFA_CODE                TOTP code, if the account has MFA enabled

NOTE
  An API token cannot create or modify issues: the server mounts token auth only
  on /api/public, which exposes no write routes. Use ECM_EMAIL/ECM_PASSWORD for
  'create' and 'status'.
`

// ── argument parsing ────────────────────────────────────────────────────────

/**
 * Minimal flag parser. Deliberately not a dependency: the surface is six
 * commands and a dozen flags, and adding a package to this repo for that would
 * cost more than it saves.
 *
 * `--flag value` and `--flag=value` both work; bare `--flag` is a boolean.
 */
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      flags.help = true
    } else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) {
          flags[arg.slice(2)] = true
        } else {
          flags[arg.slice(2)] = next
          i += 1
        }
      }
    } else {
      positional.push(arg)
    }
  }
  return { command: positional[0], positional: positional.slice(1), flags }
}

/**
 * Decide which credential to use, and refuse clearly rather than letting the
 * server answer with an unexplained 401.
 *
 * Returns { mode: 'session' | 'token' } or { error }.
 */
export function chooseAuth(command, env) {
  const hasCreds = Boolean(env.ECM_EMAIL && env.ECM_PASSWORD)
  const hasToken = Boolean(env.ECM_API_TOKEN)

  if (WRITE_COMMANDS.has(command)) {
    if (hasCreds) return { mode: 'session' }
    if (hasToken) {
      return {
        error:
          `'${command}' writes, and an API token cannot write: the server mounts token auth only on `
          + '/api/public, which has no write routes. Set ECM_EMAIL and ECM_PASSWORD instead.',
      }
    }
    return { error: `'${command}' requires ECM_EMAIL and ECM_PASSWORD.` }
  }

  // Reads: prefer the token. It is the narrower credential, it is revocable on
  // its own, and it avoids putting a password on a CI runner to list issues.
  if (hasToken) return { mode: 'token' }
  if (hasCreds) return { mode: 'session' }
  return { error: 'Set ECM_API_TOKEN (read-only) or ECM_EMAIL + ECM_PASSWORD.' }
}

/** Trim a trailing slash so `${base}/api/...` never doubles up. */
export function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) return null
  return value.replace(/\/+$/, '')
}

// ── issue shape ─────────────────────────────────────────────────────────────

/**
 * Read an issue row from either surface. /api/public returns raw DB columns,
 * /api/issues returns mapIssue()'s camelCase. Callers should not have to know
 * which credential produced the row.
 */
export function normalizeIssue(row) {
  if (!row || typeof row !== 'object') return null
  return {
    id: row.id,
    key: row.key ?? row.issue_key ?? '',
    title: row.title ?? '',
    status: row.status ?? '',
    priority: row.priority ?? '',
    type: row.issueType ?? row.issue_type ?? '',
    assignee: row.assignee ?? '',
    projectId: row.projectId ?? row.project_id ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(message, { status, exitCode } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.exitCode = exitCode ?? (status === 401 || status === 403 ? EXIT_AUTH : EXIT_FAIL)
  }
}

async function request(baseUrl, path, { method = 'GET', headers = {}, body } = {}) {
  let res
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    // DNS failure, refused connection, TLS problem — the server never answered,
    // so there is no status to map.
    throw new ApiError(`Could not reach ${baseUrl}: ${err.message}`)
  }

  const text = await res.text()
  let parsed = null
  if (text) {
    try { parsed = JSON.parse(text) } catch { /* non-JSON body handled below */ }
  }

  if (!res.ok) {
    const detail = parsed?.error || (text ? text.slice(0, 200) : res.statusText)
    throw new ApiError(`${method} ${path} → ${res.status}: ${detail}`, { status: res.status })
  }
  return parsed
}

/** Exchange credentials for a JWT. Handles the MFA challenge explicitly. */
async function login(baseUrl, env) {
  const body = { email: env.ECM_EMAIL, password: env.ECM_PASSWORD }
  if (env.ECM_MFA_CODE) body.mfaCode = env.ECM_MFA_CODE

  let data
  try {
    data = await request(baseUrl, '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
  } catch (err) {
    if (err.status === 401 && /MFA/i.test(err.message)) {
      throw new ApiError(
        'This account has MFA enabled. Set ECM_MFA_CODE to a current TOTP code and retry.',
        { status: 401 },
      )
    }
    throw err
  }

  if (!data?.token) throw new ApiError('Login succeeded but returned no token.', { status: 401 })
  if (data.passwordExpired) {
    process.stderr.write('warning: this account\'s password is past its rotation window.\n')
  }
  return data.token
}

// ── output ──────────────────────────────────────────────────────────────────

/** Clip to a column's max, marking the clip so a truncated value is obvious. */
function cell(row, column) {
  const value = String(row[column.key] ?? '')
  return column.max && value.length > column.max ? `${value.slice(0, column.max - 1)}…` : value
}

function printTable(rows, columns) {
  if (rows.length === 0) {
    process.stdout.write('(no results)\n')
    return
  }
  // Truncate BEFORE measuring. Measuring the raw values and clipping afterwards
  // sizes every column to its longest untruncated entry, so the header rule runs
  // past the text it underlines.
  const clipped = rows.map((row) => columns.map((c) => cell(row, c)))
  const widths = columns.map((c, i) =>
    Math.max(c.header.length, ...clipped.map((r) => r[i].length)))
  const line = (cells) =>
    cells.map((value, i) => String(value ?? '').padEnd(widths[i])).join('  ').trimEnd()

  process.stdout.write(`${line(columns.map((c) => c.header))}\n`)
  process.stdout.write(`${line(widths.map((w) => '-'.repeat(w)))}\n`)
  for (const row of clipped) process.stdout.write(`${line(row)}\n`)
}

const ISSUE_COLUMNS = [
  { key: 'key', header: 'KEY' },
  { key: 'type', header: 'TYPE' },
  { key: 'status', header: 'STATUS' },
  { key: 'priority', header: 'PRIORITY' },
  { key: 'assignee', header: 'ASSIGNEE', max: 28 },
  { key: 'title', header: 'TITLE', max: 60 },
]

// ── commands ────────────────────────────────────────────────────────────────

async function run(argv, env, { fetchImpl } = {}) {
  if (fetchImpl) globalThis.fetch = fetchImpl

  const { command, positional, flags } = parseArgs(argv)

  // `--help` is a request and succeeds; a bare invocation with no command is a
  // usage error that happens to print the same text.
  if (flags.help) {
    process.stdout.write(USAGE)
    return EXIT_OK
  }
  if (!command) {
    process.stdout.write(USAGE)
    return EXIT_FAIL
  }

  const baseUrl = normalizeBaseUrl(env.ECM_BASE_URL)
  if (!baseUrl) {
    process.stderr.write('error: ECM_BASE_URL must be set to an http(s) URL, e.g. https://projects.fosasoft.com\n')
    return EXIT_FAIL
  }

  const auth = chooseAuth(command, env)
  if (auth.error) {
    process.stderr.write(`error: ${auth.error}\n`)
    return EXIT_AUTH
  }

  // One Authorization header for the whole invocation. A token is sent as-is; a
  // session costs one extra round trip to exchange credentials for a JWT.
  const headers = auth.mode === 'token'
    ? { Authorization: `Bearer ${env.ECM_API_TOKEN}` }
    : { Authorization: `Bearer ${await login(baseUrl, env)}` }

  const json = (value) => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`) }

  switch (command) {
    case 'whoami': {
      // /api/public/me is the only identity endpoint a token can reach; a
      // session reads its own profile instead.
      const path = auth.mode === 'token' ? '/api/public/me' : '/api/profile'
      const me = await request(baseUrl, path, { headers })
      if (flags.json) { json(me); return EXIT_OK }
      process.stdout.write(`${me.email || me.user?.email || '(unknown)'}`)
      process.stdout.write(auth.mode === 'token' ? `  [token, scopes: ${(me.scopes || []).join(',') || 'read'}]\n` : '  [session]\n')
      return EXIT_OK
    }

    case 'projects': {
      const path = auth.mode === 'token' ? '/api/public/projects' : '/api/projects'
      const data = await request(baseUrl, path, { headers })
      const rows = Array.isArray(data) ? data : (data.projects ?? [])
      if (flags.json) { json(rows); return EXIT_OK }
      printTable(rows.map((p) => ({ id: p.id, key: p.key ?? p.project_key ?? '', name: p.name ?? '' })), [
        { key: 'id', header: 'ID' }, { key: 'key', header: 'KEY' }, { key: 'name', header: 'NAME', max: 50 },
      ])
      return EXIT_OK
    }

    case 'list': {
      const params = new URLSearchParams()
      if (flags.limit) params.set('limit', String(flags.limit))
      if (flags.offset) params.set('offset', String(flags.offset))

      if (flags.project) {
        const projectId = Number(flags.project)
        if (!Number.isInteger(projectId)) {
          process.stderr.write('error: --project takes a numeric project id (see `projects`)\n')
          return EXIT_FAIL
        }
        /*
         * The two surfaces filter by project differently, and getting this
         * wrong is silent rather than loud.
         *
         *   /api/public/issues  reads a `projectId` query param.
         *   /api/issues         destructures only { status, q, jql } — a
         *                       `projectId` param is ignored and the caller
         *                       gets EVERY issue back, looking like a filter
         *                       that matched broadly rather than one that was
         *                       dropped on the floor.
         *
         * JQL is the session endpoint's filter, and its FIELD_MAP resolves
         * `project` to the project_id column.
         */
        if (auth.mode === 'token') params.set('projectId', String(projectId))
        else params.set('jql', `project = ${projectId}`)
      }
      const qs = params.toString()

      const path = auth.mode === 'token'
        ? `/api/public/issues${qs ? `?${qs}` : ''}`
        : `/api/issues${qs ? `?${qs}` : ''}`
      const data = await request(baseUrl, path, { headers })
      const raw = Array.isArray(data) ? data : (data.issues ?? [])
      const rows = raw.map(normalizeIssue).filter(Boolean)
      if (flags.json) { json(rows); return EXIT_OK }
      printTable(rows, ISSUE_COLUMNS)
      return EXIT_OK
    }

    case 'get': {
      const id = positional[0]
      if (!id) { process.stderr.write('error: get requires an issue id\n'); return EXIT_FAIL }
      const path = auth.mode === 'token' ? `/api/public/issues/${id}` : `/api/issues/${id}`
      const data = await request(baseUrl, path, { headers })
      const issue = normalizeIssue(data.issue ?? data)
      if (flags.json) { json(issue); return EXIT_OK }
      for (const [k, v] of Object.entries(issue)) {
        process.stdout.write(`${k.padEnd(11)} ${v ?? ''}\n`)
      }
      return EXIT_OK
    }

    case 'create': {
      const missing = ['title', 'description', 'assignee'].filter((f) => !flags[f])
      if (missing.length) {
        // The server enforces these too; failing here saves a round trip and
        // names all of them at once instead of one per attempt.
        process.stderr.write(`error: create requires --${missing.join(', --')}\n`)
        return EXIT_FAIL
      }
      /*
       * POST /api/issues validates `priority` against validPriorities and
       * `status` against validStatuses and rejects with 400 if either is
       * missing — neither defaults server-side. Sending nothing therefore
       * fails with "status is invalid", which reads like the value was wrong
       * rather than absent. Defaulting here makes the ordinary case
       * three flags instead of five, and both stay overridable.
       */
      const body = {
        title: flags.title,
        description: flags.description,
        assignee: flags.assignee,
        priority: flags.priority || DEFAULT_PRIORITY,
        status: flags.status || DEFAULT_STATUS,
      }
      if (flags.project) body.projectId = Number(flags.project)
      if (flags.type) body.issueType = flags.type
      if (flags.points) body.storyPoints = Number(flags.points)

      const created = await request(baseUrl, '/api/issues', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body,
      })
      const issue = normalizeIssue(created)
      if (flags.json) { json(issue); return EXIT_OK }
      process.stdout.write(`Created ${issue.key || `#${issue.id}`} — ${issue.title}\n`)
      process.stdout.write(`${baseUrl}/issues/${issue.id}\n`)
      return EXIT_OK
    }

    case 'status': {
      const [id, ...rest] = positional
      const next = rest.join(' ')
      if (!id || !next) {
        process.stderr.write('error: status requires an issue id and a target status\n')
        return EXIT_FAIL
      }
      const updated = await request(baseUrl, `/api/issues/${id}/status`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: { status: next },
      })
      const issue = normalizeIssue(updated)
      if (flags.json) { json(issue); return EXIT_OK }
      process.stdout.write(`${issue.key || `#${issue.id}`} → ${issue.status}\n`)
      return EXIT_OK
    }

    default:
      process.stderr.write(`error: unknown command '${command}'\n\n${USAGE}`)
      return EXIT_FAIL
  }
}

export { run, ApiError, USAGE, WRITE_COMMANDS }

// Only execute when invoked directly, so the suite can import the helpers above
// without the CLI trying to run and exit the test process.
const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href

if (invokedDirectly) {
  run(process.argv.slice(2), process.env)
    .then((code) => { process.exitCode = code })
    .catch((err) => {
      process.stderr.write(`error: ${err.message}\n`)
      process.exitCode = err instanceof ApiError ? err.exitCode : EXIT_FAIL
    })
}
