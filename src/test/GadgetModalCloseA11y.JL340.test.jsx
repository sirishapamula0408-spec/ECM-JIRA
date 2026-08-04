import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GadgetConfigModal } from '../components/dashboard/GadgetConfigModal'
import { AddGadgetModal } from '../components/dashboard/AddGadgetModal'

// JL-340: the icon-only close buttons in the dashboard modals had no accessible
// name (bare <svg>, no aria-label), so screen readers announced them as an
// anonymous "button". They now follow the CreateIssueModal convention:
// type="button" + aria-label="Close".

describe('JL-340: GadgetConfigModal close button accessibility', () => {
  const gadget = { id: 'g1', type: 'bar', title: 'My Gadget', config: {} }

  it('exposes the close button with an accessible name of "Close"', () => {
    render(<GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={vi.fn()} />)
    const closeBtn = screen.getByRole('button', { name: /close/i })
    expect(closeBtn).toBeInTheDocument()
    expect(closeBtn).toHaveAttribute('type', 'button')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('JL-340: AddGadgetModal close button accessibility', () => {
  it('exposes the close button with an accessible name of "Close"', () => {
    render(<AddGadgetModal onAdd={vi.fn()} onClose={vi.fn()} />)
    const closeBtn = screen.getByRole('button', { name: /close/i })
    expect(closeBtn).toBeInTheDocument()
    expect(closeBtn).toHaveAttribute('type', 'button')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<AddGadgetModal onAdd={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
