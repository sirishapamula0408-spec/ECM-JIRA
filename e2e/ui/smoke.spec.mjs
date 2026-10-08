// JL-157 — harness smoke for the UI: the production build loads, and a saved
// session lands on the app rather than the login page.
import { test, expect } from '@playwright/test'
import { storageStatePath } from '../support/env.mjs'

test.describe('signed out', () => {
  test('the login page renders', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Log In →/ })).toBeVisible()
  })
})

test.describe('signed in as owner', () => {
  test.use({ storageState: storageStatePath('owner') })

  test('lands in the app with the sidebar', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible()
    await expect(page.locator('h1')).toBeVisible()
  })
})
