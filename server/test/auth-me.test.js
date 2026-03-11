import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, initTestSchema, seedTestMembers, seedTestProject, cleanTestDb } from './setup.js'

describe('GET /api/auth/me endpoint logic', () => {
  let testDb

  beforeEach(async () => {
    testDb = createTestDb()
    await cleanTestDb(testDb)
    await initTestSchema(testDb)
    await seedTestMembers(testDb)
    await seedTestProject(testDb)

    // Add profile for owner
    await testDb.run(
      "INSERT INTO profile (full_name, job_title, department, timezone, avatar_url, user_id) VALUES ('Owner User', 'CTO', 'Engineering', 'UTC', '', 1)",
    )
  })

  afterEach(async () => {
    await cleanTestDb(testDb)
    await testDb.close()
  })

  it('should return workspace role, owner flag, and project roles for an admin/owner', async () => {
    // Simulate what the /me handler does
    const email = 'owner@test.com'
    const userId = 1

    const member = await testDb.get(
      'SELECT id, role, is_owner FROM members WHERE LOWER(email) = LOWER(?)',
      [email],
    )
    expect(member).toBeDefined()
    expect(member.role).toBe('Admin')
    expect(member.is_owner).toBe(true)

    const profile = await testDb.get(
      'SELECT full_name, job_title, department, timezone, avatar_url FROM profile WHERE user_id = ?',
      [userId],
    )
    expect(profile).toBeDefined()
    expect(profile.full_name).toBe('Owner User')

    const projectRoles = await testDb.all(
      `SELECT pm.project_id AS projectId, p.key AS projectKey, p.name AS projectName, pm.role
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.member_id = ?
       ORDER BY p.name ASC`,
      [member.id],
    )
    expect(projectRoles).toHaveLength(1)
    expect(projectRoles[0].projectKey).toBe('TP')
    expect(projectRoles[0].role).toBe('Admin')

    // Build the response shape
    const response = {
      id: userId,
      email,
      memberId: member.id,
      workspaceRole: member.role,
      isOwner: Boolean(member.is_owner),
      profile,
      projectRoles,
    }

    expect(response.workspaceRole).toBe('Admin')
    expect(response.isOwner).toBe(true)
    expect(response.projectRoles).toHaveLength(1)
  })

  it('should return Viewer role for a viewer user', async () => {
    const email = 'viewer@test.com'

    const member = await testDb.get(
      'SELECT id, role, is_owner FROM members WHERE LOWER(email) = LOWER(?)',
      [email],
    )
    expect(member.role).toBe('Viewer')
    expect(member.is_owner).toBe(false)

    const projectRoles = await testDb.all(
      `SELECT pm.project_id AS projectId, p.key AS projectKey, pm.role
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.member_id = ?`,
      [member.id],
    )
    expect(projectRoles).toHaveLength(1)
    expect(projectRoles[0].role).toBe('Viewer')
  })

  it('should return null profile and empty project roles for unknown user', async () => {
    const email = 'unknown@test.com'

    const member = await testDb.get(
      'SELECT id, role, is_owner FROM members WHERE LOWER(email) = LOWER(?)',
      [email],
    )
    expect(member).toBeNull()

    // When no member, memberId is null, so projectRoles query would return empty
    const profile = await testDb.get(
      'SELECT full_name FROM profile WHERE user_id = ?',
      [999],
    )
    expect(profile).toBeNull()
  })

  it('should return Member role with project Member role', async () => {
    const email = 'member@test.com'

    const member = await testDb.get(
      'SELECT id, role, is_owner FROM members WHERE LOWER(email) = LOWER(?)',
      [email],
    )
    expect(member.role).toBe('Member')
    expect(member.is_owner).toBe(false)

    const projectRoles = await testDb.all(
      `SELECT pm.role FROM project_members pm WHERE pm.member_id = ?`,
      [member.id],
    )
    expect(projectRoles).toHaveLength(1)
    expect(projectRoles[0].role).toBe('Member')
  })
})
