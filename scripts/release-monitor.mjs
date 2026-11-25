#!/usr/bin/env node
/*
 * release-monitor — set up the Release Monitor account (JL-487, JL-488).
 *
 * The check itself runs IN THE SERVER (server/services/releaseCheck.js): the
 * moment a release is marked Released, every work item in it is checked (Done
 * passes, anything else fails), each gets a "Release Monitor" comment, and
 * everyone holding the project role "Release Monitor" is notified (in-app and
 * email). This script only does what the server cannot do for itself:
 *
 *   provision   As a workspace Admin, create the monitor account (workspace
 *               Viewer) and give it the project role "Release Monitor".
 *               Prints its password once.
 *
 *   backfill    As any account allowed to check (project Member+ or Release
 *               Monitor), check every Released release that has never been
 *               checked, e.g. releases shipped before JL-488 was deployed.
 *               Exit code 1 when any check failed.
 *
 * Usage:
 *   ECM_BASE_URL=https://projects.fosasoft.com \
 *   ECM_ADMIN_EMAIL=... ECM_ADMIN_PASSWORD=... \
 *     node scripts/release-monitor.mjs provision --project 16
 *
 *   ECM_BASE_URL=https://projects.fosasoft.com ECM_EMAIL=... ECM_PASSWORD=... \
 *     node scripts/release-monitor.mjs backfill --project 16
 *
 * Secrets come from the environment only, never argv. Bearer auth, so no CSRF
 * header is needed. No dependencies.
 */
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const DEFAULT_MONITOR_EMAIL = 'jiralitenotifications+release-monitor@gmail.com'
export const DEFAULT_MONITOR_NAME = 'Release Monitor'
export const RELEASE_MONITOR_ROLE = 'Release Monitor'

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

export function makeClient(baseUrl, fetchImpl = fetch) {
  let token = null
  async function call(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    let res
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (err) {
      throw new ApiError(`Could not reach ${baseUrl}: ${err.message}`)
    }
    const text = await res.text()
    let data = null
    if (text) { try { data = JSON.parse(text) } catch { /* not JSON */ } }
    if (!res.ok) throw new ApiError(`${method} ${path} -> ${res.status}: ${data?.error || text.slice(0, 200)}`, res.status)
    return data
  }
  return {
    call,
    async login(email, password, mfaCode) {
      const body = { email, password }
      if (mfaCode) body.mfaCode = mfaCode
      const data = await call('/api/auth/login', { method: 'POST', body })
      if (!data?.token) throw new ApiError('Login returned no token', 401)
      token = data.token
    },
  }
}

export async function provision(client, { projectId, email, name, password }) {
  const project = await client.call(`/api/projects/${projectId}`)
  let member
  try {
    // Workspace Viewer: the project role below is what gives it project access,
    // and it needs no write access anywhere.
    member = await client.call('/api/members', {
      method: 'POST',
      body: { name, email, role: 'Viewer', password, invited_by: 'release-monitor provisioning' },
    })
  } catch (err) {
    if (err.status !== 409) throw err
    throw new ApiError(`${email} already exists. Give it the "${RELEASE_MONITOR_ROLE}" role in Project Settings > Access instead.`, 409)
  }
  await client.call(`/api/projects/${projectId}/members`, { method: 'POST', body: { memberId: member.id, role: RELEASE_MONITOR_ROLE } })
  return { project, member }
}

export async function backfill(client, { projectId, log = console.log }) {
  const releases = (await client.call(`/api/projects/${projectId}/releases`)).filter((r) => r.status === 'released')
  const results = []
  for (const release of releases) {
    if (await client.call(`/api/releases/${release.id}/check`)) { log(`skip  ${release.name}: already checked`); continue }
    const check = await client.call(`/api/releases/${release.id}/check`, { method: 'POST' })
    log(`${check.ok ? 'PASS' : 'FAIL'}  ${release.name}: ${check.passed}/${check.total} Done${check.failed.length ? ` (open: ${check.failed.map((f) => `${f.key} ${f.status}`).join(', ')})` : ''}`)
    results.push(check)
  }
  return results
}

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) { positional.push(a); continue }
    const [k, v] = a.slice(2).split('=', 2)
    if (v !== undefined) flags[k] = v
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]
    else flags[k] = true
  }
  return { command: positional[0], flags }
}

export async function main(argv, env, { fetchImpl, log = console.log, err = console.error } = {}) {
  const { command, flags } = parseArgs(argv)
  const baseUrl = String(env.ECM_BASE_URL || '').replace(/\/+$/, '')
  const projectId = Number(flags.project)
  if (!['provision', 'backfill'].includes(command) || !/^https?:\/\//.test(baseUrl) || !Number.isInteger(projectId)) {
    err('usage: ECM_BASE_URL=https://... node scripts/release-monitor.mjs <provision|backfill> --project <id>')
    return 1
  }
  const client = makeClient(baseUrl, fetchImpl)
  try {
    if (command === 'provision') {
      if (!env.ECM_ADMIN_EMAIL || !env.ECM_ADMIN_PASSWORD) { err('provision needs ECM_ADMIN_EMAIL and ECM_ADMIN_PASSWORD (a workspace Admin)'); return 2 }
      await client.login(env.ECM_ADMIN_EMAIL, env.ECM_ADMIN_PASSWORD, env.ECM_ADMIN_MFA_CODE)
      const email = env.MONITOR_EMAIL || DEFAULT_MONITOR_EMAIL
      const password = randomBytes(18).toString('base64url')
      const { project, member } = await provision(client, { projectId, email, name: env.MONITOR_NAME || DEFAULT_MONITOR_NAME, password })
      log(`Created "${member.name}" <${member.email}> with the "${RELEASE_MONITOR_ROLE}" role on ${project.name || `project ${projectId}`}.`)
      log('Password (shown once; it is only needed to sign in as this account):')
      log(password)
      return 0
    }
    if (!env.ECM_EMAIL || !env.ECM_PASSWORD) { err('backfill needs ECM_EMAIL and ECM_PASSWORD'); return 2 }
    await client.login(env.ECM_EMAIL, env.ECM_PASSWORD, env.ECM_MFA_CODE)
    const results = await backfill(client, { projectId, log })
    if (results.length === 0) log('Nothing to check: every released release has been checked.')
    return results.some((c) => !c.ok) ? 1 : 0
  } catch (e) {
    err(`error: ${e.message}`)
    return e.status === 401 || e.status === 403 ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Set the exit code and let Node exit on its own: process.exit() while a
  // fetch socket is still closing aborts Node on Windows ("Assertion failed:
  // !(handle->flags & UV_HANDLE_CLOSING)"), turning exit 2 into a crash code.
  main(process.argv.slice(2), process.env).then(
    (code) => { process.exitCode = code },
    (e) => { console.error(e?.message || e); process.exitCode = 1 },
  )
}
