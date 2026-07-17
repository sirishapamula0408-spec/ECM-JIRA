// JL-98 — Per-request correlation IDs + structured request/response logging.

import { randomUUID } from 'node:crypto'
import { logger } from '../services/logger.js'

/**
 * Express middleware:
 *  - Assigns `req.id` from the incoming `X-Request-Id` header, or generates one.
 *  - Echoes the id back on the `X-Request-Id` response header.
 *  - On response finish, logs one structured line (method, path, status, duration).
 */
export function requestLogger(req, res, next) {
  const incoming = req.headers['x-request-id']
  const id = (typeof incoming === 'string' && incoming.trim()) || randomUUID()
  req.id = id
  res.setHeader('X-Request-Id', id)

  const start = process.hrtime.bigint()
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6
    logger.info('request', {
      requestId: id,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
    })
  })

  next()
}

export default requestLogger
