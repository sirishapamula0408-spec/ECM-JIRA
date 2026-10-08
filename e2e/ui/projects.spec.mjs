// JL-157 Track B — Projects UI: create through the modal, list + sidebar,
// Summary, Settings save, and the no-projects redirect.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq, login } from '../support/api.mjs'
import { storageStatePath, PASSWORD } from '../support/env.mjs'
import { createProject, randomKey } from '../support/track-b.mjs'

let owner
test.beforeAll(async () => { owner = await apiAs('owner') })
test.afterAll(async () => { await owner?.dispose() })

test.describe('as owner', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('create a Kanban project through the modal; it appears in the list and the sidebar', async ({ page }) => {
    const name = uniq('UI Project')
    const key = randomKey()
    await page.goto('/projects')
    await page.locator('.projects-header').getByRole('button', { name: 'Create project' }).click()
    const modal = page.locator('form.create-project-modal')
    await expect(modal.getByRole('heading', { name: 'Create project' })).toBeVisible()
    await modal.getByPlaceholder('e.g. Website Redesign').fill(name)
    await modal.getByPlaceholder('e.g. WEB', { exact: true }).fill(key)
    await modal.locator('select').first().selectOption('Kanban')
    // Pick the lead explicitly — see the lead-default defect test below.
    await modal.locator('select').nth(1).selectOption({ index: 1 })
    await modal.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(modal).toBeHidden()

    await page.getByPlaceholder('Search projects').fill(name)
    const row = page.locator('table.projects-table tbody tr', { hasText: name })
    await expect(row).toBeVisible()
    await expect(row).toContainText(key)
    await expect(row).toContainText('Kanban')
    await expect(page.locator('#sidebar-project-list')).toContainText(name)

    const list = await expectStatus(await owner.get('/api/projects'), 200)
    expect(list.find((p) => p.key === key)?.type).toBe('Kanban')
  })

  test('the modal upper-cases the key and caps it at 10 characters', async ({ page }) => {
    await page.goto('/projects')
    await page.locator('.projects-header').getByRole('button', { name: 'Create project' }).click()
    const keyInput = page.locator('form.create-project-modal').getByPlaceholder('e.g. WEB', { exact: true })
    await keyInput.fill('abcdefghijklmnop')
    await expect(keyInput).toHaveValue('ABCDEFGHIJ')
    await page.locator('form.create-project-modal').getByRole('button', { name: 'Cancel' }).click()
  })

  test('the Project lead defaults to the signed-in user so Create works without touching it', async ({ page }) => {
    test.fail(true, 'DEFECT: CreateProjectModal defaults lead to displayNameFromEmail() ("Owner"), which is not an option when the member name differs ("owner"); the select shows "Select lead" and native validation blocks Create')
    await page.goto('/projects')
    await page.locator('.projects-header').getByRole('button', { name: 'Create project' }).click()
    const lead = page.locator('form.create-project-modal select').nth(1)
    await expect(lead).not.toHaveValue('', { timeout: 3000 })
  })

  test("clicking a project opens its Summary with the project's name", async ({ page }) => {
    const p = await createProject(owner)
    await page.goto('/projects')
    await page.getByPlaceholder('Search projects').fill(p.name)
    await page.locator('table.projects-table tbody tr', { hasText: p.name }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${p.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: p.name })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Status Breakdown' })).toBeVisible()
  })

  test('Settings saves a renamed project and a changed type', async ({ page }) => {
    const p = await createProject(owner)
    const newName = uniq('Settings Renamed')
    await page.goto(`/projects/${p.id}/settings`)
    await expect(page.getByRole('heading', { level: 1, name: 'Details' })).toBeVisible()
    await page.getByLabel('Name').fill(newName)
    await page.getByLabel('Project Type').selectOption('Kanban')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Project details saved.')).toBeVisible()
    const fetched = await expectStatus(await owner.get(`/api/projects/${p.id}`), 200)
    expect(fetched).toMatchObject({ name: newName, type: 'Kanban' })
  })
})

test.describe('a user with no projects', () => {
  test('is redirected from a project route to /projects and told they have none', async ({ page }) => {
    // A throwaway Viewer that belongs to no project. Removed afterwards.
    const email = `${uniq('trackb-noproj').toLowerCase()}@e2e.example.com`
    const created = await expectStatus(await owner.post('/api/members', {
      data: { name: uniq('No Projects'), email, role: 'Viewer', password: PASSWORD },
    }), 201)
    try {
      const session = await login(email)
      await page.goto('/')
      await page.evaluate(({ token, user }) => {
        localStorage.setItem('jira_auth_token', token)
        localStorage.setItem('jira_auth_remember', '1')
        localStorage.setItem('jira_auth_user', JSON.stringify(user))
      }, session)
      await page.goto('/board')
      await expect(page).toHaveURL(/\/projects$/)
      await expect(page.getByRole('heading', { name: "You're not assigned to any projects" })).toBeVisible()
    } finally {
      await owner.delete(`/api/members/${created.id}`)
    }
  })
})
