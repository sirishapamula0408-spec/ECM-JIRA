import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, initTestSchema, seedTestMembers } from './setup.js'

describe('Schema: members table', () => {
  let testDb

  beforeEach(async () => {
    testDb = createTestDb()
    await initTestSchema(testDb)
  })

  afterEach(async () => {
    await testDb.close()
  })

  it('should have is_owner column with default 0', async () => {
    await testDb.run(
      "INSERT INTO members (name, email, role, status) VALUES ('Test', 'test@test.com', 'Member', 'Active')",
    )
    const member = await testDb.get('SELECT is_owner FROM members WHERE email = ?', ['test@test.com'])
    expect(member.is_owner).toBe(0)
  })

  it('should allow setting is_owner to 1', async () => {
    await testDb.run(
      "INSERT INTO members (name, email, role, status, is_owner) VALUES ('Owner', 'owner@test.com', 'Admin', 'Active', 1)",
    )
    const member = await testDb.get('SELECT is_owner FROM members WHERE email = ?', ['owner@test.com'])
    expect(member.is_owner).toBe(1)
  })

  it('should have only one owner across workspace', async () => {
    await seedTestMembers(testDb)
    const owners = await testDb.all('SELECT * FROM members WHERE is_owner = 1')
    expect(owners).toHaveLength(1)
    expect(owners[0].email).toBe('owner@test.com')
  })
})

describe('Schema: members email index', () => {
  let testDb

  beforeEach(async () => {
    testDb = createTestDb()
    await initTestSchema(testDb)
  })

  afterEach(async () => {
    await testDb.close()
  })

  it('should have idx_members_email index', async () => {
    const index = await testDb.get(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_members_email'",
    )
    expect(index).toBeDefined()
    expect(index.name).toBe('idx_members_email')
  })

  it('should enable fast lookups by email (case-insensitive)', async () => {
    await seedTestMembers(testDb)
    const member = await testDb.get(
      'SELECT id, role, is_owner FROM members WHERE LOWER(email) = LOWER(?)',
      ['ADMIN@TEST.COM'],
    )
    expect(member).toBeDefined()
    expect(member.role).toBe('Admin')
    expect(member.is_owner).toBe(0)
  })
})

describe('Schema: projects table', () => {
  let testDb

  beforeEach(async () => {
    testDb = createTestDb()
    await initTestSchema(testDb)
  })

  afterEach(async () => {
    await testDb.close()
  })

  it('should have lead_member_id column', async () => {
    const columns = await testDb.all("PRAGMA table_info('projects')")
    const hasLeadMemberId = columns.some((col) => col.name === 'lead_member_id')
    expect(hasLeadMemberId).toBe(true)
  })

  it('should default lead_member_id to null', async () => {
    await testDb.run(
      "INSERT INTO projects (name, key, type, lead) VALUES ('Test', 'TST', 'Scrum', 'John')",
    )
    const project = await testDb.get('SELECT lead_member_id FROM projects WHERE key = ?', ['TST'])
    expect(project.lead_member_id).toBeNull()
  })
})
