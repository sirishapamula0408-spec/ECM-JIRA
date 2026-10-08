// JL-157 Track B — helpers for the projects / issues / planning / execution specs.
// Built on the shared helpers in api.mjs; nothing here changes shared state
// beyond the uniquely named projects, issues and sprints a test creates.
import { expect } from '@playwright/test'
import { expectStatus, uniq, createIssue } from './api.mjs'
import { ACCOUNTS } from './env.mjs'

export { createIssue }

/**
 * A project key with real entropy: 'B' + 7 random letters. The shared
 * uniqKey() keeps only the letters of a base-36 timestamp, which collides when
 * several suites create projects in the same instant — and a duplicate key is
 * a 500 in this app (see the duplicate-key defect test).
 */
export function randomKey() {
  let s = 'B'
  for (let i = 0; i < 7; i += 1) s += String.fromCharCode(65 + Math.floor(Math.random() * 26))
  return s
}

/** Create a project as `api` with a collision-proof key. */
export async function createProject(api, overrides = {}) {
  const data = { name: uniq('Project'), key: randomKey(), type: 'Scrum', lead: ACCOUNTS.owner.name, ...overrides }
  return expectStatus(await api.post('/api/projects', { data }), 201)
}

/** The caller's members.id (needed for project-membership endpoints). */
export async function memberIdOf(api) {
  if (api.memberId) return api.memberId
  const me = await expectStatus(await api.get('/api/auth/me'), 200)
  api.memberId = me.memberId
  return me.memberId
}

/** Add `who` (an apiAs() client) to a project with a project role. */
export async function addToProject(adminApi, projectId, who, role = 'Member') {
  const memberId = await memberIdOf(who)
  const res = await adminApi.post(`/api/projects/${projectId}/members`, { data: { memberId, role } })
  expect([200, 201]).toContain(res.status())
  return res.json()
}

/** Create a sprint (workspace Admin only). */
export async function createSprint(api, overrides = {}) {
  return expectStatus(await api.post('/api/sprints', { data: { name: uniq('Sprint'), ...overrides } }), 201)
}

/** Opt a project into parallel sprints so starting one never collides with
 *  sprints other suites have running (sprints are workspace-global). */
export async function allowParallel(api, projectId, allow = true) {
  return expectStatus(await api.put(`/api/projects/${projectId}/sprints/settings`, { data: { allowParallelSprints: allow } }), 200)
}

export async function startSprint(api, sprintId, projectId) {
  return api.patch(`/api/sprints/${sprintId}/start`, { data: projectId != null ? { projectId } : {} })
}

/** Best-effort teardown: complete and delete a sprint so it never stays active
 *  and blocks another suite's sprint start. */
export async function retireSprint(api, sprintId) {
  if (!sprintId) return
  await api.patch(`/api/sprints/${sprintId}/complete`).catch(() => {})
  await api.delete(`/api/sprints/${sprintId}`).catch(() => {})
}

/** Walk an issue through the default QA-lifecycle workflow to `target`. */
const QA_PATH = ['To Do', 'In Progress', 'In Testing', 'In UAT', 'Done']
export async function walkTo(api, issueId, from, target) {
  let i = QA_PATH.indexOf(from)
  const end = QA_PATH.indexOf(target)
  while (i < end) {
    i += 1
    await expectStatus(await api.patch(`/api/issues/${issueId}/status`, { data: { status: QA_PATH[i] } }), 200)
  }
}

export function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64')
}
