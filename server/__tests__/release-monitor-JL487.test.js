// JL-487: release-monitor provisions a monitor account and checks released work items.
import { describe, it, expect } from 'vitest'
import { main, marker } from '../../scripts/release-monitor.mjs'

/** A tiny in-memory stand-in for the API the script talks to. */
function fakeServer() {
  const state = {
    members: [], projectMembers: [],
    releases: [
      { id: 1, name: 'v1.0', status: 'released', releaseDate: '2026-11-20' },
      { id: 2, name: 'v1.1', status: 'unreleased', releaseDate: null },
    ],
    issues: [
      { id: 10, key: 'PRJ-1', status: 'Done', projectId: 16, releaseId: 1, fix: [] },
      { id: 11, key: 'PRJ-2', status: 'In Testing', projectId: 16, releaseId: null, fix: [1] },
      { id: 12, key: 'PRJ-3', status: 'Done', projectId: 16, releaseId: 2, fix: [] },
      { id: 13, key: 'OTH-1', status: 'Done', projectId: 7, releaseId: null, fix: [] },
    ],
    comments: {},
    logins: [],
  }
  const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
  async function fetchImpl(url, { method, headers, body }) {
    const path = new URL(url).pathname
    const data = body ? JSON.parse(body) : null
    if (path === '/api/auth/login') { state.logins.push(data.email); return reply(200, { token: `t-${data.email}` }) }
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
    if ((m = path.match(/^\/api\/releases\/(\d+)\/issues$/))) {
      return reply(200, state.issues.filter((i) => i.releaseId === Number(m[1])).map((i) => ({ id: i.id, issue_key: i.key, status: i.status })))
    }
    if (path === '/api/issues') return reply(200, state.issues.map(({ id, key, status, projectId }) => ({ id, key, status, projectId })))
    if ((m = path.match(/^\/api\/issues\/(\d+)\/comments$/))) {
      const id = Number(m[1])
      state.comments[id] ??= []
      if (method === 'POST') { state.comments[id].push({ text: data.text }); return reply(201, {}) }
      return reply(200, state.comments[id])
    }
    if ((m = path.match(/^\/api\/issues\/(\d+)$/))) {
      const i = state.issues.find((x) => x.id === Number(m[1]))
      return reply(200, { id: i.id, key: i.key, status: i.status, fixVersions: i.fix.map((id) => ({ id })) })
    }
    return reply(404, { error: `no route ${method} ${path}` })
  }
  return { state, fetchImpl }
}

const BASE = { ECM_BASE_URL: 'https://example.test' }
const quiet = () => {}

describe('release-monitor provision', () => {
  it('creates a workspace Member with a generated password and adds it to the project as Member', async () => {
    const { state, fetchImpl } = fakeServer()
    const out = []
    const code = await main(['provision', '--project', '16'], { ...BASE, ECM_ADMIN_EMAIL: 'admin@x.com', ECM_ADMIN_PASSWORD: 'p' }, { fetchImpl, log: (l) => out.push(l), err: quiet })
    expect(code).toBe(0)
    expect(state.members[0]).toMatchObject({ email: 'jiralitenotifications+release-monitor@gmail.com', role: 'Member', name: 'Release Monitor' })
    expect(state.members[0].password.length).toBeGreaterThanOrEqual(20)
    expect(state.projectMembers).toEqual([{ memberId: 99, role: 'Member' }])
    expect(out).toContain(state.members[0].password)
  })

  it('refuses without admin credentials', async () => {
    const { fetchImpl } = fakeServer()
    expect(await main(['provision', '--project', '16'], BASE, { fetchImpl, log: quiet, err: quiet })).toBe(2)
  })
})

describe('release-monitor check', () => {
  const env = { ...BASE, ECM_EMAIL: 'monitor@x.com', ECM_PASSWORD: 'p' }

  it('checks only released releases, covering both the release field and Fix Version, and fails on open items', async () => {
    const { state, fetchImpl } = fakeServer()
    const out = []
    const code = await main(['check', '--project', '16'], env, { fetchImpl, log: (l) => out.push(l), err: quiet })
    expect(code).toBe(1) // PRJ-2 is not Done
    expect(state.comments[10][0].text).toMatch(new RegExp(`^\\${marker(1)} .*PASS`))
    expect(state.comments[11][0].text).toMatch(/FAILED.*In Testing/)
    expect(state.comments[12]).toBeUndefined() // v1.1 is not released
    expect(state.comments[13]).toBeUndefined() // other project
    expect(out.join('\n')).toContain('v1.0: 2 checked now (1 pass, 1 fail), 0 checked earlier')
  })

  it('never comments twice on the same release', async () => {
    const { state, fetchImpl } = fakeServer()
    await main(['check', '--project', '16'], env, { fetchImpl, log: quiet, err: quiet })
    const out = []
    const code = await main(['check', '--project', '16'], env, { fetchImpl, log: (l) => out.push(l), err: quiet })
    expect(code).toBe(0)
    expect(state.comments[10]).toHaveLength(1)
    expect(state.comments[11]).toHaveLength(1)
    expect(out.join('\n')).toContain('0 checked now (0 pass, 0 fail), 2 checked earlier')
  })

  it('--dry-run reports without commenting', async () => {
    const { state, fetchImpl } = fakeServer()
    const code = await main(['check', '--project', '16', '--dry-run'], env, { fetchImpl, log: quiet, err: quiet })
    expect(code).toBe(1)
    expect(Object.values(state.comments).flat()).toHaveLength(0)
  })
})
