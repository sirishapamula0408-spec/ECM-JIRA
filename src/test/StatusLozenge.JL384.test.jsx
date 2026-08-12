import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { StatusLozenge } from '../components/common/StatusLozenge'

const TRANSITIONS = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']

function renderLozenge(props = {}) {
  return render(
    <StatusLozenge status="To Do" transitions={TRANSITIONS} onChange={() => {}} {...props} />,
  )
}

async function openMenu(name = /Status/) {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.findByRole('menu')
}

describe('StatusLozenge (JL-384)', () => {
  it('renders a lozenge, not a native <select>', () => {
    const { container } = renderLozenge()

    expect(container.querySelector('select')).toBeNull()
    const trigger = screen.getByRole('button', { name: /To Do/ })
    expect(trigger).toHaveClass('status-lozenge')
    expect(trigger.tagName).toBe('BUTTON')
  })

  it('shows the current status text', () => {
    renderLozenge({ status: 'Code Review' })
    expect(screen.getByText('Code Review')).toBeInTheDocument()
  })

  it('exposes an accessible name that includes the current status', () => {
    renderLozenge({ status: 'In Progress' })
    expect(screen.getByRole('button', { name: 'Status: In Progress' })).toBeInTheDocument()
  })

  it('includes caller context in the accessible name when given', () => {
    renderLozenge({ status: 'Done', context: 'JL-12' })
    expect(screen.getByRole('button', { name: 'Status for JL-12: Done' })).toBeInTheDocument()
  })

  it('advertises itself as a menu trigger and reflects expanded state', async () => {
    renderLozenge()
    const trigger = screen.getByRole('button', { name: /To Do/ })

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    await screen.findByRole('menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens the transition menu on click', async () => {
    renderLozenge()
    expect(screen.queryByRole('menu')).toBeNull()

    const menu = await openMenu()

    for (const status of TRANSITIONS) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(status) })).toBeInTheDocument()
    }
  })

  it('fires the change callback with the newly selected status', async () => {
    const onChange = vi.fn()
    renderLozenge({ onChange })

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /In Progress/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('In Progress')
  })

  it('does not fire the callback when the current status is re-selected', async () => {
    const onChange = vi.fn()
    renderLozenge({ status: 'To Do', onChange })

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^To Do/ }))

    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('opens on Enter and closes on Escape', async () => {
    renderLozenge()
    const trigger = screen.getByRole('button', { name: /To Do/ })

    fireEvent.keyDown(trigger, { key: 'Enter' })
    const menu = await screen.findByRole('menu')

    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('opens on Space', async () => {
    renderLozenge()
    fireEvent.keyDown(screen.getByRole('button', { name: /To Do/ }), { key: ' ' })
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('opens on ArrowDown', async () => {
    renderLozenge()
    fireEvent.keyDown(screen.getByRole('button', { name: /To Do/ }), { key: 'ArrowDown' })
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('supports arrow-key navigation inside the menu', async () => {
    renderLozenge()
    const menu = await openMenu()
    const items = within(menu).getAllByRole('menuitem')

    await waitFor(() => expect(items.some((item) => item === document.activeElement)).toBe(true))
    const startIndex = items.indexOf(document.activeElement)

    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(items[startIndex + 1]))

    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    await waitFor(() => expect(document.activeElement).toBe(items[startIndex]))
  })

  it('is reachable by keyboard (the trigger is a real focusable button)', () => {
    renderLozenge()
    const trigger = screen.getByRole('button', { name: /To Do/ })
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
  })

  it('can be opened and driven entirely from the keyboard', async () => {
    const onChange = vi.fn()
    renderLozenge({ onChange })

    // Open with Enter, walk to the next option with ArrowDown, activate it.
    fireEvent.keyDown(screen.getByRole('button', { name: /To Do/ }), { key: 'Enter' })
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')

    await waitFor(() => expect(items).toContain(document.activeElement))
    const next = items[items.indexOf(document.activeElement) + 1]
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(next))

    fireEvent.click(document.activeElement)
    expect(onChange).toHaveBeenCalledWith(next.textContent.trim())
  })

  describe('read-only variant', () => {
    it('renders no menu control and no native select', () => {
      const { container } = renderLozenge({ status: 'Done', readOnly: true })

      expect(container.querySelector('select')).toBeNull()
      expect(screen.queryByRole('button')).toBeNull()
      expect(screen.getByText('Done')).toBeInTheDocument()
    })

    it('is not focusable as a control', () => {
      const { container } = renderLozenge({ status: 'Done', readOnly: true })
      const lozenge = container.querySelector('.status-lozenge')

      expect(lozenge.tagName).toBe('SPAN')
      expect(lozenge).not.toHaveAttribute('tabindex')
      expect(lozenge).toHaveClass('status-lozenge-readonly')
    })

    it('fires nothing and opens nothing when clicked', async () => {
      const onChange = vi.fn()
      const { container } = renderLozenge({ status: 'Done', readOnly: true, onChange })

      fireEvent.click(container.querySelector('.status-lozenge'))

      expect(onChange).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    })

    it('still carries the status in its accessible name', () => {
      renderLozenge({ status: 'In Progress', readOnly: true, context: 'JL-9' })
      expect(screen.getByLabelText('Status for JL-9: In Progress')).toBeInTheDocument()
    })
  })

  describe('colour category (reuses the board column source)', () => {
    // The category class is what carries the colour: the stylesheet paints
    // `-cat-done` / `-cat-inprogress` from the same --jira-success / --jira-blue
    // tokens the board's .kanban-col-cat-* rules use.
    function categoryOf(props) {
      const { container, unmount } = renderLozenge(props)
      const lozenge = container.querySelector('.status-lozenge')
      const match = [...lozenge.classList].find((cls) => cls.startsWith('status-lozenge-cat-'))
      unmount()
      return match.replace('status-lozenge-cat-', '')
    }

    it('matches the board fallback inference when no category map is supplied', () => {
      expect(categoryOf({ status: 'Done' })).toBe('done')
      expect(categoryOf({ status: 'In Progress' })).toBe('inprogress')
      expect(categoryOf({ status: 'Code Review' })).toBe('inprogress')
      expect(categoryOf({ status: 'To Do' })).toBe('neutral')
      expect(categoryOf({ status: 'Backlog' })).toBe('neutral')
    })

    it('keeps cancellation statuses neutral, like the board columns', () => {
      expect(categoryOf({ status: 'Cancelled', categoryMap: { Cancelled: 'done' } })).toBe('neutral')
    })

    it('honours the per-project name→category map the board loads', () => {
      const categoryMap = { 'In Testing': 'inprogress', Shipped: 'done' }

      expect(categoryOf({ status: 'Shipped', categoryMap })).toBe('done')
      expect(categoryOf({ status: 'In Testing', categoryMap })).toBe('inprogress')
    })

    it('applies the category class to the read-only variant too', () => {
      expect(categoryOf({ status: 'In Progress', readOnly: true })).toBe('inprogress')
    })
  })

  describe('degrades gracefully', () => {
    it('renders without throwing when the status is missing', () => {
      expect(() => renderLozenge({ status: undefined })).not.toThrow()
      expect(screen.getByText('No status')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Status: No status' })).toBeInTheDocument()
    })

    it('renders an unknown status neutrally without throwing', () => {
      const { container } = renderLozenge({ status: 'Totally Unknown State' })

      expect(screen.getByText('Totally Unknown State')).toBeInTheDocument()
      expect(container.querySelector('.status-lozenge')).toHaveClass('status-lozenge-cat-neutral')
    })

    it('survives a null status and a missing transitions list', async () => {
      expect(() => render(<StatusLozenge status={null} transitions={null} />)).not.toThrow()
      const menu = await openMenu()
      expect(within(menu).queryAllByRole('menuitem')).toHaveLength(0)
    })

    it('does not throw when a transition is chosen with no onChange handler', async () => {
      render(<StatusLozenge status="To Do" transitions={TRANSITIONS} />)
      const menu = await openMenu()
      expect(() => fireEvent.click(within(menu).getByRole('menuitem', { name: /Done/ }))).not.toThrow()
    })

    it('does not let its click bubble to a surrounding card or row', async () => {
      const onRowClick = vi.fn()
      render(
        <div onClick={onRowClick}>
          <StatusLozenge status="To Do" transitions={TRANSITIONS} onChange={() => {}} />
        </div>,
      )

      fireEvent.click(screen.getByRole('button', { name: /To Do/ }))
      await screen.findByRole('menu')

      expect(onRowClick).not.toHaveBeenCalled()
    })
  })
})
