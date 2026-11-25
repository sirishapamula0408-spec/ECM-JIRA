// JL-489: the Release status — who may leave it, Done only through it in a
// monitored project, and the project getting the status when a monitor is added.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ monitored: false, releases: [], statuses: [], transitions: [], runs: [], history: null }))

vi.mock('../db.js', () => ({
  get: vi.fn(async (sql) => {
    if (sql.includes('FROM project_members pm')) return state.monitored ? { 1: 1 } : undefined
    if (sql.includes('FROM issue_history')) return state.history
    return undefined
  }),
  all: vi.fn(async (sql) => {
    if (sql.includes('FROM releases r')) return state.releases
    if (sql.includes('FROM issue_statuses WHERE project_id = ?')) return state.statuses
    if (sql.includes('FROM issue_statuses WHERE project_id IS NULL')) return [{ name: 'To Do', position: 0, color: '#fff', category: 'todo' }, { name: 'Done', position: 1, color: '#fff', category: 'done' }]
    if (sql.includes('FROM workflow_transitions')) return state.transitions
    return []
  }),
  run: vi.fn(async (sql, params) => {
    state.runs.push({ sql, params })
    if (sql.startsWith('INSERT INTO issue_statuses')) state.statuses.push({ name: params[1] ?? params[0], position: params[2] ?? 0 })
    return { lastID: 1, changes: 1 }
  }),
  withTransaction: vi.fn(),
}))
vi.mock('../routes/notifications.js', () => ({ createNotification: vi.fn() }))

const { releaseGate, canVerifyRelease, ensureReleaseStatus, previousStatusBeforeRelease, RELEASE_STATUS } = await import('../services/releaseVerification.js')
const { ROLE_RANK } = await import('../middleware/authorize.js')

const item = (status) => ({ id: 7, status, project_id: 16 })
const access = (projectRole, effectiveRank, admin = false) => async () => ({ admin, projectRole, effectiveRank })
const user = { id: 1, email: 'u@x.com' }

beforeEach(() => {
  Object.assign(state, { monitored: false, releases: [], statuses: [], transitions: [], runs: [], history: null })
})

describe('releaseGate — into Release', () => {
  it('needs a Fix Version (or Release)', async () => {
    expect(await releaseGate(item('In UAT'), RELEASE_STATUS, { user }, access('Member', 2))).toMatchObject({ httpStatus: 400 })
    state.releases = [{ id: 3, name: 'v1', status: 'unreleased' }]
    expect(await releaseGate(item('In UAT'), RELEASE_STATUS, { user }, access('Member', 2))).toBeNull()
  })
})

describe('releaseGate — Done in a monitored project', () => {
  it('refuses Done from anything but Release', async () => {
    state.monitored = true
    const r = await releaseGate(item('In UAT'), 'Done', { user }, access('Lead', ROLE_RANK.Lead))
    expect(r).toMatchObject({ httpStatus: 409 })
    expect(r.error).toMatch(/move the work item to Release/)
  })

  it('leaves unmonitored projects alone', async () => {
    expect(await releaseGate(item('In UAT'), 'Done', { user }, access('Member', 2))).toBeNull()
  })
})

describe('releaseGate — out of Release', () => {
  it('refuses a project Member', async () => {
    const r = await releaseGate(item(RELEASE_STATUS), 'In Progress', { user }, access('Member', ROLE_RANK.Member))
    expect(r).toMatchObject({ httpStatus: 403 })
  })

  it('refuses the Release Monitor on the generic path (they use the verdict)', async () => {
    const r = await releaseGate(item(RELEASE_STATUS), 'Done', { user }, access('Release Monitor', ROLE_RANK.Viewer))
    expect(r).toMatchObject({ httpStatus: 403 })
  })

  it('lets a project Lead/Admin through, but Done only once the release is Released', async () => {
    state.releases = [{ id: 3, name: 'v1', status: 'unreleased' }]
    expect(await releaseGate(item(RELEASE_STATUS), 'Done', { user }, access('Lead', ROLE_RANK.Lead))).toMatchObject({ httpStatus: 409 })
    state.releases = [{ id: 3, name: 'v1', status: 'released' }]
    expect(await releaseGate(item(RELEASE_STATUS), 'Done', { user }, access('Lead', ROLE_RANK.Lead))).toBeNull()
  })

  it('a verdict skips the workflow (back to the previous status has no edge)', async () => {
    expect(await releaseGate(item(RELEASE_STATUS), 'In UAT', { user, releaseVerdict: true }, access('Release Monitor', 1))).toEqual({ skipWorkflow: true })
  })
})

describe('canVerifyRelease', () => {
  it('is the Release Monitor, project Lead/Admin and workspace Admin, never a Member', () => {
    expect(canVerifyRelease({ projectRole: 'Release Monitor', effectiveRank: 1 })).toBe(true)
    expect(canVerifyRelease({ projectRole: 'Lead', effectiveRank: ROLE_RANK.Lead })).toBe(true)
    expect(canVerifyRelease({ projectRole: 'Admin', effectiveRank: ROLE_RANK.Admin })).toBe(true)
    expect(canVerifyRelease({ admin: true, effectiveRank: ROLE_RANK.Admin })).toBe(true)
    expect(canVerifyRelease({ projectRole: 'Member', effectiveRank: ROLE_RANK.Member })).toBe(false)
    expect(canVerifyRelease({ projectRole: 'Viewer', effectiveRank: ROLE_RANK.Viewer })).toBe(false)
  })
})

describe('previousStatusBeforeRelease', () => {
  it('reads the status before Release from history, else In Progress', async () => {
    state.history = { old_value: 'In UAT' }
    expect(await previousStatusBeforeRelease(7)).toBe('In UAT')
    state.history = undefined
    expect(await previousStatusBeforeRelease(7)).toBe('In Progress')
  })
})

describe('ensureReleaseStatus', () => {
  it('adds Release before Done and an X -> Release twin for every X -> Done', async () => {
    state.statuses = [{ id: 1, name: 'In UAT', position: 5 }, { id: 2, name: 'Done', position: 6 }]
    state.transitions = [{ from_status: 'In UAT', to_status: 'Done' }, { from_status: 'In Testing', to_status: 'In UAT' }]
    expect(await ensureReleaseStatus(16)).toBe(true)
    const sqls = state.runs.map((r) => r.sql)
    expect(sqls.some((s) => s.startsWith('UPDATE issue_statuses SET position = position + 1'))).toBe(true)
    const statusInsert = state.runs.find((r) => r.sql.startsWith('INSERT INTO issue_statuses'))
    expect(statusInsert.params).toEqual([16, 'Release', 6, '#E6FCFF'])
    const edges = state.runs.filter((r) => r.sql.startsWith('INSERT INTO workflow_transitions')).map((r) => r.params.slice(1))
    expect(edges).toEqual([['In UAT', 'Release'], ['Release', 'Done']])
  })

  it('is idempotent', async () => {
    state.statuses = [{ id: 1, name: 'Release', position: 5 }, { id: 2, name: 'Done', position: 6 }]
    state.transitions = [{ from_status: 'In UAT', to_status: 'Done' }, { from_status: 'In UAT', to_status: 'Release' }, { from_status: 'Release', to_status: 'Done' }]
    expect(await ensureReleaseStatus(16)).toBe(false)
    expect(state.runs).toHaveLength(0)
  })
})
