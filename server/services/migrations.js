// --- JL-95: Lightweight schema migration tracking ---
// A minimal, dependency-free migration ledger layered on top of the existing
// idempotent initializeDatabase() DDL. The `schema_migrations` table records
// which versioned migrations have run so we can see/record schema state and
// track future one-off migrations. No external migration library is used —
// everything goes through the existing pg pool via run()/get()/all().

import { run, get, all } from '../db.js'

/**
 * Has a migration with this version already been recorded?
 * @param {string} version
 * @returns {Promise<boolean>}
 */
export async function hasMigration(version) {
  const row = await get('SELECT 1 FROM schema_migrations WHERE version = ?', [version])
  return Boolean(row)
}

/**
 * Record a migration as applied. Idempotent: re-recording the same version is a
 * no-op thanks to the UNIQUE(version) constraint + ON CONFLICT DO NOTHING.
 * @param {string} version
 * @param {string} [name]
 */
export async function recordMigration(version, name = '') {
  await run(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?) ON CONFLICT (version) DO NOTHING',
    [version, name],
  )
}

/**
 * List all recorded migrations, oldest first.
 * @returns {Promise<Array<{version: string, name: string, applied_at: string}>>}
 */
export async function listMigrations() {
  return all('SELECT version, name, applied_at FROM schema_migrations ORDER BY applied_at ASC, id ASC')
}

/**
 * Run a one-off migration exactly once. If `version` is already recorded, `fn`
 * is skipped. Otherwise `fn()` runs and the version is recorded. Safe to call on
 * every boot — this is the intended entry point for future tracked migrations.
 * @param {string} version
 * @param {string} name
 * @param {() => (void | Promise<void>)} fn
 * @returns {Promise<boolean>} true if fn ran, false if already applied
 */
export async function runMigration(version, name, fn) {
  if (await hasMigration(version)) {
    return false
  }
  if (typeof fn === 'function') {
    await fn()
  }
  await recordMigration(version, name)
  return true
}
