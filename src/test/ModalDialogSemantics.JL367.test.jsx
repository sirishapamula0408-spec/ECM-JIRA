import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { GadgetConfigModal } from '../components/dashboard/GadgetConfigModal'
import { AddGadgetModal } from '../components/dashboard/AddGadgetModal'

// JL-367: the dashboard gadget modals had no dialog semantics at all — no
// role="dialog"/aria-modal/accessible name, no Escape-to-close, no focus
// management. A keyboard or screen-reader user could Tab straight out of the
// open modal into the page behind it. These tests pin the full contract:
// role + name, Escape closes (including from inside a text input), focus
// moves into the dialog on open, focus RETURNS to the invoking trigger on
// close, and Tab/Shift+Tab wrap instead of escaping.

const gadget = { id: 'g1', type: 'bar', title: 'My Gadget', config: {} }

/**
 * Harness that opens/closes the modal from a real trigger button, so we can
 * assert focus restoration back to the invoker — the part most often skipped.
 */
function ConfigHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open config</button>
      {open && (
        <GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function AddHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open add gadget</button>
      {open && <AddGadgetModal onAdd={vi.fn()} onClose={() => setOpen(false)} />}
    </>
  )
}

describe('JL-367: GadgetConfigModal dialog semantics', () => {
  it('exposes role="dialog" with aria-modal and an accessible name', () => {
    render(<GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: /configure gadget/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape pressed inside a text input', () => {
    const onClose = vi.fn()
    render(<GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(screen.getByDisplayValue('My Gadget'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when an inner control already handled Escape (defaultPrevented)', () => {
    const onClose = vi.fn()
    render(<GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={onClose} />)
    const input = screen.getByDisplayValue('My Gadget')
    input.addEventListener('keydown', (e) => e.preventDefault())
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('moves focus into the dialog on open', () => {
    render(<ConfigHarness />)
    fireEvent.click(screen.getByRole('button', { name: /open config/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('restores focus to the invoking trigger on close', () => {
    render(<ConfigHarness />)
    const trigger = screen.getByRole('button', { name: /open config/i })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('wraps Tab from the last focusable element back to the first', () => {
    render(<GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={vi.fn()} />)
    const save = screen.getByRole('button', { name: /save/i })
    save.focus()
    fireEvent.keyDown(save, { key: 'Tab' })
    // First focusable in DOM order is the JL-340 close button.
    expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()
  })

  it('wraps Shift+Tab from the first focusable element back to the last', () => {
    render(<GadgetConfigModal gadget={gadget} onSave={vi.fn()} onClose={vi.fn()} />)
    const close = screen.getByRole('button', { name: /close/i })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: /save/i })).toHaveFocus()
  })
})

describe('JL-367: AddGadgetModal dialog semantics', () => {
  it('exposes role="dialog" with aria-modal and an accessible name', () => {
    render(<AddGadgetModal onAdd={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: /add a gadget/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<AddGadgetModal onAdd={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the dialog on open', () => {
    render(<AddHarness />)
    fireEvent.click(screen.getByRole('button', { name: /open add gadget/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('restores focus to the invoking trigger on close', () => {
    render(<AddHarness />)
    const trigger = screen.getByRole('button', { name: /open add gadget/i })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('wraps Tab from the last focusable element back to the first', () => {
    render(<AddGadgetModal onAdd={vi.fn()} onClose={vi.fn()} />)
    // Last focusable is the final gadget card (Sprint Burndown).
    const last = screen.getByRole('button', { name: /sprint burndown/i })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()
  })

  it('wraps Shift+Tab from the first focusable element back to the last', () => {
    render(<AddGadgetModal onAdd={vi.fn()} onClose={vi.fn()} />)
    const close = screen.getByRole('button', { name: /close/i })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: /sprint burndown/i })).toHaveFocus()
  })
})
