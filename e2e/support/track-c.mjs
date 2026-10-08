// JL-157 Track C — helpers private to the tracking / Confluence Lite / route
// smoke specs. Built on the shared helpers in api.mjs; nothing here changes
// workspace-wide settings or the seeded accounts.
import { expect } from '@playwright/test'
import { apiAs, uniq, createProject as sharedCreateProject } from './api.mjs'
import { ACCOUNTS, PASSWORD, BASE_URL } from './env.mjs'

/** The members-table row for an email (needed for project membership). */
export async function memberByEmail(api, email) {
  const rows = await expectStatus(await api.get('/api/members'), 200)
  const list = Array.isArray(rows) ? rows : (rows.members || [])
  const row = list.find((m) => String(m.email).toLowerCase() === email.toLowerCase())
  if (!row) throw new Error(`no member row for ${email}`)
  return row
}

/**
 * A brand-new workspace Member that only this test uses — so notification
 * counts, "mark all read" and preference changes never touch a seeded account
 * another agent may be asserting on. Returns { api, email, name, id }.
 */
export async function freshUser(ownerApi, role = 'Member') {
  const tag = uniq('c').replace(/[^a-z0-9]/gi, '').toLowerCase()
  const email = `trackc-${tag}@e2e.example.com`
  const name = `TrackC ${tag}`
  const created = await expectStatus(
    await ownerApi.post('/api/members', { data: { name, email, role, password: PASSWORD } }),
    201,
  )
  const api = await apiAs({ email, password: PASSWORD })
  const session = { token: api.token, user: api.user }
  return { api, email, name, id: created.id ?? created.member?.id, session }
}

/** A project owned by `api` with one issue per given status. */
export async function projectWithIssues(api, statuses = ['To Do']) {
  const project = await createProject(api)
  const issues = []
  for (const status of statuses) {
    issues.push(await createIssue(api, project.id, { status }))
  }
  return { project, issues }
}

/**
 * A Space key that cannot collide across worker restarts: api.mjs's uniqKey()
 * is time-derived with a per-process counter, and keys as short as 5 letters
 * were seen repeating between two runs. Space keys allow 10 characters.
 */
export function spaceKey() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = 'C'
  for (let i = 0; i < 9; i += 1) key += letters[Math.floor(Math.random() * 26)]
  return key
}

/** createProject with a collision-free key (see spaceKey). */
export function createProject(api, overrides = {}) {
  return sharedCreateProject(api, { key: spaceKey(), ...overrides })
}

/** A Space. Names start with "Zz" so they sort after the UI tests' spaces. */
export async function createSpace(api, overrides = {}) {
  const key = spaceKey()
  const data = { key, name: `Zz Space ${key}`, description: 'Track C space', ...overrides }
  return expectStatus(await api.post('/api/spaces', { data }), 201)
}

export async function createPage(api, spaceId, overrides = {}) {
  const data = { spaceId, title: uniq('Page'), content: 'Initial body line', ...overrides }
  return expectStatus(await api.post('/api/wiki', { data }), 201)
}

/** Multipart document upload into a Space; returns the raw response. */
export function uploadDocument(api, spaceKeyOrId, { name, body, mimeType = 'text/plain', fields = {} }) {
  return api.post(`/api/spaces/${spaceKeyOrId}/documents`, {
    multipart: {
      file: { name, mimeType, buffer: Buffer.isBuffer(body) ? body : Buffer.from(body) },
      ...fields,
    },
  })
}

/**
 * Same contract as api.mjs's expectStatus, but its failure path works: the
 * shared helper calls res.request(), which APIResponse does not have, so a
 * wrong status surfaces as "res.request is not a function" and hides the body.
 */
export async function expectStatus(res, status) {
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (res.status() !== status) {
    throw new Error(`${res.url()} -> expected ${status}, got ${res.status()}: ${text.slice(0, 400)}`)
  }
  return body
}

/** createIssue from api.mjs, but with a readable failure (see expectStatus). */
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

/** A Playwright storageState object for an arbitrary signed-in user. */
export function storageStateFor(session) {
  return {
    cookies: [],
    origins: [{
      origin: BASE_URL,
      localStorage: [
        { name: 'jira_auth_token', value: session.token },
        { name: 'jira_auth_remember', value: '1' },
        { name: 'jira_auth_user', value: JSON.stringify(session.user) },
      ],
    }],
  }
}

export const OWNER = ACCOUNTS.owner
export const MEMBER = ACCOUNTS.member

/** Attach page-error / console-error / 5xx collectors to a page. */
export function watchPage(page) {
  const problems = { pageErrors: [], consoleErrors: [], serverErrors: [] }
  page.on('pageerror', (err) => problems.pageErrors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.consoleErrors.push(msg.text())
  })
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 500) {
      problems.serverErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`)
    }
  })
  return problems
}

export function expectClean(problems) {
  expect.soft(problems.pageErrors, 'uncaught page errors').toEqual([])
  expect.soft(problems.consoleErrors, 'console errors').toEqual([])
  expect(problems.serverErrors, 'API responses >= 500').toEqual([])
}
