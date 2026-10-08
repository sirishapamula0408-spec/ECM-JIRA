// JL-157 Track C — Tracking, UI layer: dashboard gadgets, reports charts,
// saved filters + JQL, activity feed paging, notification bell.
import { test, expect } from '@playwright/test'
import { apiAs, uniq, addProjectMember } from '../support/api.mjs'
import { storageStatePath } from '../support/env.mjs'
import {
  expectStatus, createIssue, createProject, freshUser, storageStateFor, watchPage, expectClean,
} from '../support/track-c.mjs'

let owner
let project
let issues

test.beforeAll(async () => {
  owner = await apiAs('owner')
  project = await createProject(owner, { name: uniq('TrackC UI') })
  issues = {
    todo: await createIssue(owner, project.id, { status: 'To Do', priority: 'High' }),
    testing: await createIssue(owner, project.id, { status: 'In Testing' }),
    cancelled: await createIssue(owner, project.id, { status: 'Cancelled' }),
  }
})

test.afterAll(async () => { await owner?.dispose() })

/** Pick a value in one of the app's FilterChip dropdowns. */
async function pickChip(page, label, optionText) {
  await page.locator('.filter-chip', { hasText: `${label}:` }).first().click()
  const dropdown = page.locator('.filter-chip-dropdown')
  await dropdown.getByPlaceholder('Search').fill(optionText)
  await dropdown.getByRole('option', { name: optionText, exact: true }).click()
}

test.describe('as owner', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('dashboard renders its default gadgets, and the project filter scopes Filter Results', async ({ page }) => {
    const problems = watchPage(page)
    await page.goto('/dashboard')
    for (const title of ['Status Overview', 'Priority Breakdown', 'Activity Stream', 'Filter Results']) {
      await expect(page.locator('.gadget-title', { hasText: title }).first()).toBeVisible()
    }
    await pickChip(page, 'Project', project.name)
    const results = page.locator('.gadget', { has: page.locator('.gadget-title', { hasText: 'Filter Results' }) })
    await expect(results.getByRole('link', { name: issues.todo.key })).toBeVisible()
    await expect(results.getByRole('link', { name: issues.cancelled.key })).toBeVisible()
    expectClean(problems)
  })

  test('project reports page renders stat cards and a CFD with every status band', async ({ page }) => {
    const problems = watchPage(page)
    await page.goto(`/projects/${project.id}/reports`)
    await expect(page.getByRole('heading', { level: 1, name: 'Reporting Dashboard' })).toBeVisible()
    await expect(page.getByText('Completion Rate')).toBeVisible()
    await expect(page.getByRole('img', { name: /Cumulative flow diagram/ })).toBeVisible()
    const legend = page.locator('.cfd-legend')
    await expect(legend).toContainText('In Testing')
    await expect(legend).toContainText('Cancelled')
    await expect(page.getByRole('heading', { name: 'Created vs Resolved' })).toBeVisible()
    expectClean(problems)
  })

  test('create a saved filter from a basic search, then run it from My Filters', async ({ page }) => {
    const problems = watchPage(page)
    const name = uniq('UI filter')
    await page.goto('/filters')
    await page.getByRole('button', { name: 'Search Issues' }).click()
    await pickChip(page, 'Project', project.name)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('heading', { name: '3 issues found' })).toBeVisible()
    await page.getByRole('button', { name: 'Save as Filter' }).click()
    await page.getByPlaceholder('e.g. My Open Bugs').fill(name)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'My Filters' }).click()
    const row = page.locator('tr', { hasText: name })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Run' }).click()
    await expect(page.getByRole('heading', { name: '3 issues found' })).toBeVisible()
    await expect(page.getByText(issues.testing.key)).toBeVisible()
    expectClean(problems)
  })

  test('JQL search returns the matching issue, and an invalid query shows the server error', async ({ page }) => {
    const problems = watchPage(page)
    await page.goto('/filters')
    await page.getByRole('button', { name: 'Search Issues' }).click()
    await page.getByRole('button', { name: 'JQL', exact: true }).click()
    await page.getByLabel('JQL Query').fill(`project = ${project.id} AND status = "In Testing"`)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('heading', { name: '1 issue found' })).toBeVisible()
    await expect(page.getByText(issues.testing.key)).toBeVisible()
    await page.getByLabel('JQL Query').fill('colour = red')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.locator('.jql-error')).toHaveText('Unknown field: "colour"')
    // A 400 is the expected answer to a bad query; only its console echo is excused.
    problems.consoleErrors = problems.consoleErrors.filter((m) => !/status of 400/.test(m))
    expectClean(problems)
  })

  test('activity feed lists rows, filters by project, and pages', async ({ page }) => {
    const problems = watchPage(page)
    await page.goto('/activity')
    await expect(page.getByRole('heading', { level: 1, name: 'Activity Feed' })).toBeVisible()
    const rows = page.getByRole('table', { name: 'Activity' }).locator('tbody tr')
    await expect(rows.first()).toBeVisible()

    // Paging: 10 per page, then the next page shows different rows.
    await page.getByLabel('Activities per page').selectOption('10')
    await expect(rows).toHaveCount(10)
    const firstPage = await rows.allInnerTexts()
    await page.getByRole('button', { name: 'Go to next page' }).click()
    await expect(page.getByText(/^11–20 of \d+/)).toBeVisible()
    await expect.poll(async () => (await rows.allInnerTexts()).join('|')).not.toBe(firstPage.join('|'))

    // Project filter: only this project's rows.
    await page.locator('.af-filter-bar').getByRole('combobox', { name: 'Project' }).click()
    await page.getByRole('option', { name: project.name, exact: true }).click()
    await expect(rows.filter({ hasText: `created ${issues.todo.key}` })).toHaveCount(1)
    await expect(rows).toHaveCount(3)
    expectClean(problems)
  })
})

test.describe('notification bell', () => {
  test('shows an unread badge, lists the mention, and Mark all read clears it', async ({ browser }) => {
    const user = await freshUser(owner)
    await expectStatus(await owner.post(`/api/issues/${issues.todo.id}/comments`, { data: { text: `ping @${user.email}` } }), 201)
    await expectStatus(await owner.post(`/api/issues/${issues.testing.id}/comments`, { data: { text: `pong @${user.email}` } }), 201)

    const context = await browser.newContext({ storageState: storageStateFor(user.session) })
    const page = await context.newPage()
    const problems = watchPage(page)
    await page.goto('/projects')
    const bell = page.getByRole('button', { name: 'Notifications' })
    await expect(bell.locator('.notif-count-dot')).toHaveText('2')
    await bell.click()
    const dropdown = page.locator('.notif-dropdown')
    await expect(dropdown.getByText(`Mentioned in ${issues.todo.key}`)).toBeVisible()
    await expect(dropdown.locator('.notif-item--unread')).toHaveCount(2)
    await dropdown.getByRole('button', { name: 'Mark all read' }).click()
    await expect(dropdown.locator('.notif-item--unread')).toHaveCount(0)
    await expect(bell.locator('.notif-count-dot')).toHaveCount(0)
    const box = await expectStatus(await user.api.get('/api/notifications'), 200)
    expect(box.unreadCount).toBe(0)
    expectClean(problems)
    await context.close()
    await user.api.dispose()
  })

  test('clicking a notification marks it read and opens its issue', async ({ browser }) => {
    const user = await freshUser(owner)
    // A project member, so the app has a project and the issue route resolves.
    await addProjectMember(owner, project.id, user.id, 'Member')
    await expectStatus(await owner.post(`/api/issues/${issues.cancelled.id}/comments`, { data: { text: `look @${user.email}` } }), 201)
    const context = await browser.newContext({ storageState: storageStateFor(user.session) })
    const page = await context.newPage()
    await page.goto('/projects')
    const bell = page.getByRole('button', { name: 'Notifications' })
    await expect(bell.locator('.notif-count-dot')).toHaveText('1')
    await bell.click()
    await page.locator('.notif-dropdown').getByText(`Mentioned in ${issues.cancelled.key}`).click()
    await expect(page).toHaveURL(new RegExp(`/issues/${issues.cancelled.id}$`))
    await expect(bell.locator('.notif-count-dot')).toHaveCount(0)
    await context.close()
    await user.api.dispose()
  })
})
