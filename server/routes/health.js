// JL-98 — Liveness + readiness probes.
//
//  GET /api/health  — liveness: always 200 (process is up).
//  GET /api/ready   — readiness: 200 when the DB answers `SELECT 1`, else 503.

import express from 'express'
import { get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = express.Router()

/** Liveness handler — the process is running; never touches the DB. */
export function livenessHandler(_req, res) {
  res.json({ status: 'ok', uptime: process.uptime() })
}

/**
 * Readiness handler — lightweight DB ping. 200 when reachable, 503 otherwise.
 * Exported so it can be unit-tested with a mocked db.
 */
export async function readinessHandler(_req, res) {
  try {
    await get('SELECT 1 AS ok')
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(503).json({ status: 'unavailable', error: err?.message })
  }
}

router.get('/health', livenessHandler)
router.get('/ready', asyncHandler(readinessHandler))

export default router
