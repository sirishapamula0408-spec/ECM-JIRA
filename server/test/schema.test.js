import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, initTestSchema, seedTestMembers, cleanTestDb } from './setup.js'

describe('Schema: members table', () => {
  let testDb

  beforeEach(async () => {
    testDb = createTestDb()
    await cleanTestDb(testDb)
    await initTestSchema(testDb)
  })

  afterEach(async () => {
    await cleanTestDb(testDb)
    await testDb.close()
  })

  it('should have is_owner column with default FALSE', async () => {
    await testDb.run(
      "INSERT INTO members (name, email, role, status) VALUES ('Test', 'test@test.com', 'Member', 'Active')",
    )
    const member = await testDb.get("SELECT is_owner FROM members WHERE email = 'test@test.com'")
    expect(member.is_owner).toBe(false)
  })

  it('should allow setting is_owner to TRUE', async () => {
    await testDb.run(
      "INSERT INTO members (name, email, role, status, is_owner) VALUES ('Owner', 'owner2@test.com', 'Admin', 'Active', TRUE)",
    )
    const member = await testDb.get("SELECT is_owner FROM members WHERE email = 'owner2@test.com'")
    expect(member.is_owner).toBe(true)
  })

  it('should have only one owner across workspace', async () => {
    await seedTestMembers(testDb)
    const owners = await testDb.all('SELECT * FROM members WHERE is_owner = TRUE')
    expect(owners).toHaveLength(1)
    expect(owners[0].email).toBe('owner@test.com')
  })
})

describe('Schema: members email index', () => {
  let testDb

  beforeEach(async () => {
    testDb = createTestDb()
    await cleanTestDb(testDb)
    await initTestSchema(testDb)
  })

  afterEach(async () => {
    await cleanTestDb(testDb)
    await testDb.close()
  })

  it('should have idx_members_email index', async () => {
    const index = await testDb.get(
      "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'members' AND indexname = 'idx_members_email'",
      [testDb.schemaName],
    )
    expect(index).toBeDefined()
    expect(index.indexname).toBe('idx_members_email')
  })

  it('should enable fast lookups by email (case-insensitive)', async () => {
    await seedTestMembers(testDb)
    const member = await testDb.get(
      "SELECT id, role, is_owner FROM members WHERE LOWER(email) = LOWER($1)",
      ['ADMIN@TEST.COM'],
    )
    expect(member).toBeDefined()
    expect(member.role).toBe('Admin')
    expect(member.is_owner).toBe(false)
  })
})

describe('Schema: projects table', () => {
  let testDb

  beforeEach(async () => {
    testDb = createTestDb()
    await cleanTestDb(testDb)
    await initTestSchema(testDb)
  })

  afterEach(async () => {
    await cleanTestDb(testDb)
    await testDb.close()
  })

  it('should have lead_member_id column', async () => {
    const col = await testDb.get(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'projects' AND column_name = 'lead_member_id'",
      [testDb.schemaName],
    )
    expect(col).toBeDefined()
    expect(col.column_name).toBe('lead_member_id')
  })

  it('should default lead_member_id to null', async () => {
    await testDb.run(
      "INSERT INTO projects (name, key, type, lead) VALUES ('Test', 'TST', 'Scrum', 'John')",
    )
    const project = await testDb.get("SELECT lead_member_id FROM projects WHERE key = 'TST'")
    expect(project.lead_member_id).toBeNull()
  })
})
