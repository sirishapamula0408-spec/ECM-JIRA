// JL-157 Track A — Role-based access control (UI layer). What each seeded role
// is shown, and that the admin-only routes refuse non-admins even after the
// session has fully loaded.
import { test, expect } from '@playwright/test'
import { storageStatePath } from '../support/env.mjs'

const sidebar = (page) => page.getByRole('navigation', { name: 'Sidebar' })

/** Load the app and wait until the role-dependent sidebar has settled. */
async function loadApp(page) {
  // the signed-in member (and so every permission) is loaded once /api/auth/me has answered
  const me = page.waitForResponse((r) => r.url().endsWith('/api/auth/me') && r.status() === 200)
  await page.goto('/projects')
  await me
  await expect(sidebar(page)).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Teams', exact: true })).toBeVisible()
}

/** Client-side navigation, so the route gate runs with permissions already loaded. */
async function navigateInApp(page, path) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

for (const role of ['member', 'viewer']) {
  test.describe(`signed in as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) })

    test(`A-${role === 'member' ? '102' : '103'} ${role} does not see the Members or Users sidebar items`, async ({ page }) => {
      await loadApp(page)
      await expect(sidebar(page).getByRole('link', { name: 'Members', exact: true })).toHaveCount(0)
      await expect(sidebar(page).getByRole('link', { name: 'Users', exact: true })).toHaveCount(0)
    })

    test(`A-${role === 'member' ? '104' : '105'} ${role} is redirected away from /members and /users`, async ({ page }) => {
      await loadApp(page)
      for (const path of ['/members', '/users']) {
        await navigateInApp(page, path)
        await expect(page).not.toHaveURL(new RegExp(`${path}$`))
        await expect(page.locator('h1')).not.toHaveText(/^(Members|User Management)$/)
      }
      // and a cold load of the URL as well
      await page.goto('/users')
      await expect(page).not.toHaveURL(/\/users$/)
    })

    test(`A-${role === 'member' ? '106' : '107'} ${role} sees "Admins only" on the audit log page`, async ({ page }) => {
      await loadApp(page)
      await navigateInApp(page, '/audit-log')
      await expect(page.getByText('Admins only')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Verify integrity' })).toHaveCount(0)
    })
  })
}

test.describe('signed in as viewer', () => {
  test.use({ storageState: storageStatePath('viewer') })

  test('A-108 viewer is not offered "Create project"', async ({ page }) => {
    await loadApp(page)
    await expect(page.getByRole('button', { name: 'Create project' })).toHaveCount(0)
    await expect(page.getByText('Create project', { exact: true })).toHaveCount(0)
  })
})

test.describe('signed in as member', () => {
  test.use({ storageState: storageStatePath('member') })

  test('A-109 member IS offered "Create project" (project_creation_policy = all_members)', async ({ page }) => {
    await loadApp(page)
    await expect(page.getByRole('button', { name: 'Create project' }).first()).toBeVisible()
  })
})

for (const role of ['admin', 'owner']) {
  test.describe(`signed in as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) })

    test(`A-${role === 'admin' ? '110' : '111'} ${role} sees Members and Users in the sidebar and can open both`, async ({ page }) => {
      await loadApp(page)
      await sidebar(page).getByRole('link', { name: 'Members', exact: true }).click()
      await expect(page.locator('h1')).toHaveText('Members')
      await sidebar(page).getByRole('link', { name: 'Users', exact: true }).click()
      await expect(page.locator('h1')).toHaveText('User Management')
    })
  })
}

test.describe('signed in as admin', () => {
  test.use({ storageState: storageStatePath('admin') })

  test('A-112 admin sees the full audit log page', async ({ page }) => {
    await loadApp(page)
    await sidebar(page).getByRole('link', { name: 'Audit Log', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('Audit Log')
    await expect(page.getByRole('button', { name: 'Verify integrity' })).toBeVisible()
  })
})
