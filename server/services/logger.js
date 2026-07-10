// JL-98 — Dependency-free structured JSON logger.
//
// Emits single-line JSON `{ ts, level, msg, ...fields }` to stdout (info/debug/warn)
// or stderr (error), gated by a LOG_LEVEL threshold. No external logging libs.

import { LOG_LEVEL } from '../config.js'

// Ordered severity: lower number = less severe. A message is emitted only when
// its level is >= the configured threshold.
export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * Pure predicate: should a message at `level` be emitted given `threshold`?
 * Unknown levels default to `info` severity; unknown thresholds default to `info`.
 */
export function shouldLog(level, threshold) {
  const l = LEVELS[String(level).toLowerCase()] ?? LEVELS.info
  const t = LEVELS[String(threshold).toLowerCase()] ?? LEVELS.info
  return l >= t
}

/**
 * Pure formatter: turn a log entry object into a single-line JSON string.
 * Guarantees `ts`, `level`, `msg` come first, followed by any extra fields.
 */
export function formatLine(entry) {
  const { ts, level, msg, ...fields } = entry || {}
  return JSON.stringify({ ts, level, msg, ...fields })
}

function emit(level, msg, fields) {
  if (!shouldLog(level, LOG_LEVEL)) return
  const line = formatLine({
    ts: new Date().toISOString(),
    level,
    msg: msg == null ? '' : String(msg),
    ...(fields && typeof fields === 'object' ? fields : {}),
  })
  // Errors go to stderr; everything else to stdout.
  if (level === 'error') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const logger = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
}

export default logger
