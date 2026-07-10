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

// JL-118: Whitelist for history operators (WAS / WAS IN / CHANGED). Maps the JQL
// field name (lowercased) -> the `field` string recorded in issue_history
// (see recordHistory() in server/routes/issues.js). Only tracked fields qualify;
// any other field used with a history operator is a 400.
const HISTORY_FIELD_MAP = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  type: 'type',
  issuetype: 'type',
  issue_type: 'type',
  title: 'title',
  sprint: 'sprint',
  epic: 'epic',
}

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// A JQL value: double/single quoted, or a bare token possibly containing spaces
// (stops before an AND/OR/ORDER keyword). Reused across clause alternatives.
const VALUE = `(?:"([^"]*)"|'([^']*)'|([^\\s"']+(?:\\s+(?!AND\\b)(?!OR\\b)(?!ORDER\\b)[^\\s]+)*))`

// Matches ONE clause. Alternatives, tried left-to-right:
//   A. `field WAS IN (list)`  -> g1 field, g2 list body
//   B. `field WAS value`      -> g3 field, g4/g5/g6 value (dq/sq/bare)
//   C. `field CHANGED`        -> g7 field
//   D. `field OP value`       -> g8 field, g9 op, g10/g11/g12 value
const CLAUSE_RE = new RegExp(
  // The list body allows quoted segments (which may contain `)`) or any
  // non-`)` char, so a `)` inside a quoted value doesn't end the list early.
  `([a-zA-Z_]+)\\s+WAS\\s+IN\\s*\\(((?:"[^"]*"|'[^']*'|[^)])*)\\)` +
    `|([a-zA-Z_]+)\\s+WAS\\s+${VALUE}` +
    `|([a-zA-Z_]+)\\s+CHANGED\\b` +
    `|([a-zA-Z_]+)\\s*(!=|=|~)\\s*${VALUE}`,
  'gi',
)

// Splits a `WAS IN (...)` list body into individual values (quotes respected;
// bare items are comma-delimited). Leading/trailing whitespace is trimmed.
const LIST_ITEM_RE = /\s*(?:"([^"]*)"|'([^']*)'|([^,]+))\s*(?:,|$)/g

function resolveHistoryField(rawField) {
  const histField = HISTORY_FIELD_MAP[rawField.toLowerCase()]
  if (!histField) {
    throw badRequest(`Field not tracked in history: ${rawField}`)
  }
  return histField
}

// Builds a correlated EXISTS subquery against issue_history. `i.id` is the outer
// issues alias used by GET /api/issues. All values are bound (pushed to params).
function buildHistoryExists(kind, histField, values, params) {
  if (kind === 'CHANGED') {
    params.push(histField)
    return `EXISTS (SELECT 1 FROM issue_history h WHERE h.issue_id = i.id AND h.field = ?)`
  }
  // WAS / WAS IN: match if the field was ever equal to any listed value, in
  // either the old_value or new_value column of a history row.
  params.push(histField)
  const placeholders = values.map(() => '?').join(', ')
  params.push(...values, ...values)
  return (
    `EXISTS (SELECT 1 FROM issue_history h WHERE h.issue_id = i.id AND h.field = ? ` +
    `AND (h.old_value IN (${placeholders}) OR h.new_value IN (${placeholders})))`
  )
}

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

    if (match[1] !== undefined) {
      // A. `field WAS IN (list)` — history membership.
      const histField = resolveHistoryField(match[1])
      const values = []
      LIST_ITEM_RE.lastIndex = 0
      let item
      while ((item = LIST_ITEM_RE.exec(match[2])) !== null) {
        if (item.index === LIST_ITEM_RE.lastIndex) LIST_ITEM_RE.lastIndex += 1
        const raw = item[1] !== undefined ? item[1] : item[2] !== undefined ? item[2] : item[3]
        if (raw === undefined) continue
        const v = String(raw).trim()
        if (v) values.push(v)
      }
      if (values.length === 0) throw badRequest('WAS IN requires at least one value')
      clauses.push({ kind: 'WAS', histField, values })
    } else if (match[3] !== undefined) {
      // B. `field WAS value` — ever equal to a single value.
      const histField = resolveHistoryField(match[3])
      const rawValue =
        match[4] !== undefined ? match[4] : match[5] !== undefined ? match[5] : match[6]
      clauses.push({ kind: 'WAS', histField, values: [String(rawValue).trim()] })
    } else if (match[7] !== undefined) {
      // C. `field CHANGED` — any history row for the field.
      const histField = resolveHistoryField(match[7])
      clauses.push({ kind: 'CHANGED', histField })
    } else {
      // D. `field OP value` — current-state clause.
      const field = match[8].toLowerCase()
      const column = FIELD_MAP[field]
      if (!column) throw badRequest(`Unknown field: ${match[8]}`)
      const op = match[9]
      const rawValue =
        match[10] !== undefined ? match[10] : match[11] !== undefined ? match[11] : match[12]
      clauses.push({ kind: 'CURRENT', column, op, value: String(rawValue).trim() })
    }
    lastIndex = CLAUSE_RE.lastIndex
  }

  if (clauses.length === 0) throw badRequest('Invalid JQL query')

  // 3. Build the parameterized WHERE fragment. Values are ALWAYS bound.
  const params = []
  const parts = clauses.map((c) => {
    if (c.kind === 'WAS' || c.kind === 'CHANGED') {
      return buildHistoryExists(c.kind, c.histField, c.values, params)
    }
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
