// JL-451 (client) — a translated value must be VISIBLE before the user commits.
//
// The server maps foreign values onto this app's set — "In Prod" becomes
// "Done", "Highest" becomes "High" — rather than rejecting the row. That is
// only defensible if the user can see it happen and decline. A silent remap
// would be worse than the rejection it replaces, because the data would be
// quietly wrong instead of loudly absent.
//
// So these tests are about the REPORTING, not the mapping. The mapping itself
// is covered server-side in import-value-mapping-JL451.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }))
vi.mock('../api/client.js', () => ({ api: mockApi }))

import { ImportExportModal } from '../components/issues/ImportExportModal'

const renderModal = () =>
  render(<ImportExportModal projectId={1} onClose={vi.fn()} initialTab="import" />)

/** A dry-run response shaped like the real one. */
const previewWith = (warnings, errors = []) => ({
  dryRun: true,
  totalRows: 3,
  valid: 3 - errors.length,
  invalid: errors.length,
  errors,
  warnings,
  warningCount: warnings.length,
  preview: [],
})

describe('JL-451 — translated values are shown before commit', () => {
  beforeEach(() => mockApi.mockReset())

  async function previewCsv(response) {
    mockApi.mockResolvedValueOnce(response)
    const view = renderModal()
    fireEvent.change(view.container.querySelector('.ie-textarea'), {
      target: { value: 'title,status\na,In Prod\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Preview \(dry run\)/ }))
    await waitFor(() => expect(view.container.querySelector('.ie-preview')).toBeTruthy())
    return view
  }

  it('lists every mapping with the row, the original and the result', async () => {
    await previewCsv(previewWith([
      { row: 2, field: 'status', from: 'In Prod', to: 'Done' },
      { row: 3, field: 'priority', from: 'Highest', to: 'High' },
    ]))
    // The user has to be able to see WHICH row and WHAT it became — a count
    // alone ("2 translated") would not let anyone judge whether to proceed.
    expect(screen.getByText(/Row 2:/)).toBeInTheDocument()
    expect(screen.getByText('In Prod')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText(/Row 3:/)).toBeInTheDocument()
    expect(screen.getByText('Highest')).toBeInTheDocument()
  })

  it('counts them in the summary line', async () => {
    const { container } = await previewCsv(previewWith([
      { row: 2, field: 'status', from: 'In Prod', to: 'Done' },
    ]))
    expect(container.querySelector('.ie-preview').textContent).toMatch(/1.*translated/)
  })

  it('shows nothing when nothing was translated', async () => {
    const { container } = await previewCsv(previewWith([]))
    expect(container.querySelector('.ie-warnings')).toBeNull()
    expect(container.querySelector('.ie-preview').textContent).not.toMatch(/translated/)
  })

  it('keeps translations separate from rejections', async () => {
    // Amber vs red. A mapped row still imports; a rejected one does not, and
    // collapsing the two would misrepresent both.
    const { container } = await previewCsv(previewWith(
      [{ row: 2, field: 'status', from: 'In Prod', to: 'Done' }],
      [{ row: 4, errors: ['invalid status "Banana"'] }],
    ))
    expect(container.querySelector('.ie-warnings')).toBeTruthy()
    expect(container.querySelector('.ie-errors')).toBeTruthy()
    expect(container.querySelector('.ie-warnings').textContent).not.toMatch(/Banana/)
    expect(container.querySelector('.ie-errors').textContent).toMatch(/Banana/)
  })

  it('still allows the commit — a translation is not a blocker', async () => {
    await previewCsv(previewWith([{ row: 2, field: 'status', from: 'In Prod', to: 'Done' }]))
    const commit = screen.getByRole('button', { name: /Import 3 issue/ })
    expect(commit).toBeEnabled()
  })
})
