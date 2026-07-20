import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmDialog, useConfirm } from '../components/common/ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders title and message when open', () => {
    render(
      <ConfirmDialog
        open
        title="Delete issue?"
        message="This cannot be undone."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Delete issue?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('does not render dialog content when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete issue?"
        message="Hidden"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.queryByText('Delete issue?')).not.toBeInTheDocument()
  })

  it('fires onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="Sure?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('fires onCancel when the cancel button is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="Sure?" cancelLabel="Cancel" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open title="Sure?" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders the danger variant with an error-colored confirm button', () => {
    render(
      <ConfirmDialog open title="Delete?" confirmLabel="Delete" danger onConfirm={() => {}} onCancel={() => {}} />,
    )
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn.className).toMatch(/colorError/)
  })

  it('disables both buttons while busy', () => {
    render(
      <ConfirmDialog open title="Working" confirmLabel="Delete" cancelLabel="Cancel" busy onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

// Smoke test for the promise-based useConfirm() hook used by adopted pages.
function ConfirmHarness() {
  const { confirm, confirmDialog } = useConfirm()
  const [result, setResult] = useState('idle')
  return (
    <div>
      <button
        type="button"
        onClick={async () => setResult((await confirm({ title: 'Proceed?', confirmLabel: 'Yes' })) ? 'confirmed' : 'cancelled')}
      >
        trigger
      </button>
      <span data-testid="result">{result}</span>
      {confirmDialog}
    </div>
  )
}

describe('useConfirm', () => {
  it('resolves true when confirmed', async () => {
    render(<ConfirmHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('confirmed'))
  })

  it('resolves false when cancelled', async () => {
    render(<ConfirmHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('cancelled'))
  })
})
