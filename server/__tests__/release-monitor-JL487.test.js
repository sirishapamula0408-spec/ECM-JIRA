// JL-487 / JL-488: release-monitor provisions the monitor account and backfills
// checks for releases shipped before the server ran them itself.
import { describe, it, expect } from 'vitest'
import { main } from '../../scripts/release-monitor.mjs'

function fakeServer() {
  const state = {
    members: [], projectMembers: [], checkRuns: [],
    releases: [
      { id: 1, name: 'v1.0', status: 'released' },
      { id: 2, name: 'v1.1', status: 'released' },
      { id: 3, name: 'v1.2', status: 'unreleased' },
    ],
    checks: { 2: { ok: true, passed: 1, total: 1, failed: [] } },
  }
  const reply = (status, body) => ({ ok: status < 400, status, text: async () => (body === null ? 'null' : JSON.stringify(body)) })
  async function fetchImpl(url, { method, headers, body }) {
    const path = new URL(url).pathname
    const data = body ? JSON.parse(body) : null
    if (path === '/api/auth/login') return reply(200, { token: `t-${data.email}` })
    if (!headers.Authorization) return reply(401, { error: 'no session' })
    let m
    if (path === '/api/projects/16' && method === 'GET') return reply(200, { id: 16, name: 'Sixteen' })
    if (path === '/api/members' && method === 'POST') {
      if (state.members.some((x) => x.email === data.email)) return reply(409, { error: 'exists' })
      const row = { id: 99, ...data }
      state.members.push(row)
      return reply(201, row)
    }
    if (path === '/api/projects/16/members' && method === 'POST') { state.projectMembers.push(data); return reply(201, data) }
    if (path === '/api/projects/16/releases') return reply(200, state.releases)
    if ((m = path.match(/^\/api\/releases\/(\d+)\/check$/))) {
      const id = Number(m[1])
      if (method === 'GET') return reply(200, state.checks[id] || null)
      state.checkRuns.push(id)
      state.checks[id] = { ok: false, passed: 1, total: 2, failed: [{ key: 'SIX-2', status: 'In Testing' }] }
      return reply(200, state.checks[id])
    }
    return reply(404, { error: `no route ${method} ${path}` })
  }
  return { state, fetchImpl }
}

const BASE = { ECM_BASE_URL: 'https://example.test' }
const quiet = () => {}

describe('release-monitor provision', () => {
  it('creates a workspace Viewer with a generated password and gives it the Release Monitor project role', async () => {
    const { state, fetchImpl } = fakeServer()
    const out = []
    const code = await main(['provision', '--project', '16'], { ...BASE, ECM_ADMIN_EMAIL: 'admin@x.com', ECM_ADMIN_PASSWORD: 'p' }, { fetchImpl, log: (l) => out.push(l), err: quiet })
    expect(code).toBe(0)
    expect(state.members[0]).toMatchObject({ email: 'jiralitenotifications+release-monitor@gmail.com', role: 'Viewer', name: 'Release Monitor' })
    expect(state.members[0].password.length).toBeGreaterThanOrEqual(20)
    expect(state.projectMembers).toEqual([{ memberId: 99, role: 'Release Monitor' }])
    expect(out).toContain(state.members[0].password)
  })

  it('refuses without admin credentials', async () => {
    const { fetchImpl } = fakeServer()
    expect(await main(['provision', '--project', '16'], BASE, { fetchImpl, log: quiet, err: quiet })).toBe(2)
  })
})

describe('release-monitor backfill', () => {
  const env = { ...BASE, ECM_EMAIL: 'monitor@x.com', ECM_PASSWORD: 'p' }

  it('checks only released releases that were never checked, and fails when a check fails', async () => {
    const { state, fetchImpl } = fakeServer()
    const out = []
    expect(await main(['backfill', '--project', '16'], env, { fetchImpl, log: (l) => out.push(l), err: quiet })).toBe(1)
    expect(state.checkRuns).toEqual([1])
    expect(out.join('\n')).toMatch(/FAIL {2}v1\.0: 1\/2 Done \(open: SIX-2 In Testing\)/)
  })

  it('does nothing on a second run', async () => {
    const { state, fetchImpl } = fakeServer()
    await main(['backfill', '--project', '16'], env, { fetchImpl, log: quiet, err: quiet })
    expect(await main(['backfill', '--project', '16'], env, { fetchImpl, log: quiet, err: quiet })).toBe(0)
    expect(state.checkRuns).toEqual([1])
  })
})
