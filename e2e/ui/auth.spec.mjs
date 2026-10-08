// JL-157 Track A — Authentication (UI layer): LoginPage, ResetPasswordPage,
// AcceptInvitePage, the Topbar log-out action.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus } from '../support/api.mjs'
import { ACCOUNTS, PASSWORD, BASE_URL } from '../support/env.mjs'
import { freshEmail, createMember, cleanupMember, rawLogin, findMember } from '../support/track-a.mjs'

let owner
const createdMemberIds = []

test.beforeAll(async () => { owner = await apiAs('owner') })
test.afterAll(async () => {
  for (const id of createdMemberIds) await cleanupMember(owner, id)
  await owner.dispose()
})

const submit = (page, name = /Log In →/) => page.getByRole('button', { name })

async function fillLogin(page, email, password) {
  await page.locator('#login-email').fill(email)
  await page.locator('#login-password').fill(password)
}

test('A-069 log in through the real form lands in the app', async ({ page }) => {
  await page.goto('/')
  await fillLogin(page, ACCOUNTS.member.email, PASSWORD)
  await submit(page).click()
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible()
  await expect(page.locator('#login-email')).toHaveCount(0)
})

test('A-070 a wrong password shows the error and stays on the login page', async ({ page }) => {
  await page.goto('/')
  await fillLogin(page, ACCOUNTS.viewer.email, 'not-the-password')
  await submit(page).click()
  await expect(page.getByRole('alert')).toContainText('Invalid email or password')
  await expect(submit(page)).toBeVisible()
})

test('A-071 the submit button stays disabled until both fields are filled; invalid email is flagged on blur', async ({ page }) => {
  await page.goto('/')
  await expect(submit(page)).toBeDisabled()
  await page.locator('#login-email').fill('not-an-email')
  await page.locator('#login-password').focus()
  await expect(page.locator('#login-email-error')).toHaveText('Enter a valid email address.')
  await page.locator('#login-password').fill('x')
  await expect(submit(page)).toBeEnabled()
})

test('A-072 Sign Up tab switches the form to account creation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(submit(page, /Create Account →/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Forgot password?' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('A-073 signing up through the form creates the account and signs in', async ({ page }) => {
  const email = freshEmail('uisu')
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click()
  await fillLogin(page, email, PASSWORD)
  await submit(page, /Create Account →/).click()
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible()
  const m = await findMember(owner, email)
  expect(m).toMatchObject({ role: 'Viewer', status: 'Active' })
  createdMemberIds.push(m.id)
})

test('A-074 sign-up for an existing account offers "Log in" and "Reset password" (JL-155)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click()
  await fillLogin(page, ACCOUNTS.member.email, 'Some-Pass-123!')
  await submit(page, /Create Account →/).click()
  const alert = page.locator('.login-error')
  await expect(alert).toContainText('An account already exists for this email address')
  await expect(alert.getByRole('button', { name: 'Log in' })).toBeVisible()
  await alert.getByRole('button', { name: 'Reset password' }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await expect(page.locator('#forgot-email')).toHaveValue(ACCOUNTS.member.email)
})

test('A-075 the "Log in" action on an account-exists signup returns to the login form', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click()
  await fillLogin(page, ACCOUNTS.viewer.email, 'Some-Pass-123!')
  await submit(page, /Create Account →/).click()
  await page.locator('.login-error').getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(submit(page)).toBeVisible()
})

test('A-076 sign-up with a weak password shows the policy error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click()
  await fillLogin(page, freshEmail('uisu'), 'abc1234') // 7 chars: passes the 6 floor, fails the 8-char policy
  await submit(page, /Create Account →/).click()
  await expect(page.locator('.login-error')).toContainText('Password must be at least 8 characters')
})

test('A-077 the sign-up password hint matches the enforced password policy', async ({ page }) => {
  test.fail(true, 'DEFECT: sign-up form hard-codes "Use at least 6 characters" while the server enforces the org policy (8 by default)')
  const policy = await expectStatus(await owner.get('/api/security-policy'), 200)
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click()
  await expect(page.locator('#login-password-hint')).toContainText(`at least ${policy.min_password_length} characters`)
})

test('A-078 forgot-password flow: email → token step → new password → done → log in', async ({ page }) => {
  const m = await createMember(owner, { role: 'Viewer' })
  createdMemberIds.push(m.id)
  const newPw = 'Ui-Reset-Pass-77!'
  await page.goto('/')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await page.locator('#forgot-email').fill(m.email)
  await page.getByRole('button', { name: 'Send Reset Token' }).click()
  // SMTP is off, so the token comes back in the response and is pre-filled.
  await expect(page.locator('#reset-token')).toHaveValue(/^[0-9a-f]{64}$/)
  await page.locator('#new-password').fill(newPw)
  await page.locator('#confirm-password').fill('mismatch-123')
  await page.getByRole('button', { name: 'Reset Password' }).click()
  await expect(page.locator('#reset-error')).toHaveText('Passwords do not match')
  await page.locator('#confirm-password').fill(newPw)
  await page.getByRole('button', { name: 'Reset Password' }).click()
  await expect(page.getByRole('heading', { name: 'Password reset' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to Log In' }).click()
  await fillLogin(page, m.email, newPw)
  await submit(page).click()
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible()
})

test('A-079 /reset-password with an emailed token sets a new password', async ({ page }) => {
  const m = await createMember(owner, { role: 'Viewer' })
  createdMemberIds.push(m.id)
  const fp = await owner.post('/api/auth/forgot-password', { data: { email: m.email } })
  const { resetToken } = await fp.json()
  await page.goto(`/reset-password?token=${resetToken}`)
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  await page.getByLabel('New password').fill('Link-Reset-Pass-1!')
  await page.getByLabel('Confirm password').fill('Link-Reset-Pass-1!')
  await page.getByRole('button', { name: 'Reset password' }).click()
  await expect(page.getByRole('heading', { name: 'Password reset' })).toBeVisible()
  expect((await rawLogin(m.email, 'Link-Reset-Pass-1!')).status).toBe(200)
})

test('A-080 /reset-password without a token explains the problem', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page.getByRole('alert')).toContainText('This reset link is missing its token')
  await expect(page.getByRole('button', { name: 'Go to sign in' })).toBeVisible()
})

test('A-081 /accept-invite: choose a password and land signed in', async ({ page }) => {
  const email = freshEmail('uiinv')
  const inv = await expectStatus(await owner.post('/api/invitations', { data: { email, role: 'Member' } }), 201)
  await page.goto(`/accept-invite?token=${inv.token}`)
  await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  await page.getByLabel('Choose a password').fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page.getByRole('heading', { name: 'Invitation accepted' })).toBeVisible()
  await expect(page.getByText(/is ready and you're signed in/)).toBeVisible()
  await page.getByRole('button', { name: 'Go to your workspace' }).click()
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible()
  const m = await findMember(owner, email)
  expect(m.role).toBe('Member')
  createdMemberIds.push(m.id)
})

test('A-082 /accept-invite with an unknown token shows an error', async ({ page }) => {
  await page.goto(`/accept-invite?token=${'0'.repeat(64)}`)
  await expect(page.getByRole('alert')).toContainText('Invitation not found')
})

test.describe('signed in', () => {
  // Playwright fixtures must destructure their first argument, even when unused.
  // eslint-disable-next-line no-empty-pattern
  test.use({ storageState: async ({}, use) => {
    // A throwaway session, so logging out cannot disturb the shared seeded state.
    const m = await createMember(owner, { role: 'Member' })
    createdMemberIds.push(m.id)
    const { body } = await rawLogin(m.email)
    await use({
      cookies: [],
      origins: [{
        origin: BASE_URL,
        localStorage: [
          { name: 'jira_auth_token', value: body.token },
          { name: 'jira_auth_remember', value: '1' },
          { name: 'jira_auth_user', value: JSON.stringify(body.user) },
        ],
      }],
    })
  } })

  test('A-083 log out from the user menu returns to the login page and clears the session', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible()
    await page.getByRole('button', { name: 'Open user menu' }).click()
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(submit(page)).toBeVisible()
    const token = await page.evaluate(() => localStorage.getItem('jira_auth_token') || sessionStorage.getItem('jira_auth_token'))
    expect(token).toBeFalsy()
    await page.reload()
    await expect(submit(page)).toBeVisible()
  })
})
