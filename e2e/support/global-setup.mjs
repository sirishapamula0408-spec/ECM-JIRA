// JL-157 — seed the accounts every spec relies on, and save a signed-in
// browser session per role so UI specs start already logged in.
//
// Idempotent: with E2E_RESET=0 the accounts already exist and are reused.
//
//   owner   first signup on an empty database → workspace Owner (Admin role)
//   admin   created by the owner with a password → Active Admin
//   member  …                                     → Active Member
//   viewer  …                                     → Active Viewer
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from '@playwright/test'
import { BASE_URL, ACCOUNTS, PASSWORD, AUTH_DIR, storageStatePath } from './env.mjs'

async function tryLogin(ctx, email) {
  const res = await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } })
  return res.ok() ? res.json() : null
}

export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: BASE_URL })

  let owner = await tryLogin(ctx, ACCOUNTS.owner.email)
  if (!owner) {
    const res = await ctx.post('/api/auth/signup', { data: { email: ACCOUNTS.owner.email, password: PASSWORD } })
    if (res.status() !== 201) throw new Error(`owner signup → ${res.status()} ${await res.text()}`)
    owner = await res.json()
  }
  const auth = { Authorization: `Bearer ${owner.token}` }

  const sessions = { owner }
  for (const role of ['admin', 'member', 'viewer']) {
    const account = ACCOUNTS[role]
    let session = await tryLogin(ctx, account.email)
    if (!session) {
      const res = await ctx.post('/api/members', {
        headers: auth,
        data: { name: account.name, email: account.email, role: account.role, password: PASSWORD },
      })
      if (res.status() !== 201) throw new Error(`create ${role} → ${res.status()} ${await res.text()}`)
      session = await tryLogin(ctx, account.email)
      if (!session) throw new Error(`${role} was created but cannot log in`)
    }
    sessions[role] = session
  }
  await ctx.dispose()

  // The SPA reads its session from storage (src/api/client.js and
  // AuthProvider): token + user, with "remember me" putting both in
  // localStorage, which is the half of storage Playwright can persist.
  mkdirSync(AUTH_DIR, { recursive: true })
  for (const [role, session] of Object.entries(sessions)) {
    writeFileSync(storageStatePath(role), JSON.stringify({
      cookies: [],
      origins: [{
        origin: BASE_URL,
        localStorage: [
          { name: 'jira_auth_token', value: session.token },
          { name: 'jira_auth_remember', value: '1' },
          { name: 'jira_auth_user', value: JSON.stringify(session.user) },
        ],
      }],
    }, null, 2))
  }
}
