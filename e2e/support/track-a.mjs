// JL-157 Track A (auth / administration / RBAC) — helpers private to Track A.
// Everything here creates its own uniquely named data; nothing touches the
// seeded owner/admin/member/viewer accounts.
import { request as pwRequest } from '@playwright/test'
import { BASE_URL, PASSWORD } from './env.mjs'
import { uniq, expectStatus } from './api.mjs'

/** A fresh, never-used address on the reserved example.com domain. */
export function freshEmail(prefix = 'ta') {
  return `${uniq(prefix)}@e2e.example.com`.toLowerCase()
}

/** POST /api/auth/login without throwing; returns { status, body }. */
export async function rawLogin(email, password = PASSWORD, extra = {}) {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const res = await ctx.post('/api/auth/login', { data: { email, password, ...extra } })
  const body = await res.json().catch(() => ({}))
  const out = { status: res.status(), body, headers: res.headers() }
  await ctx.dispose()
  return out
}

/** POST /api/auth/signup without throwing; returns { status, body }. */
export async function rawSignup(email, password = PASSWORD) {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  const res = await ctx.post('/api/auth/signup', { data: { email, password } })
  const body = await res.json().catch(() => ({}))
  await ctx.dispose()
  return { status: res.status(), body }
}

/** An API context authenticated with a raw JWT. */
export function apiWithToken(token) {
  return pwRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  })
}

/**
 * Admin-provision a member. With `password` (default) the account is Active
 * and can log in; pass `password: null` for an invite (status Invited).
 */
export async function createMember(adminApi, { role = 'Member', password = PASSWORD, name, email } = {}) {
  const address = email || freshEmail('mbr')
  const data = { name: name || uniq('Track A'), email: address, role }
  if (password) data.password = password
  const member = await expectStatus(await adminApi.post('/api/members', { data }), 201)
  return { ...member, email: address, password }
}

/** Find a member row by email from the full (legacy-array) list. */
export async function findMember(api, email) {
  const rows = await expectStatus(await api.get('/api/members'), 200)
  return rows.find((r) => String(r.email).toLowerCase() === String(email).toLowerCase()) || null
}

/** Best-effort delete of a throwaway member (never a seeded account). */
export async function cleanupMember(adminApi, id) {
  if (!id) return
  await adminApi.delete(`/api/members/${id}`).catch(() => {})
}

/**
 * Run `fn` with the workspace signup policy set to `policy`, then restore the
 * previous value no matter what happened.
 */
export async function withSignupPolicy(adminApi, policy, fn) {
  const before = await expectStatus(await adminApi.get('/api/workspace/settings'), 200)
  const previous = before.signup_policy || 'open'
  await expectStatus(await adminApi.put('/api/workspace/settings', { data: { signup_policy: policy } }), 200)
  try {
    return await fn()
  } finally {
    await adminApi.put('/api/workspace/settings', { data: { signup_policy: previous } })
  }
}
