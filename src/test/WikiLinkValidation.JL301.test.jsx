// JL-301: linking an issue from the Wiki must show a clear error for
// invalid/non-existent issue keys and success feedback when the link works.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../api/wikiApi', () => ({
  fetchWikiPages: vi.fn(),
  fetchWikiPage: vi.fn(),
  createWikiPage: vi.fn(),
  updateWikiPage: vi.fn(),
  deleteWikiPage: vi.fn(),
  searchWikiPages: vi.fn(),
  fetchWikiVersions: vi.fn(),
  fetchWikiVersion: vi.fn(),
  linkIssueToWiki: vi.fn(),
  unlinkIssueFromWiki: vi.fn(),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    loaded: true, isAdmin: true, isOwner: false,
    canCreateIssue: true, canEditIssue: true, canDeleteIssue: true,
    canManageSprints: true, canManageProjectSettings: true,
    canManageMembers: true, canInviteMembers: true,
    canEditWorkflows: true, canAddComment: true,
    workspaceRole: 'Admin',
  }),
}))

import { WikiPage } from '../pages/WikiPage/WikiPage'
import { fetchWikiPages, fetchWikiPage, linkIssueToWiki } from '../api/wikiApi'

const basePage = {
  id: 1,
  project_id: 1,
  title: 'Test Page',
  content: 'Hello',
  parent_id: null,
  created_by: 'test@test.com',
  updated_at: '2026-07-01T00:00:00Z',
  children: [],
  linkedIssues: [],
}

function renderWiki() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/wiki']}>
      <Routes>
        <Route path="/projects/:projectId/wiki" element={<WikiPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openPage() {
  renderWiki()
  const pageButton = await screen.findByText('Test Page')
  fireEvent.click(pageButton)
  await screen.findByText('Linked Issues')
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchWikiPages.mockResolvedValue([{ id: 1, title: 'Test Page', parent_id: null }])
  fetchWikiPage.mockResolvedValue(basePage)
})

describe('Wiki issue-link validation (JL-301)', () => {
  it('shows a client-side error for a malformed issue key like "tp1"', async () => {
    await openPage()

    fireEvent.change(screen.getByLabelText('Issue key or ID to link'), { target: { value: 'tp1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('"tp1" is not a valid issue key or ID')
    expect(linkIssueToWiki).not.toHaveBeenCalled()
  })

  it('shows the backend error when the issue key does not exist', async () => {
    const err = new Error('Issue TP-99 not found')
    err.status = 404
    linkIssueToWiki.mockRejectedValue(err)
    await openPage()

    fireEvent.change(screen.getByLabelText('Issue key or ID to link'), { target: { value: 'TP-99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Issue TP-99 not found')
    expect(linkIssueToWiki).toHaveBeenCalledWith(1, 'TP-99')
  })

  it('shows success feedback and the linked issue after a successful link', async () => {
    linkIssueToWiki.mockResolvedValue({ success: true, issueId: 5, issueKey: 'TP-5' })
    await openPage()

    // After linking, the refreshed page contains the new linked issue
    fetchWikiPage.mockResolvedValue({
      ...basePage,
      linkedIssues: [{ link_id: 1, issue_id: 5, issue_key: 'TP-5', issue_title: 'Linked issue title' }],
    })

    fireEvent.change(screen.getByLabelText('Issue key or ID to link'), { target: { value: 'TP-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    await waitFor(() => expect(linkIssueToWiki).toHaveBeenCalledWith(1, 'TP-5'))
    expect(await screen.findByText('Issue TP-5 linked to this page.')).toBeInTheDocument()
    expect(await screen.findByText('TP-5')).toBeInTheDocument()
    expect(screen.getByText('Linked issue title')).toBeInTheDocument()
  })
})
