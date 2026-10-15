import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* ================================================================
   JL-199 — the Users table must fit its box at 1400 px.

   JL-195's Projects & roles column pushed the table 56 px past its box,
   because long unbroken names/emails (authtest_1790311961272@gmail.com)
   held Name and Email at full length. jsdom cannot measure layout, so this
   pins the pieces that make it fit; the widths themselves were measured in
   the running app (tmp-shots/scenarios/verify-table-width.mjs).
   ================================================================ */

vi.mock('../api/memberApi', () => ({
  fetchMembersPage: vi.fn(),
  fetchUserAuditLog: vi.fn(() => Promise.resolve([])),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
}))

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import { MemberProvider } from '../context/MemberProvider'
import { fetchMembersPage } from '../api/memberApi'

const LONG_EMAIL = 'authtest_1790311961272@gmail.com'

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <UserManagementPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

describe('UserManagementPage — table width (JL-199)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembersPage.mockResolvedValue({
      items: [
        { id: 1, name: 'authtest_1790311961272', email: LONG_EMAIL, role: 'Viewer', status: 'Active', projectRoles: [] },
        { id: 2, name: 'Plain Name', email: 'noat-address', role: 'Member', status: 'Active', projectRoles: [] },
      ],
      total: 2, limit: 25, offset: 0,
    })
  })

  it('lets a long email break after the @ without changing its text', async () => {
    renderPage()
    const cell = await screen.findByText(LONG_EMAIL)
    expect(cell).toHaveClass('user-management-email-cell')
    expect(cell.textContent).toBe(LONG_EMAIL)
    const wbr = cell.querySelector('wbr')
    expect(wbr).not.toBeNull()
    expect(wbr.previousSibling.textContent).toBe('authtest_1790311961272@')
  })

  it('leaves a value with no @ untouched', async () => {
    renderPage()
    const cell = await screen.findByText('noat-address')
    expect(cell.querySelector('wbr')).toBeNull()
  })

  it('declares the wrap rules the layout depends on', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const css = fs.readFileSync(path.join(here, '../pages/UserManagementPage/UserManagementPage.css'), 'utf8')
    const rule = (selector) => {
      const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
      return m ? m[1] : ''
    }
    // 'anywhere', not 'break-word': only 'anywhere' lowers the column's
    // minimum width, which is what lets the table shrink to fit.
    expect(rule('.user-management-email-cell')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule('.user-management-email-cell')).toMatch(/min-width:\s*200px/)
    // JL-203: names no longer wrap — one line, ending in an ellipsis only when
    // the Name column (which takes the leftover width) is too narrow.
    expect(rule('.user-management-name-cell strong.user-management-name')).toMatch(/white-space:\s*nowrap/)
    expect(rule('.user-management-name-cell strong.user-management-name')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.user-management-name-td')).toMatch(/max-width:\s*0/)
  })
})
