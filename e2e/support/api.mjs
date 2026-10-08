// JL-157 — API helpers shared by every spec.
import { request as pwRequest } from '@playwright/test'
import { BASE_URL, ACCOUNTS, PASSWORD } from './env.mjs'

let counter = 0
/** A value no other test (or earlier run) has used: `prefix-<time><n>`. */
export function uniq(prefix = 'e2e') {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}${counter}`
}

/** A project key: 8 uppercase letters, random. A timestamp-derived key kept
 *  too few letters and collided across parallel runs (projects reject a
 *  duplicate key), so this draws from 26^7 instead. */
export function uniqKey() {
  let key = 'E'
  for (let i = 0; i < 7; i += 1) key += String.fromCharCode(65 + Math.floor(Math.random() * 26))
  return key
}

export async function login(email, password = PASSWORD) {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const res = await ctx.post('/api/auth/login', { data: { email, password } })
  const body = await res.json().catch(() => ({}))
  await ctx.dispose()
  if (!res.ok()) throw new Error(`login ${email} → ${res.status()} ${body.error || ''}`)
  return body
}

/**
 * An API client signed in as one of the seeded roles ('owner' | 'admin' |
 * 'member' | 'viewer'), or as { email, password }. Dispose it in afterAll.
 */
export async function apiAs(who) {
  const account = typeof who === 'string' ? ACCOUNTS[who] : who
  const { token, user } = await login(account.email, account.password || PASSWORD)
  const ctx = await pwRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  })
  ctx.user = user
  ctx.token = token
  return ctx
}

/** An unauthenticated client. */
export function anonymous() {
  return pwRequest.newContext({ baseURL: BASE_URL })
}

/** Parse a response, failing loudly with its body when the status is wrong. */
export async function expectStatus(res, status) {
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (res.status() !== status) {
    throw new Error(`${res.url()} → expected ${status}, got ${res.status()}: ${text.slice(0, 400)}`)
  }
  return body
}

/** Create a project as `api`, returning the created row. */
export async function createProject(api, overrides = {}) {
  const data = {
    name: uniq('Project'),
    key: uniqKey(),
    type: 'Scrum',
    lead: ACCOUNTS.owner.name,
    ...overrides,
  }
  return expectStatus(await api.post('/api/projects', { data }), 201)
}

/** Add a seeded account to a project with a project role. */
export async function addProjectMember(api, projectId, memberId, role = 'Member') {
  const res = await api.post(`/api/projects/${projectId}/members`, { data: { memberId, role } })
  if (![200, 201].includes(res.status())) {
    throw new Error(`add member → ${res.status()} ${await res.text()}`)
  }
  return res.json()
}

/** Create an issue as `api` in `projectId`. */
export async function createIssue(api, projectId, overrides = {}) {
  const data = {
    title: uniq('Issue'),
    description: 'Created by the functional suite',
    assignee: ACCOUNTS.owner.name,
    priority: 'Medium',
    status: 'To Do',
    issueType: 'Task',
    projectId,
    ...overrides,
  }
  return expectStatus(await api.post('/api/issues', { data }), 201)
}
