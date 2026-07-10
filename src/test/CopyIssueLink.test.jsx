import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopyIssueLinkButton } from '../pages/IssueDetailPage/IssueDetailPage'

describe('CopyIssueLinkButton (JL-161)', () => {
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

  it('renders a copy button with an accessible label', () => {
    render(<CopyIssueLinkButton issueId={42} />)
    expect(screen.getByRole('button', { name: 'Copy issue link' })).toBeInTheDocument()
  })

  it('copies the issue URL to the clipboard on click', async () => {
    render(<CopyIssueLinkButton issueId={42} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy issue link' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/issues/42`)
  })

  it('shows a "Copied!" confirmation tooltip after copying', async () => {
    render(<CopyIssueLinkButton issueId={7} />)

    const button = screen.getByRole('button', { name: 'Copy issue link' })
    fireEvent.mouseOver(button)
    fireEvent.click(button)

    expect(await screen.findByText('Copied!')).toBeInTheDocument()
  })

  it('does not throw when the clipboard write fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    render(<CopyIssueLinkButton issueId={9} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy issue link' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/issues/9`))
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
  })
})
