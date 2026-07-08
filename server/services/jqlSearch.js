// JL-75 — JQL-style advanced search + free-text search builder.
//
// SAFETY CONTRACT:
//   * Field names are ALWAYS resolved through FIELD_MAP (a whitelist) into a
//     fixed set of real column names. User-supplied field text never reaches
//     the SQL string except after passing the whitelist.
//   * Every user-supplied VALUE is pushed as a bound parameter (`?` placeholder,
//     converted to $N by db.js). Values are never string-interpolated into SQL.
//   * ORDER BY column + direction are whitelisted (column via FIELD_MAP,
//     direction constrained to ASC|DESC), so the only interpolated tokens are
//     values the server controls.

// Whitelist: JQL field name (lowercased) -> real issues column.
const FIELD_MAP = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  type: 'issue_type',
  issuetype: 'issue_type',
  issue_type: 'issue_type',
  project: 'project_id',
  key: 'issue_key',
  title: 'title',
  created: 'created_at',
  createdat: 'created_at',
}

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// Matches one `field OP value` clause. Value may be double/single quoted, or a
// bare token possibly containing spaces (stops before an AND/OR/ORDER keyword).
const CLAUSE_RE =
  /([a-zA-Z_]+)\s*(!=|=|~)\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+(?:\s+(?!AND\b)(?!OR\b)(?!ORDER\b)[^\s]+)*))/gi

/**
 * Parse a JQL-lite string into a parameterized WHERE fragment.
 * Supports: `field OP value` clauses joined by AND/OR, operators = != ~,
 * and an optional trailing `ORDER BY field [ASC|DESC]`.
 * @returns {{ where: string, params: any[], orderBy: string|null }}
 * @throws {Error} with `.status = 400` on unknown field / empty query.
 */
export function parseJql(input) {
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

    const op = match[2]
    const rawValue =
      match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5]
    clauses.push({ column, op, value: String(rawValue).trim() })
    lastIndex = CLAUSE_RE.lastIndex
  }

  if (clauses.length === 0) throw badRequest('Invalid JQL query')

  // 3. Build the parameterized WHERE fragment. Values are ALWAYS bound.
  const params = []
  const parts = clauses.map((c) => {
    if (c.op === '~') {
      params.push(`%${c.value}%`)
      return `${c.column} ILIKE ?`
    }
    params.push(c.value)
    return `${c.column} ${c.op} ?`
  })

  let where = parts[0]
  for (let i = 1; i < parts.length; i += 1) {
    where += ` ${connectives[i - 1]} ${parts[i]}`
  }

  return { where, params, orderBy }
}

/**
 * Build the full search WHERE clause + params + ORDER BY for GET /api/issues.
 * Combines legacy `status`, free-text `q`, and `jql` with AND.
 * @returns {{ where: string, params: any[], orderBy: string }}
 */
export function buildIssueSearch({ status, q, jql } = {}) {
  const conditions = []
  const params = []
  let orderBy = 'id DESC'

  if (status != null && String(status).trim() !== '') {
    conditions.push('status = ?')
    params.push(status)
  }

  if (q != null && String(q).trim() !== '') {
    conditions.push('(issue_key ILIKE ? OR title ILIKE ? OR description ILIKE ?)')
    const like = `%${String(q).trim()}%`
    params.push(like, like, like)
  }

  if (jql != null && String(jql).trim() !== '') {
    const parsed = parseJql(jql)
    conditions.push(`(${parsed.where})`)
    params.push(...parsed.params)
    if (parsed.orderBy) orderBy = parsed.orderBy
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params, orderBy }
}

export { FIELD_MAP }
