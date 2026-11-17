// Import modal — "Keep original issue keys" (Atlassian Jira migration).
// The server-side rules live in server/__tests__/import-preserve-keys.test.js;
// these cover the option reaching the API and the kept keys being shown.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }))
vi.mock('../api/client.js', () => ({ api: mockApi }))

import { ImportExportModal } from '../components/issues/ImportExportModal'

const JIRA_CSV = 'Summary,Issue key\nLogin fails,ECM-12\nAdd SSO,ECM-40\n'

const preview = {
  dryRun: true, totalRows: 2, valid: 2, invalid: 0, errors: [], warnings: [], warningCount: 0,
  preserveKeys: true,
  preview: [{ title: 'Login fails', issue_key: 'ECM-12' }, { title: 'Add SSO', issue_key: 'ECM-40' }],
}

const bodyOf = (call) => JSON.parse(call[1].body)

function setup() {
  const view = render(<ImportExportModal projectId={1} onClose={vi.fn()} initialTab="import" />)
  fireEvent.change(view.container.querySelector('.ie-textarea'), { target: { value: JIRA_CSV } })
  return view
}

const keepKeys = () => screen.getByRole('checkbox', { name: /Keep original issue keys/ })

describe('Import — keep original issue keys', () => {
  beforeEach(() => mockApi.mockReset())

  it('is off by default and sends preserveKeys:false', async () => {
    mockApi.mockResolvedValueOnce({ ...preview, preserveKeys: false })
    setup()
    expect(keepKeys()).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /Preview \(dry run\)/ }))
    await waitFor(() => expect(mockApi).toHaveBeenCalled())
    expect(bodyOf(mockApi.mock.calls[0]).preserveKeys).toBe(false)
  })

  it('sends preserveKeys on preview and commit, shows kept keys and the next key', async () => {
    mockApi
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({ dryRun: false, created: 2, keys: [], nextKey: 'ECM-41' })
    setup()
    fireEvent.click(keepKeys())
    fireEvent.click(screen.getByRole('button', { name: /Preview \(dry run\)/ }))
    await screen.findByText(/Keys kept as-is: ECM-12, ECM-40/)
    expect(bodyOf(mockApi.mock.calls[0]).preserveKeys).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Import 2 issue/ }))
    await screen.findByText(/next new issue will be ECM-41/)
    expect(bodyOf(mockApi.mock.calls[1])).toMatchObject({ dryRun: false, preserveKeys: true })
  })

  it('toggling the option discards a preview validated under the other rule', async () => {
    mockApi.mockResolvedValueOnce(preview)
    const view = setup()
    fireEvent.click(keepKeys())
    fireEvent.click(screen.getByRole('button', { name: /Preview \(dry run\)/ }))
    await waitFor(() => expect(view.container.querySelector('.ie-preview')).toBeTruthy())
    fireEvent.click(keepKeys())
    expect(view.container.querySelector('.ie-preview')).toBeNull()
    expect(screen.getByRole('button', { name: /^Import issue/ })).toBeDisabled()
  })
})
