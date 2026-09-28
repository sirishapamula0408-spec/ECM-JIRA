import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

/* ================================================================
   JL-108 / JL-109 — the version history panel.

   The behaviour worth pinning is the part a reader has to trust:
   that Restore is additive rather than destructive, that comparing
   is over two chosen versions in the right order, and that an empty
   diff explains itself instead of looking broken.
   ================================================================ */

const { api } = vi.hoisted(() => ({
  api: {
    fetchWikiVersions: vi.fn(),
    restoreWikiVersion: vi.fn(),
    compareWikiVersions: vi.fn(),
  },
}))

vi.mock('../api/wikiApi', () => api)

import { VersionHistoryPanel } from '../components/wiki/VersionHistoryPanel'

const VERSIONS = [
  { id: 30, version_number: 3, title: 'Runbook', edited_by: 'jo@x.com', created_at: '2026-09-03T00:00:00Z' },
  { id: 20, version_number: 2, title: 'Runbook', edited_by: 'sam@x.com', created_at: '2026-09-02T00:00:00Z' },
  { id: 10, version_number: 1, title: 'Runbook', edited_by: 'jo@x.com', created_at: '2026-09-01T00:00:00Z' },
]

const DIFF = {
  from: { versionNumber: 1, title: 'Runbook' },
  to: { versionNumber: 3, title: 'Runbook' },
  titleChanged: false,
  diff: [
    { type: 'same', text: 'alpha' },
    { type: 'removed', text: 'beta' },
    { type: 'added', text: 'gamma' },
  ],
  summary: { added: 1, removed: 1, unchanged: 1 },
}

const renderPanel = (props = {}) =>
  render(
    <VersionHistoryPanel pageId={1} currentVersion={3} canEdit {...props} />,
  )

/** Tick the checkbox on the row for a given version number. */
async function pick(versionNumber) {
  fireEvent.click(await screen.findByLabelText(`Select version ${versionNumber} to compare`))
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchWikiVersions.mockResolvedValue(VERSIONS)
  api.compareWikiVersions.mockResolvedValue(DIFF)
  api.restoreWikiVersion.mockResolvedValue({ id: 1, version: 4, restoredFrom: 1 })
})

describe('JL-106 the list', () => {
  it('shows each version with its author', async () => {
    renderPanel()
    expect(await screen.findByText('v3')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    /*
     * Asserted on the row's text rather than with a text matcher: the author
     * sits beside a <RelativeTime> and a separator, so the name is its own
     * text node, and displayNameFromEmail title-cases it.
     */
    const row = screen.getByText('v2').closest('li')
    expect(row.textContent.toLowerCase()).toContain('sam')
  })

  it('marks which version the page is currently on', async () => {
    renderPanel()
    expect(await screen.findByText('Current')).toBeInTheDocument()
  })

  it('says the history failed to load rather than showing an empty list', async () => {
    // An empty list is the claim "no history exists", which is different.
    api.fetchWikiVersions.mockRejectedValue(new Error('nope'))
    renderPanel()
    expect(await screen.findByText(/nope|could not load/i)).toBeInTheDocument()
  })
})

describe('JL-108 restore', () => {
  it('offers no Restore for the version already in force', async () => {
    renderPanel()
    await screen.findByText('v3')
    const currentRow = screen.getByText('v3').closest('li')
    expect(within(currentRow).queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('offers Restore on the older versions', async () => {
    renderPanel()
    await screen.findByText('v1')
    const row = screen.getByText('v1').closest('li')
    expect(within(row).getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })

  it('offers none at all to someone who cannot edit', async () => {
    renderPanel({ canEdit: false })
    await screen.findByText('v1')
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('confirms first, and says the restore is additive', async () => {
    /*
     * "Restore" reads as destructive, so people hesitate. The copy has to say
     * that nothing is erased — otherwise the safest feature in the history
     * panel is the one nobody uses.
     */
    renderPanel()
    await screen.findByText('v1')
    fireEvent.click(within(screen.getByText('v1').closest('li')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText(/does not erase anything/i)).toBeInTheDocument()
    expect(api.restoreWikiVersion).not.toHaveBeenCalled()
  })

  it('restores once confirmed, by version ROW id', async () => {
    renderPanel()
    await screen.findByText('v1')
    fireEvent.click(within(screen.getByText('v1').closest('li')).getByRole('button', { name: 'Restore' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' , exact: true }))
    await waitFor(() => expect(api.restoreWikiVersion).toHaveBeenCalledWith(1, 10))
  })

  it('reloads the history afterwards, since it just gained a version', async () => {
    renderPanel()
    await screen.findByText('v1')
    fireEvent.click(within(screen.getByText('v1').closest('li')).getByRole('button', { name: 'Restore' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore', exact: true }))
    await waitFor(() => expect(api.fetchWikiVersions).toHaveBeenCalledTimes(2))
  })
})

describe('JL-109 compare', () => {
  it('needs two versions before it will run', async () => {
    renderPanel()
    await screen.findByText('v3')
    expect(screen.getByRole('button', { name: 'Compare selected' })).toBeDisabled()
    await pick(1)
    expect(screen.getByRole('button', { name: 'Compare selected' })).toBeDisabled()
    await pick(3)
    expect(screen.getByRole('button', { name: 'Compare selected' })).toBeEnabled()
  })

  it('compares oldest→newest regardless of tick order', async () => {
    renderPanel()
    await screen.findByText('v3')
    await pick(3)
    await pick(1)
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected' }))
    await waitFor(() => expect(api.compareWikiVersions).toHaveBeenCalledWith(1, 1, 3))
  })

  it('keeps only the last two ticks — comparing three is not a thing', async () => {
    renderPanel()
    await screen.findByText('v3')
    await pick(1)
    await pick(2)
    await pick(3)
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected' }))
    await waitFor(() => expect(api.compareWikiVersions).toHaveBeenCalledWith(1, 2, 3))
  })

  it('renders added and removed lines', async () => {
    renderPanel()
    await screen.findByText('v3')
    await pick(1)
    await pick(3)
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected' }))
    expect(await screen.findByText('gamma')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText(/1 added · 1 removed/)).toBeInTheDocument()
  })

  it('explains an empty diff instead of showing an empty box', async () => {
    api.compareWikiVersions.mockResolvedValue({
      ...DIFF, diff: [{ type: 'same', text: 'alpha' }], summary: { added: 0, removed: 0, unchanged: 1 },
    })
    renderPanel()
    await screen.findByText('v3')
    await pick(1)
    await pick(3)
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected' }))
    expect(await screen.findByText(/No text changed/i)).toBeInTheDocument()
    expect(screen.getByText(/Formatting-only edits are not shown/i)).toBeInTheDocument()
  })

  it('reports a rename, which the body diff cannot show', async () => {
    api.compareWikiVersions.mockResolvedValue({
      ...DIFF,
      titleChanged: true,
      from: { versionNumber: 1, title: 'Old name' },
      to: { versionNumber: 3, title: 'New name' },
    })
    renderPanel()
    await screen.findByText('v3')
    await pick(1)
    await pick(3)
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected' }))
    expect(await screen.findByText(/Old name/)).toBeInTheDocument()
    expect(screen.getByText(/New name/)).toBeInTheDocument()
  })

  it('surfaces a compare failure', async () => {
    api.compareWikiVersions.mockRejectedValue(new Error('diff exploded'))
    renderPanel()
    await screen.findByText('v3')
    await pick(1)
    await pick(3)
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected' }))
    expect(await screen.findByText('diff exploded')).toBeInTheDocument()
  })
})
