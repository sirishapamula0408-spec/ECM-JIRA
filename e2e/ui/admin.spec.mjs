// JL-157 Track A — Administration (UI layer): /members (TeamsPage), /users
// (UserManagementPage), /teams + /teams/:id, /workflow-editor, /audit-log.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq, createProject } from '../support/api.mjs'
import { storageStatePath } from '../support/env.mjs'
import { freshEmail, createMember, cleanupMember, findMember, rawLogin } from '../support/track-a.mjs'

test.use({ storageState: storageStatePath('admin') })

let admin
const createdMemberIds = []
const createdTeamIds = []

test.beforeAll(async () => { admin = await apiAs('admin') })
test.afterAll(async () => {
  for (const id of createdTeamIds) await admin.delete(`/api/teams/${id}`).catch(() => {})
  for (const id of createdMemberIds) await cleanupMember(admin, id)
  await admin.dispose()
})

const roleCombo = (page, name) => page.getByRole('combobox', { name: `Change role for ${name}` })

// /members and /users are gated by RequireRole, which decides before the
// signed-in member has loaded (see A-100/A-101), so a cold page.goto() bounces
// to the dashboard. Reach them the way a person does: through the sidebar.
async function openViaSidebar(page, label, path) {
  await page.goto('/projects')
  await page.getByRole('navigation', { name: 'Sidebar' }).getByRole('link', { name: label, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${path}$`))
}

test.describe('/members (TeamsPage)', () => {
  test('A-084 renders the member directory with rows, Owner static and others with a role dropdown', async ({ page }) => {
    await openViaSidebar(page, 'Members', '/members')
    await expect(page.locator('h1')).toHaveText('Members')
    await page.getByLabel('Search members').fill('e2e.example.com')
    const ownerRow = page.locator('tr', { hasText: 'owner@e2e.example.com' })
    await expect(ownerRow).toBeVisible()
    await expect(ownerRow.getByRole('combobox')).toHaveCount(0)
    await expect(ownerRow.getByRole('button', { name: /^Delete/ })).toHaveCount(0)
    await expect(roleCombo(page, 'Mia Member')).toBeVisible()
    await expect(page.locator('tr', { hasText: 'member@e2e.example.com' }).locator('.pill-green')).toHaveText('Active')
  })

  test('A-085 inline role dropdown changes a member\'s workspace role', async ({ page }) => {
    const name = uniq('RoleUI')
    const m = await createMember(admin, { role: 'Viewer', name })
    createdMemberIds.push(m.id)
    await openViaSidebar(page, 'Members', '/members')
    await page.getByLabel('Search members').fill(name)
    await roleCombo(page, name).click()
    await page.getByRole('option', { name: 'Member', exact: true }).click()
    await expect(page.getByText(`${name} is now Member.`)).toBeVisible()
    await expect.poll(async () => (await findMember(admin, m.email)).role).toBe('Member')
  })

  test('A-086 status pills: Active green, Invited yellow, Deactivated red; default filter hides non-Active', async ({ page }) => {
    const tag = uniq('Pill')
    const act = await createMember(admin, { role: 'Viewer', name: `${tag} Act` })
    const inv = await createMember(admin, { role: 'Viewer', name: `${tag} Inv`, password: null })
    const dea = await createMember(admin, { role: 'Viewer', name: `${tag} Dea` })
    createdMemberIds.push(act.id, inv.id, dea.id)
    await expectStatus(await admin.patch(`/api/members/${dea.id}/deactivate`), 200)
    await openViaSidebar(page, 'Members', '/members')
    await page.getByLabel('Search members').fill(tag)
    await expect(page.getByLabel('Filter by status')).toHaveValue('Active')
    await expect(page.locator('tbody tr', { hasText: tag })).toHaveCount(1)
    await page.getByLabel('Filter by status').selectOption('all')
    await expect(page.locator('tbody tr', { hasText: tag })).toHaveCount(3)
    await expect(page.locator('tr', { hasText: `${tag} Act` }).locator('.pill-green')).toHaveText('Active')
    await expect(page.locator('tr', { hasText: `${tag} Inv` }).locator('.pill-yellow')).toHaveText('Invited')
    await expect(page.locator('tr', { hasText: `${tag} Dea` }).locator('.pill-red')).toHaveText('Deactivated')
  })

  test('A-087 Deactivate / Reactivate buttons toggle the member and their login', async ({ page }) => {
    const name = uniq('Toggle')
    const m = await createMember(admin, { role: 'Member', name })
    createdMemberIds.push(m.id)
    await openViaSidebar(page, 'Members', '/members')
    await page.getByLabel('Filter by status').selectOption('all')
    await page.getByLabel('Search members').fill(name)
    await page.getByRole('button', { name: `Deactivate ${name}` }).click()
    await expect(page.getByText(`${name} has been deactivated.`)).toBeVisible()
    await expect(page.locator('tr', { hasText: name }).locator('.pill-red')).toHaveText('Deactivated')
    expect((await rawLogin(m.email)).status).toBe(403)
    await page.getByRole('button', { name: `Reactivate ${name}` }).click()
    await expect(page.locator('tr', { hasText: name }).locator('.pill-green')).toHaveText('Active')
    expect((await rawLogin(m.email)).status).toBe(200)
  })

  test('A-088 the invite panel creates a pending invitation', async ({ page }) => {
    const email = freshEmail('uiinv')
    await openViaSidebar(page, 'Members', '/members')
    await page.getByRole('button', { name: '+ Invite Member' }).click()
    await expect(page.getByRole('heading', { name: 'Invite a new member' })).toBeVisible()
    await page.getByPlaceholder('Email address').fill(email)
    await page.locator('.teams-invite-form select').selectOption('Member')
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/invitations') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Send Invite' }).click(),
    ])
    expect(res.status()).toBe(201)
    await expect(page.locator('.teams-invitations-panel')).toContainText(email, { timeout: 15_000 })
    const pending = await expectStatus(await admin.get('/api/invitations?status=pending'), 200)
    expect(pending.find((p) => p.email === email)?.role).toBe('Member')
  })

  test('A-089 the invite confirmation does not claim delivery when no email was sent', async ({ page }) => {
    test.fail(true, 'DEFECT: /members invite shows "Invitation sent successfully." even though the API reported email_status "skipped" (SMTP off)')
    await openViaSidebar(page, 'Members', '/members')
    await page.getByRole('button', { name: '+ Invite Member' }).click()
    await page.getByPlaceholder('Email address').fill(freshEmail('uiinv'))
    await page.getByRole('button', { name: 'Send Invite' }).click()
    await expect(page.locator('p.banner').first()).toBeVisible()
    await expect(page.locator('p.banner').first()).not.toHaveText('Invitation sent successfully.')
  })

  test('A-090 deleting a member from the row asks for confirmation and removes them', async ({ page }) => {
    const name = uniq('DelUI')
    const m = await createMember(admin, { role: 'Viewer', name })
    await openViaSidebar(page, 'Members', '/members')
    await page.getByLabel('Search members').fill(name)
    await page.getByRole('button', { name: `Delete ${name}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove member?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Remove|Delete/ }).click()
    await expect(page.locator('tbody tr', { hasText: name })).toHaveCount(0)
    await expect.poll(async () => findMember(admin, m.email)).toBeNull()
  })
})

test.describe('/users (UserManagementPage)', () => {
  test('A-091 renders users with role dropdowns and a status chip', async ({ page }) => {
    await openViaSidebar(page, 'Users', '/users')
    await expect(page.locator('h1')).toHaveText('User Management')
    await page.getByLabel('Search users').fill('member@e2e.example.com')
    const row = page.getByRole('table', { name: 'Workspace users' }).locator('tbody tr', { hasText: 'member@e2e.example.com' })
    await expect(row).toBeVisible()
    await expect(row.getByText('Active')).toBeVisible()
    await expect(roleCombo(page, 'Mia Member')).toBeVisible()
  })

  test('A-092 Add user dialog with a temporary password creates an Active account', async ({ page }) => {
    const name = uniq('AddUI')
    const email = freshEmail('uiadd')
    await openViaSidebar(page, 'Users', '/users')
    await page.getByRole('button', { name: 'Add user' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add user' })
    await dialog.getByLabel('Full name').fill(name)
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByLabel('Role').selectOption('Member')
    await dialog.getByLabel('Temporary password (optional)').fill('Temp-Pass-123!')
    await dialog.getByRole('button', { name: 'Add user' }).click()
    await expect(page.getByText(`Created account for ${name}.`)).toBeVisible()
    const m = await findMember(admin, email)
    expect(m).toMatchObject({ role: 'Member', status: 'Active' })
    createdMemberIds.push(m.id)
    expect((await rawLogin(email, 'Temp-Pass-123!')).status).toBe(200)
  })

  test('A-093 Add user without a password warns that no email was sent', async ({ page }) => {
    const name = uniq('InvUI')
    const email = freshEmail('uiadd')
    await openViaSidebar(page, 'Users', '/users')
    await page.getByRole('button', { name: 'Add user' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add user' })
    await dialog.getByLabel('Full name').fill(name)
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByRole('button', { name: 'Add user' }).click()
    await expect(page.getByText(/no invitation email was sent: email delivery is not configured/)).toBeVisible()
    const m = await findMember(admin, email)
    expect(m.status).toBe('Invited')
    createdMemberIds.push(m.id)
  })

  test('A-094 Deactivate via the confirm dialog', async ({ page }) => {
    const name = uniq('DeaUI')
    const m = await createMember(admin, { role: 'Viewer', name })
    createdMemberIds.push(m.id)
    await openViaSidebar(page, 'Users', '/users')
    await page.getByLabel('Search users').fill(name)
    await page.getByRole('button', { name: `Deactivate ${name}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Deactivate user' })
    await dialog.getByRole('button', { name: 'Deactivate' }).click()
    await expect(page.getByRole('button', { name: `Reactivate ${name}` })).toBeVisible()
    expect((await findMember(admin, m.email)).status).toBe('Deactivated')
  })
})

test.describe('/teams and /teams/:id', () => {
  test('A-095 create a team from the directory and open its profile', async ({ page }) => {
    const name = uniq('UITeam')
    await page.goto('/teams')
    await expect(page.locator('h1')).toHaveText('Teams')
    await page.getByRole('button', { name: 'Create team' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Create team' })
    await dialog.getByLabel('Team name').fill(name)
    await dialog.getByLabel('Description').fill('Made by the functional suite')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    const card = page.getByRole('link', { name: new RegExp(name) })
    await expect(card).toBeVisible()
    const teams = await expectStatus(await admin.get(`/api/teams?search=${encodeURIComponent(name)}`), 200)
    createdTeamIds.push(teams[0].id)
    await card.click()
    await expect(page).toHaveURL(new RegExp(`/teams/${teams[0].id}$`))
    await expect(page.locator('h1')).toHaveText(name)
    await expect(page.getByRole('button', { name: 'Edit team' })).toBeVisible()
  })

  test('A-096 edit a team name from its profile', async ({ page }) => {
    const team = await expectStatus(await admin.post('/api/teams', { data: { name: uniq('UITeam') } }), 201)
    createdTeamIds.push(team.id)
    await page.goto(`/teams/${team.id}`)
    await page.getByRole('button', { name: 'Edit team' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit team' })
    const renamed = `${team.name} renamed`
    await dialog.getByLabel('Team name').fill(renamed)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('h1')).toHaveText(renamed)
    expect((await expectStatus(await admin.get(`/api/teams/${team.id}`), 200)).name).toBe(renamed)
  })

  test('A-097 an unknown team id shows "Team not found"', async ({ page }) => {
    await page.goto('/teams/99999999')
    await expect(page.locator('h1')).toHaveText('Team not found')
  })
})

test.describe('deep links', () => {
  test('A-100 an Admin opening /members directly (refresh / bookmark) sees the member directory', async ({ page }) => {
    test.fail(true, 'DEFECT: RequireRole renders its <Navigate to="/"> fallback while currentMember is still loading, so Admins are bounced to the Dashboard')
    await page.goto('/members')
    await expect(page.locator('h1')).toHaveText('Members')
  })

  test('A-101 an Admin opening /users directly (refresh / bookmark) sees User Management', async ({ page }) => {
    test.fail(true, 'DEFECT: same RequireRole loading race as A-100')
    await page.goto('/users')
    await expect(page.locator('h1')).toHaveText('User Management')
  })
})

test.describe('workflow editor and audit log', () => {
  test('A-098 the workflow editor loads and lists a project to edit', async ({ page }) => {
    const owner = await apiAs('owner')
    const project = await createProject(owner)
    await owner.dispose()
    await page.goto('/workflow-editor')
    await expect(page.locator('h1')).toHaveText('Workflow Editor')
    const select = page.getByRole('combobox', { name: 'Project' })
    await expect(select.locator('option', { hasText: project.name })).toHaveCount(1)
    await select.selectOption(String(project.id))
    await expect(page.getByRole('button', { name: 'Add status' })).toBeVisible()
  })

  test('A-099 the audit log page lists entries and "Verify integrity" reports the chain intact', async ({ page }) => {
    test.fail(true, 'DEFECT: same root cause as A-051 — verify always reports "Tampering detected! The chain breaks at entry #1"')
    await page.goto('/audit-log')
    await expect(page.locator('h1')).toHaveText('Audit Log')
    await page.getByRole('button', { name: 'Verify integrity' }).click()
    await expect(page.getByRole('alert')).toContainText('Chain intact')
  })
})
