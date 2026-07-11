import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Default location of the Vite production build (repo-root/dist).
export const DEFAULT_DIST_DIR = path.resolve(__dirname, '..', 'dist')

// Matches every path that is NOT under /api. Used for the SPA fallback so that
// API routes (and /api/health, /api/docs, etc.) are never swallowed by the
// index.html catch-all. Express 5 / path-to-regexp v8 no longer accepts a bare
// '*' string route, so a RegExp is used for the wildcard.
export const SPA_FALLBACK_PATTERN = /^\/(?!api(?:\/|$)).*/

/**
 * Decide whether the Express server should also serve the built frontend.
 * Enabled in production, or explicitly via the SERVE_STATIC flag (for
 * single-container/prod-like deployments where NODE_ENV may not be set).
 */
export function shouldServeStatic(env = process.env) {
  return (
    env.NODE_ENV === 'production' ||
    env.SERVE_STATIC === 'true' ||
    env.SERVE_STATIC === '1'
  )
}

/**
 * Wire static file serving + an SPA history-fallback onto an Express app.
 *
 * Registers, in order:
 *   1. express.static(distDir)     — serves built assets (JS/CSS/images)
 *   2. GET <non-/api> -> index.html — client-side routing fallback
 *
 * API routes are registered by the caller BEFORE this function, and the
 * SPA_FALLBACK_PATTERN explicitly excludes /api, so REST/health/docs endpoints
 * are never intercepted.
 *
 * Exported as a small pure-ish function so the wiring can be unit-tested with a
 * fake app (no real server needed). `options.staticMiddleware` allows injecting
 * a sentinel middleware in tests.
 *
 * @param {import('express').Application} app
 * @param {{ distDir?: string, staticMiddleware?: Function }} [options]
 * @returns {{ distDir: string, indexFile: string, fallbackPattern: RegExp }}
 */
export function setupStaticServing(app, options = {}) {
  const distDir = options.distDir || DEFAULT_DIST_DIR
  const indexFile = path.join(distDir, 'index.html')
  const staticMiddleware = options.staticMiddleware || express.static(distDir)

  // 1. Serve hashed build assets.
  app.use(staticMiddleware)

  // 2. SPA fallback: any non-/api GET returns index.html so client routing works.
  app.get(SPA_FALLBACK_PATTERN, (_req, res) => {
    res.sendFile(indexFile)
  })

  return { distDir, indexFile, fallbackPattern: SPA_FALLBACK_PATTERN }
}
