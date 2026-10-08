// JL-157 — start the server under test: reset its database, then run the API
// with the production build served from /dist (one origin, like production).
//
//   E2E_RESET=0   keep the existing data (e.g. to re-run one spec quickly)
//
// Refuses to touch any database whose name does not end in _e2e, so a stray
// DATABASE_URL can never get this script anywhere near real data.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'
import { serverEnv, E2E_DATABASE_URL } from './env.mjs'

const dbName = new URL(E2E_DATABASE_URL).pathname.slice(1)
if (!dbName.endsWith('_e2e')) {
  console.error(`[e2e] refusing to reset "${dbName}": the e2e database name must end in _e2e`)
  process.exit(1)
}

if (!existsSync('dist/index.html')) {
  console.error('[e2e] dist/ is missing — run `npm run build` first')
  process.exit(1)
}

if (process.env.E2E_RESET !== '0') {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL })
  await client.connect()
  await client.query('DROP SCHEMA IF EXISTS public CASCADE')
  await client.query('CREATE SCHEMA public')
  await client.end()
  console.log(`[e2e] reset database ${dbName}`)
}

const server = spawn(process.execPath, ['server/index.js'], { env: serverEnv(), stdio: 'inherit' })
const stop = () => server.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
server.on('exit', (code) => process.exit(code ?? 0))
