// JL-75 — JQL-style advanced search + free-text search builder.
// JL-117 — Full JQL functions (currentUser, membersOf, linkedIssues, date functions).
//
// SAFETY CONTRACT:
//   * Field names are ALWAYS resolved through FIELD_MAP (a whitelist) into a
//     fixed set of real column names. User-supplied field text never reaches
//     the SQL string except after passing the whitelist.
//   * Every user-supplied VALUE is pushed as a bound parameter (`?` placeholder,
//     converted to $N by db.js). Values are never string-interpolated into SQL.
//   * FUNCTION values (currentUser/membersOf/linkedIssues/date functions) are
//     whitelisted by name. Their results (the current user identity, the member
//     list, the linked-issue keys, the computed timestamps) are ALWAYS bound as
//     parameters — never interpolated. Unknown functions → 400.
//   * ORDER BY column + direction are whitelisted (column via FIELD_MAP,
//     direction constrained to ASC|DESC), so the only interpolated tokens are
//     values the server controls.

import { all } from '../db.js'

// Whitelist: JQL field name (lowercased) -> real issues column.
const FIELD_MAP = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  reporter: 'reporter',
  type: 'issue_type',
  issuetype: 'issue_type',
  issue_type: 'issue_type',
  project: 'project_id',
  key: 'issue_key',
  issue: 'issue_key',
  title: 'title',
  created: 'created_at',
  createdat: 'created_at',
  updated: 'updated_at',
  updatedat: 'updated_at',
  due: 'due_date',
  duedate: 'due_date',
  start: 'start_date',
  startdate: 'start_date',
}

// Columns that hold timestamps — the only columns for which bare relative
// offsets (`-7d`, `+3d`) are interpreted as computed timestamps.
const DATE_COLUMNS = new Set(['created_at', 'updated_at', 'due_date', 'start_date'])

// Whitelisted relative/absolute date functions (computed in JS, then bound).
const DATE_FUNCS = new Set([
  'now',
  'startofday',
  'endofday',
  'startofweek',
  'endofweek',
])

// Scalar functions/values may only be compared with these operators.
const SCALAR_OPS = new Set(['=', '!=', '>', '>=', '<', '<='])

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// Matches one `field OP value` clause. Value may be a function call, a
// double/single quoted string, or a bare token possibly containing spaces
// (stops before an AND/OR/ORDER keyword).
//   1 field
//   2 operator
//   3 function name   4 fn dq-arg   5 fn sq-arg   6 fn bare-arg
//   7 double-quoted value   8 single-quoted value   9 bare value
const CLAUSE_RE = new RegExp(
  '([a-zA-Z_]+)' +
    '\\s*(>=|<=|!=|~|=|>|<|\\bNOT\\s+IN\\b|\\bIN\\b)\\s*' +
    '(?:' +
    '([a-zA-Z][a-zA-Z0-9]*)\\s*\\(\\s*(?:"([^"]*)"|\'([^\']*)\'|([^)]*?))\\s*\\)' +
    '|"([^"]*)"' +
    "|'([^']*)'" +
    '|([^\\s"\']+(?:\\s+(?!AND\\b)(?!OR\\b)(?!ORDER\\b)[^\\s]+)*)' +
    ')',
  'gi',
)

const OFFSET_RE = /^([+-])(\d+)([dwhm])$/

/**
 * Peel a trailing ORDER BY and scan the remaining body into clause objects.
 * Pure/synchronous: performs NO database access and NO function resolution.
 * @returns {{ clauses: object[], connectives: string[], orderBy: string|null }}
 */
function scanQuery(input) {
  let body = String(input == null ? '' : input).trim()
  if (!body) throw badRequest('Empty JQL query')

  // 1. Peel off a trailing ORDER BY clause.
  let orderBy = null
  const orderMatch = body.match(/\s+ORDER\s+BY\s+([a-zA-Z_]+)(?:\s+(ASC|DESC))?\s*$/i)
  if (orderMatch) {
    const col = FIELD_MAP[orderMatch[1].toLowerCase()]
    if (!col) throw badRequest(`Unknown field in ORDER BY: ${orderMatch[1]}`)
    const dir = (orderMatch[2] || 'ASC').toUpperCase()
    orderBy = `${col} ${dir}`
    body = body.slice(0, orderMatch.index).trim()
  }

  if (!body) throw badRequest('JQL query has no filter clauses')

  // 2. Scan clauses and the AND/OR connectives between them.
  const clauses = []
  const connectives = []
  CLAUSE_RE.lastIndex = 0
  let match
  let lastIndex = 0
  let first = true
  while ((match = CLAUSE_RE.exec(body)) !== null) {
    if (!first) {
      const between = body.slice(lastIndex, match.index)
      connectives.push(/\bOR\b/i.test(between) ? 'OR' : 'AND')
    }
    first = false

    const field = match[1].toLowerCase()
    const column = FIELD_MAP[field]
    if (!column) throw badRequest(`Unknown field: ${match[1]}`)

    const op = match[2].replace(/\s+/g, ' ').toUpperCase()
    const funcName = match[3]
    const funcArg =
      match[4] !== undefined
        ? match[4]
        : match[5] !== undefined
          ? match[5]
          : match[6] !== undefined
            ? match[6]
            : undefined
    const rawValue =
      match[7] !== undefined ? match[7] : match[8] !== undefined ? match[8] : match[9]

    clauses.push({
      column,
      op,
      funcName: funcName !== undefined ? funcName : null,
      funcArg: funcArg === undefined ? '' : String(funcArg).trim(),
      value: rawValue === undefined ? '' : String(rawValue).trim(),
    })
    lastIndex = CLAUSE_RE.lastIndex
  }

  if (clauses.length === 0) throw badRequest('Invalid JQL query')

  return { clauses, connectives, orderBy }
}

function baseNow(ctx) {
  return ctx && ctx.now instanceof Date ? new Date(ctx.now.getTime()) : new Date()
}

function computeDateFunction(fn, ctx) {
  const d = baseNow(ctx)
  switch (fn) {
    case 'now':
      return d
    case 'startofday':
      d.setHours(0, 0, 0, 0)
      return d
    case 'endofday':
      d.setHours(23, 59, 59, 999)
      return d
    case 'startofweek': {
      const diff = (d.getDay() + 6) % 7 // Monday = start of week
      d.setDate(d.getDate() - diff)
      d.setHours(0, 0, 0, 0)
      return d
    }
    case 'endofweek': {
      const diff = (d.getDay() + 6) % 7
      d.setDate(d.getDate() - diff + 6)
      d.setHours(23, 59, 59, 999)
      return d
    }
    default:
      return null
  }
}

function computeOffset(raw, ctx) {
  const m = OFFSET_RE.exec(raw)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  const n = sign * Number(m[2])
  const d = baseNow(ctx)
  switch (m[3]) {
    case 'd':
      d.setDate(d.getDate() + n)
      break
    case 'w':
      d.setDate(d.getDate() + n * 7)
      break
    case 'h':
      d.setHours(d.getHours() + n)
      break
    case 'm':
      d.setMinutes(d.getMinutes() + n)
      break
    default:
      return null
  }
  return d
}

// Build an IN / NOT IN fragment binding every value in `list` as a parameter.
function buildInClause(column, opNorm, list, params) {
  const negate = opNorm === '!=' || opNorm === 'NOT IN'
  if (!list || list.length === 0) {
    // Empty set: constant predicate, no user input interpolated.
    return negate ? '1=1' : '1=0'
  }
  const placeholders = list.map(() => '?').join(', ')
  for (const v of list) params.push(v)
  return `${column} ${negate ? 'NOT IN' : 'IN'} (${placeholders})`
}

/**
 * Compile a single scanned clause into a SQL fragment, pushing bound params.
 * `resolved` is a Map of `fn:arg` -> value list for async (DB) functions.
 */
function compileClause(clause, params, ctx, resolved) {
  const { column, op } = clause

  if (clause.funcName != null) {
    const fn = clause.funcName.toLowerCase()

    if (fn === 'currentuser') {
      if (clause.funcArg) throw badRequest('currentUser() takes no arguments')
      if (!SCALAR_OPS.has(op)) throw badRequest(`Operator ${op} is not valid with currentUser()`)
      const u = ctx && ctx.currentUser
      if (u == null || u === '') {
        throw badRequest('currentUser() requires an authenticated user')
      }
      params.push(u)
      return `${column} ${op} ?`
    }

    if (DATE_FUNCS.has(fn)) {
      if (!SCALAR_OPS.has(op)) throw badRequest(`Operator ${op} is not valid with ${fn}()`)
      const d = computeDateFunction(fn, ctx)
      params.push(d.toISOString())
      return `${column} ${op} ?`
    }

    if (fn === 'membersof' || fn === 'linkedissues') {
      if (op !== '=' && op !== '!=' && op !== 'IN' && op !== 'NOT IN') {
        throw badRequest(`Operator ${op} is not valid with ${clause.funcName}()`)
      }
      const list = resolved.get(`${fn}:${clause.funcArg}`)
      if (list === undefined) {
        throw badRequest(`${clause.funcName}() must be resolved with database access`)
      }
      return buildInClause(column, op, list, params)
    }

    throw badRequest(`Unknown function: ${clause.funcName}`)
  }

  // Plain (non-function) value.
  if (op === 'IN' || op === 'NOT IN') {
    throw badRequest(`${op} requires a function value (e.g. membersOf/linkedIssues)`)
  }

  const raw = clause.value

  // Relative date offset (`-7d`, `+3d`) — only for date columns.
  if (DATE_COLUMNS.has(column) && OFFSET_RE.test(raw)) {
    if (!SCALAR_OPS.has(op)) throw badRequest(`Operator ${op} is not valid with a date offset`)
    params.push(computeOffset(raw, ctx).toISOString())
    return `${column} ${op} ?`
  }

  if (op === '~') {
    params.push(`%${raw}%`)
    return `${column} ILIKE ?`
  }

  params.push(raw)
  return `${column} ${op} ?`
}

function compileScanned(scanned, ctx, resolved) {
  const { clauses, connectives } = scanned
  const params = []
  const parts = clauses.map((c) => compileClause(c, params, ctx, resolved))

  let where = parts[0]
  for (let i = 1; i < parts.length; i += 1) {
    where += ` ${connectives[i - 1]} ${parts[i]}`
  }
  return { where, params }
}

// Resolve DB-backed functions (membersOf / linkedIssues) into concrete value
// lists, bound later as parameters. Returns a Map keyed `fn:arg`.
async function resolveFunctions(clauses, ctx) {
  const resolved = new Map()
  for (const c of clauses) {
    if (c.funcName == null) continue
    const fn = c.funcName.toLowerCase()
    if (fn !== 'membersof' && fn !== 'linkedissues') continue
    const key = `${fn}:${c.funcArg}`
    if (resolved.has(key)) continue

    if (fn === 'membersof') {
      if (!c.funcArg) throw badRequest('membersOf() requires a role/group argument')
      const rows = await all(
        'SELECT name, email FROM members WHERE LOWER(role) = LOWER(?)',
        [c.funcArg],
      )
      const list = []
      const seen = new Set()
      for (const r of rows || []) {
        for (const v of [r.email, r.name]) {
          if (v == null || v === '' || seen.has(v)) continue
          seen.add(v)
          list.push(v)
        }
      }
      resolved.set(key, list)
    } else {
      if (!c.funcArg) throw badRequest('linkedIssues() requires an issue key argument')
      const rows = await all(
        'SELECT DISTINCT i.issue_key AS val ' +
          'FROM issue_links l ' +
          'JOIN issues i ON (i.id = l.source_issue_id OR i.id = l.target_issue_id) ' +
          'WHERE (l.source_issue_id = (SELECT id FROM issues WHERE issue_key = ?) ' +
          '   OR l.target_issue_id = (SELECT id FROM issues WHERE issue_key = ?)) ' +
          'AND i.issue_key <> ?',
        [c.funcArg, c.funcArg, c.funcArg],
      )
      const list = []
      for (const r of rows || []) {
        if (r.val != null && r.val !== '') list.push(r.val)
      }
      resolved.set(key, list)
    }
  }
  return resolved
}

/**
 * Parse a JQL-lite string into a parameterized WHERE fragment (SYNCHRONOUS).
 * Supports: `field OP value` clauses joined by AND/OR, operators = != ~ > >= < <=,
 * scalar functions (currentUser, now/startOfDay/…), relative date offsets, and an
 * optional trailing `ORDER BY field [ASC|DESC]`.
 *
 * DB-backed functions (membersOf / linkedIssues) require async resolution — use
 * {@link buildIssueSearchAsync}; calling them here throws a 400.
 *
 * @param {string} input
 * @param {{ currentUser?: string, now?: Date }} [ctx]
 * @returns {{ where: string, params: any[], orderBy: string|null }}
 * @throws {Error} with `.status = 400` on unknown field/function / empty query.
 */
export function parseJql(input, ctx = {}) {
  const scanned = scanQuery(input)
  const { where, params } = compileScanned(scanned, ctx, new Map())
  return { where, params, orderBy: scanned.orderBy }
}

/**
 * Async variant: resolves DB-backed functions (membersOf / linkedIssues) first,
 * then compiles. Result lists are ALWAYS bound as parameters.
 * @returns {Promise<{ where: string, params: any[], orderBy: string|null }>}
 */
export async function parseJqlAsync(input, ctx = {}) {
  const scanned = scanQuery(input)
  const resolved = await resolveFunctions(scanned.clauses, ctx)
  const { where, params } = compileScanned(scanned, ctx, resolved)
  return { where, params, orderBy: scanned.orderBy }
}

function baseConditions({ status, q } = {}) {
  const conditions = []
  const params = []

  if (status != null && String(status).trim() !== '') {
    conditions.push('status = ?')
    params.push(status)
  }

  if (q != null && String(q).trim() !== '') {
    conditions.push('(issue_key ILIKE ? OR title ILIKE ? OR description ILIKE ?)')
    const like = `%${String(q).trim()}%`
    params.push(like, like, like)
  }

  return { conditions, params }
}

/**
 * Build the full search WHERE clause + params + ORDER BY for GET /api/issues.
 * Combines legacy `status`, free-text `q`, and `jql` with AND (SYNCHRONOUS —
 * does not resolve DB-backed functions).
 * @returns {{ where: string, params: any[], orderBy: string }}
 */
export function buildIssueSearch({ status, q, jql, currentUser, now } = {}) {
  const { conditions, params } = baseConditions({ status, q })
  let orderBy = 'id DESC'

  if (jql != null && String(jql).trim() !== '') {
    const parsed = parseJql(jql, { currentUser, now })
    conditions.push(`(${parsed.where})`)
    params.push(...parsed.params)
    if (parsed.orderBy) orderBy = parsed.orderBy
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params, orderBy }
}

/**
 * Async variant of {@link buildIssueSearch} — resolves DB-backed JQL functions
 * (membersOf / linkedIssues) and injects `currentUser()`. Used by the issues
 * route so function values compile to SAFE bound parameters.
 * @returns {Promise<{ where: string, params: any[], orderBy: string }>}
 */
export async function buildIssueSearchAsync({ status, q, jql, currentUser, now } = {}) {
  const { conditions, params } = baseConditions({ status, q })
  let orderBy = 'id DESC'

  if (jql != null && String(jql).trim() !== '') {
    const parsed = await parseJqlAsync(jql, { currentUser, now })
    conditions.push(`(${parsed.where})`)
    params.push(...parsed.params)
    if (parsed.orderBy) orderBy = parsed.orderBy
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params, orderBy }
}

export { FIELD_MAP }
