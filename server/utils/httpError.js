// JL-181 — shared HTTP error responder.
//
// The de-facto error contract across this API is a JSON body `{ error: string }`
// (with an optional `errors: []` array for field-level validation). This helper
// centralizes that shape so new routes stop drifting toward `{ message }`,
// `{ success: false }`, bare strings, etc.
//
// It is intentionally byte-compatible with the common inline form
//   res.status(status).json({ error: message })
// so existing routes can adopt it without changing a single response body.
//
// Contract:
//   sendError(res, 404, 'Issue not found')
//     → res.status(404).json({ error: 'Issue not found' })
//   sendError(res, 400, 'Validation failed', { errors: ['title is required'] })
//     → res.status(400).json({ error: 'Validation failed', errors: [...] })
//
// `extra` keys are spread AFTER `error`, matching the JSON key order routes
// already emit ({ error, ...rest }). Returns the Express `res` so callers can
// `return sendError(...)` from a handler.

/**
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code (400/401/403/404/409/500…)
 * @param {string} message - human-readable error, surfaced to the client as `error`
 * @param {object} [extra] - optional extra fields merged into the body (e.g. `{ errors: [] }`)
 * @returns {import('express').Response}
 */
export function sendError(res, status, message, extra) {
  const body = { error: message }
  if (extra && typeof extra === 'object') Object.assign(body, extra)
  return res.status(status).json(body)
}

export default sendError
