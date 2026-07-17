import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/* ================================================================
   JL-199 — inline label edit (rename/recolor) in LabelPicker
   ================================================================ */

vi.mock('../api/labelApi', () => ({
  updateLabel: vi.fn(),
}))

import LabelPicker from '../components/issues/LabelPicker'
import { updateLabel } from '../api/labelApi'

beforeEach(() => {
  vi.clearAllMocks()
})

function setup(overrides = {}) {
  const onCatalogLabelUpdated = vi.fn()
  const projectLabels = [{ id: 5, name: 'frontend', color: '#0052CC' }]
  render(
    <LabelPicker
      labels={[]}
      projectLabels={projectLabels}
      projectId={1}
      labelInput=""
      onLabelInputChange={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onRemove={() => {}}
      onCatalogLabelUpdated={onCatalogLabelUpdated}
      {...overrides}
    />,
  )
  return { onCatalogLabelUpdated }
}

describe('LabelPicker inline edit', () => {
  it('renames a catalog label and calls updateLabel + reflects the change', async () => {
    updateLabel.mockResolvedValue({ id: 5, project_id: 1, name: 'ui', color: '#0052CC', issueCount: 0 })
    const { onCatalogLabelUpdated } = setup()

    // Open the inline editor for the "frontend" label
    fireEvent.click(screen.getByRole('button', { name: /edit label frontend/i }))

    const nameInput = screen.getByLabelText('Label name')
    fireEvent.change(nameInput, { target: { value: 'ui' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLabel).toHaveBeenCalledWith(1, 5, { name: 'ui', color: '#0052CC' })
    })
    expect(onCatalogLabelUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, name: 'ui', color: '#0052CC' }),
    )
  })

  it('recolors a catalog label and passes the new color to updateLabel', async () => {
    updateLabel.mockResolvedValue({ id: 5, project_id: 1, name: 'frontend', color: '#ff5630', issueCount: 0 })
    setup()

    fireEvent.click(screen.getByRole('button', { name: /edit label frontend/i }))
    fireEvent.change(screen.getByLabelText('Label color'), { target: { value: '#ff5630' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLabel).toHaveBeenCalledWith(1, 5, { name: 'frontend', color: '#ff5630' })
    })
  })

  it('shows a validation error and does not call updateLabel on an empty name', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /edit label frontend/i }))
    fireEvent.change(screen.getByLabelText('Label name'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/name is required/i)
    expect(updateLabel).not.toHaveBeenCalled()
  })

  it('surfaces a server error (e.g. duplicate name) without crashing', async () => {
    updateLabel.mockRejectedValue(Object.assign(new Error('409'), { data: { error: 'A label with that name already exists in this project' } }))
    setup()

    fireEvent.click(screen.getByRole('button', { name: /edit label frontend/i }))
    fireEvent.change(screen.getByLabelText('Label name'), { target: { value: 'backend' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i)
  })
})
