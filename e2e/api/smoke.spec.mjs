// JL-157 — harness smoke: the server is up and every seeded role can sign in
// with the workspace role it was given.
import { test, expect } from '@playwright/test'
import { apiAs, anonymous, expectStatus } from '../support/api.mjs'

test('health endpoint answers ok', async () => {
  const api = await anonymous()
  const body = await expectStatus(await api.get('/api/health'), 200)
  expect(body.status).toBe('ok')
  await api.dispose()
})

for (const [role, expected] of [['owner', 'Admin'], ['admin', 'Admin'], ['member', 'Member'], ['viewer', 'Viewer']]) {
  test(`${role} signs in as workspace ${expected}`, async () => {
    const api = await apiAs(role)
    const me = await expectStatus(await api.get('/api/auth/me'), 200)
    expect(me.workspaceRole).toBe(expected)
    await api.dispose()
  })
}
