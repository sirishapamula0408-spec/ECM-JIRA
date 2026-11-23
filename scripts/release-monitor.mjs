#!/usr/bin/env node
/*
 * release-monitor — a dedicated account that checks a release's work items
 * once the release is marked Released (JL-487).
 *
 *   provision   As a workspace Admin, create the "Release Monitor" account and
 *               add it to the project as a project Member. Prints its password
 *               once; store it in the scheduler's environment, not in git.
 *
 *   check       As the monitor account, find every release in the project whose
 *               status is "released", collect its work items (Fix Version, or
 *               the older single release field), and check each one:
 *                 Done        -> pass
 *                 anything    -> fail (shipped while still open)
 *               Each work item gets ONE comment per release, tagged
 *               [release-check:R<id>], so re-running never comments twice and a
 *               release is "checked" exactly when all its items carry the tag.
 *               Exit code 1 when any item failed, so a scheduler can alert.
 *
 * Usage:
 *   ECM_BASE_URL=https://projects.fosasoft.com \
 *   ECM_ADMIN_EMAIL=... ECM_ADMIN_PASSWORD=... \
 *     node scripts/release-monitor.mjs provision --project 16
 *
 *   ECM_BASE_URL=https://projects.fosasoft.com \
 *   ECM_EMAIL=<monitor email> ECM_PASSWORD=<monitor password> \
 *     node scripts/release-monitor.mjs check --project 16 [--release <id|name>] [--dry-run]
 *
 * Secrets come from the environment only, never argv (visible in the process
 * list). Bearer auth: no cookie, so no CSRF header is needed. No dependencies.
 */
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const DEFAULT_MONITOR_EMAIL = 'jiralitenotifications+release-monitor@gmail.com'
export const DEFAULT_MONITOR_NAME = 'Release Monitor'
export const marker = (releaseId) => `[release-check:R${releaseId}]`

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
      return data
    },
  }
}

// ── provision ───────────────────────────────────────────────────────────────

export async function provision(client, { projectId, email, name, password }) {
  const project = await client.call(`/api/projects/${projectId}`)
  let member
  try {
    member = await client.call('/api/members', {
      method: 'POST',
      // Workspace Member: a Viewer cannot write, and the check posts comments.
      body: { name, email, role: 'Member', password, invited_by: 'release-monitor provisioning' },
    })
  } catch (err) {
    if (err.status !== 409) throw err
    throw new ApiError(`${email} already exists. Reset its password from /users instead of provisioning again.`, 409)
  }
  // Project Member (not Admin): it comments on work items and changes nothing else.
  await client.call(`/api/projects/${projectId}/members`, { method: 'POST', body: { memberId: member.id, role: 'Member' } })
  return { project, member }
}

// ── check ───────────────────────────────────────────────────────────────────

const issueKey = (i) => i.key || i.issue_key
const projectOf = (i) => Number(i.projectId ?? i.project_id)

/** Work items in a release: the legacy single release field plus Fix Version. */
export async function releaseIssues(client, release, projectIssues) {
  const byId = new Map()
  for (const i of await client.call(`/api/releases/${release.id}/issues`)) byId.set(i.id, i)
  for (const i of projectIssues) {
    if (byId.has(i.id)) continue
    const detail = await client.call(`/api/issues/${i.id}`)
    if ((detail.fixVersions || []).some((v) => v.id === release.id)) byId.set(i.id, detail)
  }
  return [...byId.values()]
}

export function verdict(issue) {
  return issue.status === 'Done'
    ? { pass: true, note: 'Done' }
    : { pass: false, note: `still "${issue.status}" although the release has shipped` }
}

export function commentText(release, issue, v) {
  const when = release.releaseDate ? ` (${String(release.releaseDate).slice(0, 10)})` : ''
  return v.pass
    ? `${marker(release.id)} Release check: shipped in ${release.name}${when}. Status is Done. PASS.`
    : `${marker(release.id)} Release check: FAILED. ${release.name}${when} is released, but this work item is ${v.note}. Please close it or move it to a later release.`
}

export async function check(client, { projectId, release: only, dryRun = false, log = console.log }) {
  const releases = (await client.call(`/api/projects/${projectId}/releases`))
    .filter((r) => (only ? String(r.id) === String(only) || r.name === only : r.status === 'released'))
  if (only && releases.length === 0) throw new ApiError(`No release "${only}" in project ${projectId}`)

  const summary = []
  let projectIssues = null
  for (const release of releases) {
    if (release.status !== 'released') { log(`skip  ${release.name}: not released yet`); continue }
    projectIssues ??= (await client.call('/api/issues')).filter((i) => projectOf(i) === Number(projectId))
    const items = await releaseIssues(client, release, projectIssues)
    const result = { release: release.name, checked: 0, alreadyChecked: 0, passed: 0, failed: [] }
    for (const issue of items) {
      const comments = await client.call(`/api/issues/${issue.id}/comments`)
      if (comments.some((c) => String(c.text || '').includes(marker(release.id)))) { result.alreadyChecked += 1; continue }
      const v = verdict(issue)
      result.checked += 1
      if (v.pass) result.passed += 1
      else result.failed.push(`${issueKey(issue)} ${v.note}`)
      log(`${v.pass ? 'PASS' : 'FAIL'}  ${release.name}  ${issueKey(issue)}  ${v.note}`)
      if (!dryRun) {
        await client.call(`/api/issues/${issue.id}/comments`, { method: 'POST', body: { text: commentText(release, issue, v) } })
      }
    }
    if (items.length === 0) log(`warn  ${release.name}: released with no work items`)
    summary.push(result)
  }
  return summary
}

// ── CLI ─────────────────────────────────────────────────────────────────────

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
  if (!['provision', 'check'].includes(command) || !/^https?:\/\//.test(baseUrl) || !Number.isInteger(projectId)) {
    err('usage: ECM_BASE_URL=https://... node scripts/release-monitor.mjs <provision|check> --project <id> [--release <id|name>] [--dry-run]')
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
      log(`Created "${member.name}" <${member.email}> (workspace Member, project Member of ${project.name || projectId}).`)
      log('Password (shown once; store it as ECM_PASSWORD wherever the check runs):')
      log(password)
      return 0
    }
    if (!env.ECM_EMAIL || !env.ECM_PASSWORD) { err('check needs ECM_EMAIL and ECM_PASSWORD (the monitor account)'); return 2 }
    await client.login(env.ECM_EMAIL, env.ECM_PASSWORD, env.ECM_MFA_CODE)
    const summary = await check(client, { projectId, release: flags.release, dryRun: Boolean(flags['dry-run']), log })
    if (summary.length === 0) log('No released releases to check.')
    for (const s of summary) {
      log(`${s.release}: ${s.checked} checked now (${s.passed} pass, ${s.failed.length} fail), ${s.alreadyChecked} checked earlier`)
    }
    return summary.some((s) => s.failed.length) ? 1 : 0
  } catch (e) {
    err(`error: ${e.message}`)
    return e.status === 401 || e.status === 403 ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code))
}
