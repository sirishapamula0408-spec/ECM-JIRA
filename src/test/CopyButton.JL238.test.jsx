import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopyButton } from '../components/common/CopyButton'

describe('CopyButton (JL-238)', () => {
  let writeText

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  afterEach(() => {
    delete navigator.clipboard
  })

  it('renders a real button with an accessible label', () => {
    render(<CopyButton value="JL-123" ariaLabel="Copy issue key JL-123" />)
    expect(screen.getByRole('button', { name: 'Copy issue key JL-123' })).toBeInTheDocument()
  })

  it('falls back to the title for the accessible name', () => {
    render(<CopyButton value="x" title="Copy issue link" />)
    expect(screen.getByRole('button', { name: 'Copy issue link' })).toBeInTheDocument()
  })

  it('copies the given value to the clipboard on click', async () => {
    render(<CopyButton value="JL-123" ariaLabel="Copy issue key JL-123" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy issue key JL-123' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith('JL-123')
  })

  it('shows "Copied!" feedback after copying', async () => {
    render(<CopyButton value="JL-7" ariaLabel="Copy issue key JL-7" />)

    const button = screen.getByRole('button', { name: 'Copy issue key JL-7' })
    fireEvent.mouseOver(button)
    fireEvent.click(button)

    expect(await screen.findByText('Copied!')).toBeInTheDocument()
  })

  it('does not propagate the click to a parent row/card', async () => {
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick} data-testid="row">
        <CopyButton value="JL-9" ariaLabel="Copy issue key JL-9" />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy issue key JL-9' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('JL-9'))
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('does not throw when the clipboard write fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    render(<CopyButton value="JL-1" ariaLabel="Copy issue key JL-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy issue key JL-1' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('JL-1'))
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
  })
})
