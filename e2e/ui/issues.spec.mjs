// JL-157 Track B — Issues UI: create through the modal, the /browse/KEY page,
// inline edit, comment, label, work log, and the Viewer's read-only view.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq } from '../support/api.mjs'
import { storageStatePath } from '../support/env.mjs'
import { createProject, createIssue, addToProject } from '../support/track-b.mjs'

let owner, viewer, project
test.beforeAll(async () => {
  owner = await apiAs('owner')
  viewer = await apiAs('viewer')
  project = await createProject(owner)
  await addToProject(owner, project.id, viewer, 'Viewer')
})
test.afterAll(async () => { await Promise.all([owner, viewer].map((a) => a?.dispose())) })

async function findByTitle(title) {
  const { issues } = await expectStatus(await owner.get(`/api/projects/${project.id}/export?format=json`), 200)
  return issues.find((i) => i.title === title)
}

test.describe('as owner', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('the top-bar Create button is enabled and opens the Create issue modal', async ({ page }) => {
    test.fail(true, 'DEFECT: RootLayout renders <Topbar> without hasProjects/onCreate, so the Jira Create button is always disabled ("No project access")')
    await page.goto(`/projects/${project.id}/board`)
    const create = page.locator('.top-actions .create-btn')
    await expect(create).toBeEnabled({ timeout: 5000 })
    await create.click()
    await expect(page.locator('form.create-issue-modal')).toBeVisible()
  })

  test('create a Bug through the Create issue modal (opened with the "c" shortcut)', async ({ page }) => {
    const title = uniq('UI Bug')
    await page.goto(`/projects/${project.id}/board`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('c')
    const modal = page.locator('form.create-issue-modal')
    await expect(modal.getByRole('heading', { name: 'Create issue' })).toBeVisible()
    // Opened from a project page, the project is preselected.
    await expect(modal.locator('select').first()).toHaveValue(String(project.id))
    await modal.locator('button[data-type="Bug"]').click()
    await modal.getByPlaceholder('What needs to be done?').fill(title)
    await modal.getByPlaceholder('Add a description...').fill('Steps to reproduce: open the page')
    await modal.locator('select').nth(3).selectOption('High')
    await modal.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(modal).toBeHidden()

    const row = await findByTitle(title)
    expect(row).toMatchObject({ issue_type: 'Bug', priority: 'High', status: 'Backlog' })
    expect(row.issue_key).toMatch(new RegExp(`^${project.key}-\\d+$`))
  })

  test('/browse/KEY opens the issue page with its key and title', async ({ page }) => {
    const issue = await createIssue(owner, project.id, { status: 'Backlog', title: uniq('Browse me') })
    await page.goto(`/browse/${issue.key}`)
    await expect(page.getByRole('heading', { level: 1, name: issue.title })).toBeVisible()
    await expect(page.getByText(issue.key, { exact: true }).first()).toBeVisible()
  })

  test('edit the priority inline and it persists', async ({ page }) => {
    const issue = await createIssue(owner, project.id, { status: 'Backlog', priority: 'Low' })
    await page.goto(`/browse/${issue.key}`)
    const row = page.locator('.id-detail-row', { has: page.locator('dt', { hasText: /^Priority$/ }) })
    await row.locator('.id-inline-display').click()
    await row.locator('select.id-inline-select').selectOption('High')
    await expect.poll(async () => (await expectStatus(await owner.get(`/api/issues/${issue.id}`), 200)).priority).toBe('High')
  })

  test('add a comment', async ({ page }) => {
    const issue = await createIssue(owner, project.id, { status: 'Backlog' })
    const text = uniq('UI comment')
    await page.goto(`/browse/${issue.key}`)
    await page.getByPlaceholder('Add a comment... Use @email to mention someone').fill(text)
    await page.locator('.id-comment-actions').getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.id-activity-feed')).toContainText(text)
    const comments = await expectStatus(await owner.get(`/api/issues/${issue.id}/comments`), 200)
    expect(comments.map((c) => c.text)).toContain(text)
  })

  test('add a new label from the Labels field', async ({ page }) => {
    const issue = await createIssue(owner, project.id, { status: 'Backlog' })
    const label = uniq('uilabel')
    await page.goto(`/browse/${issue.key}`)
    const row = page.locator('.id-detail-row', { has: page.locator('dt', { hasText: /^Labels$/ }) })
    await row.locator('.id-inline-display').click()
    await row.getByPlaceholder('Add or create label...').fill(label)
    await row.getByPlaceholder('Add or create label...').press('Enter')
    await expect.poll(async () => (await expectStatus(await owner.get(`/api/issues/${issue.id}/labels`), 200)).map((l) => l.name)).toEqual([label])
  })

  test('log work from the Work log tab', async ({ page }) => {
    const issue = await createIssue(owner, project.id, { status: 'Backlog' })
    await page.goto(`/browse/${issue.key}`)
    await page.locator('.id-activity-tabs').getByRole('button', { name: /^Work log/ }).click()
    await page.getByRole('button', { name: 'Log work' }).click()
    await page.getByPlaceholder('e.g. 2h 30m').fill('45m')
    await page.getByPlaceholder('What did you work on?').fill('UI worklog')
    await page.locator('.id-worklog-form-actions').getByRole('button', { name: 'Log', exact: true }).click()
    await expect(page.locator('.id-time-stats')).toContainText('45m logged')
    const { summary } = await expectStatus(await owner.get(`/api/issues/${issue.id}/worklogs`), 200)
    expect(summary.spentMinutes).toBe(45)
  })
})

test.describe('as a project Viewer', () => {
  test.use({ storageState: storageStatePath('viewer') })

  test('the issue page is read-only: no comment box, no Log work, no Delete', async ({ page }) => {
    const issue = await createIssue(owner, project.id, { status: 'Backlog' })
    await page.goto(`/browse/${issue.key}`)
    await expect(page.getByRole('heading', { level: 1, name: issue.title })).toBeVisible()
    await expect(page.getByPlaceholder('Add a comment... Use @email to mention someone')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete issue' })).toHaveCount(0)
    await page.locator('.id-activity-tabs').getByRole('button', { name: /^Work log/ }).click()
    await expect(page.getByRole('button', { name: 'Log work' })).toHaveCount(0)
  })
})
