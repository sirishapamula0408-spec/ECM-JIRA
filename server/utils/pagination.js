// JL-100 — shared pagination helper for list endpoints.
//
// Parses `limit` / `offset` (and convenience `page`) from a request query into
// clamped, safe integers so unbounded list endpoints cannot be forced to return
// (or COUNT over) huge result sets.
//
// Contract:
//   * `limit` is coerced to a positive integer, defaults to `defaultLimit`, and
//     is clamped to `[1, maxLimit]`. Invalid / absurd values fall back to the
//     default (then clamp), never throw.
//   * `offset` is coerced to a non-negative integer (default 0). When `offset`
//     is absent but `page` (1-based) is supplied, offset = (page - 1) * limit.
//   * Values are always safe to bind as `?` parameters (LIMIT ? OFFSET ?).

function toPositiveInt(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null
  return n
}

/**
 * @param {object} query - typically req.query
 * @param {{ defaultLimit?: number, maxLimit?: number }} [opts]
 * @returns {{ limit: number, offset: number }} clamped, bind-safe integers
 */
export function parsePagination(query = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  // --- limit -------------------------------------------------------------
  let limit = defaultLimit
  const rawLimit = toPositiveInt(query?.limit)
  if (rawLimit !== null && rawLimit > 0) limit = rawLimit
  if (limit > maxLimit) limit = maxLimit
  if (limit < 1) limit = 1

  // --- offset (offset wins over page) ------------------------------------
  let offset = 0
  const rawOffset = toPositiveInt(query?.offset)
  if (rawOffset !== null && rawOffset >= 0) {
    offset = rawOffset
  } else {
    const rawPage = toPositiveInt(query?.page)
    if (rawPage !== null && rawPage > 0) offset = (rawPage - 1) * limit
  }

  return { limit, offset }
}

/**
 * True when the request explicitly asks for pagination (so endpoints can keep
 * their legacy unbounded response shape unless a paging param is present).
 */
export function isPaginationRequested(query = {}) {
  return (
    query?.limit !== undefined || query?.offset !== undefined || query?.page !== undefined
  )
}

export default parsePagination
