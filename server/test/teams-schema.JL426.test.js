// JL-426 — teams / team_members / team_links against a real PostgreSQL schema.
//
// The DDL is imported from server/db.js (TEAM_SCHEMA_STATEMENTS), not restated
// here: a copy in the test would drift from the copy that ships, and then the
// cascades this file asserts would be the test's cascades rather than the
// product's. server/test/setup.js builds its own minimal schema and has no
// `workspaces` table, so this suite creates the one table the FK needs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, initTestSchema, cleanTestDb } from './setup.js'
import { TEAM_SCHEMA_STATEMENTS } from '../db.js'

describe('JL-426 — teams schema', () => {
  let db

  beforeEach(async () => {
    db = createTestDb()
    await cleanTestDb(db)
    await initTestSchema(db)
    await db.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        owner_email TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    for (const statement of TEAM_SCHEMA_STATEMENTS) {
      await db.run(statement)
    }
  })

  afterEach(async () => {
    await cleanTestDb(db)
    await db.close()
  })

  async function seed() {
    const ws = await db.get("INSERT INTO workspaces (name, slug) VALUES ('WS A', 'ws-a') RETURNING id")
    const member = await db.get(
      "INSERT INTO members (name, email, role, status) VALUES ('Ada', 'ada@test.com', 'Member', 'Active') RETURNING id",
    )
    const team = await db.get(
      `INSERT INTO teams (workspace_id, name, description, membership, created_by)
       VALUES ($1, 'Platform', 'd', 'OPEN', 'ada@test.com') RETURNING id`,
      [ws.id],
    )
    await db.run(
      "INSERT INTO team_members (team_id, member_id, role) VALUES ($1, $2, 'Lead')",
      [team.id, member.id],
    )
    await db.run(
      "INSERT INTO team_links (team_id, label, url) VALUES ($1, 'Docs', 'https://example.com')",
      [team.id],
    )
    return { workspaceId: ws.id, memberId: member.id, teamId: team.id }
  }

  it('creates all three tables', async () => {
    for (const table of ['teams', 'team_members', 'team_links']) {
      const row = await db.get(
        'SELECT to_regclass(current_schema() || $1) AS reg', [`.${table}`],
      )
      expect(row.reg, `${table} missing`).not.toBeNull()
    }
  })

  it('is idempotent — re-running the statements on an existing database is a no-op', async () => {
    const { teamId } = await seed()
    for (const statement of TEAM_SCHEMA_STATEMENTS) {
      await db.run(statement)
    }
    const team = await db.get('SELECT id FROM teams WHERE id = $1', [teamId])
    expect(team.id).toBe(teamId)
  })

  it('defaults membership to OPEN and role to Member', async () => {
    const ws = await db.get("INSERT INTO workspaces (name, slug) VALUES ('W', 'w') RETURNING id")
    const team = await db.get(
      "INSERT INTO teams (workspace_id, name, created_by) VALUES ($1, 'T', 'a@b.c') RETURNING id, membership",
      [ws.id],
    )
    expect(team.membership).toBe('OPEN')
    const m = await db.get(
      "INSERT INTO members (name, email, role, status) VALUES ('B', 'b@t.c', 'Member', 'Active') RETURNING id",
    )
    const tm = await db.get(
      'INSERT INTO team_members (team_id, member_id) VALUES ($1, $2) RETURNING role',
      [team.id, m.id],
    )
    expect(tm.role).toBe('Member')
  })

  it('deleting a team cascades to its members and links (AC#5)', async () => {
    const { teamId } = await seed()
    await db.run('DELETE FROM teams WHERE id = $1', [teamId])
    expect(await db.all('SELECT * FROM team_members WHERE team_id = $1', [teamId])).toHaveLength(0)
    expect(await db.all('SELECT * FROM team_links WHERE team_id = $1', [teamId])).toHaveLength(0)
  })

  it('deleting a member removes their team memberships but leaves the team (AC#5)', async () => {
    const { teamId, memberId } = await seed()
    await db.run('DELETE FROM members WHERE id = $1', [memberId])
    expect(await db.all('SELECT * FROM team_members WHERE member_id = $1', [memberId])).toHaveLength(0)
    expect(await db.get('SELECT id FROM teams WHERE id = $1', [teamId])).not.toBeNull()
  })

  it('deleting a workspace removes its teams, and the cascade reaches members and links', async () => {
    const { workspaceId, teamId } = await seed()
    await db.run('DELETE FROM workspaces WHERE id = $1', [workspaceId])
    expect(await db.get('SELECT id FROM teams WHERE id = $1', [teamId])).toBeNull()
    expect(await db.all('SELECT * FROM team_links WHERE team_id = $1', [teamId])).toHaveLength(0)
  })

  it('rejects a second membership row for the same (team, member) — composite PK', async () => {
    const { teamId, memberId } = await seed()
    await expect(
      db.run('INSERT INTO team_members (team_id, member_id) VALUES ($1, $2)', [teamId, memberId]),
    ).rejects.toThrow()
    // ON CONFLICT DO NOTHING is how the route stays idempotent over that PK.
    await db.run(
      'INSERT INTO team_members (team_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [teamId, memberId],
    )
    expect(await db.all('SELECT * FROM team_members WHERE team_id = $1', [teamId])).toHaveLength(1)
  })

  it('requires a workspace — teams are workspace-scoped by construction', async () => {
    await expect(
      db.run("INSERT INTO teams (name, created_by) VALUES ('Orphan', 'a@b.c')"),
    ).rejects.toThrow()
  })

  it('does not touch team_capacity, which is sprint capacity and unrelated', async () => {
    const sql = TEAM_SCHEMA_STATEMENTS.join('\n')
    expect(sql).not.toContain('team_capacity')
  })

  it('indexes the two columns every list query filters on', async () => {
    const sql = TEAM_SCHEMA_STATEMENTS.join('\n')
    expect(sql).toContain('idx_teams_workspace_id ON teams(workspace_id)')
    expect(sql).toContain('idx_team_members_member_id ON team_members(member_id)')
  })
})
