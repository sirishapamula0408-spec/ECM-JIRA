import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IssueTypeIcon } from '../components/icons/IssueTypeIcon'
import { ISSUE_TYPES } from '../constants'

describe('IssueTypeIcon (JL-385)', () => {
  it('renders a distinct glyph for every type in ISSUE_TYPES', () => {
    const markups = ISSUE_TYPES.map((type) => {
      const { container, unmount } = render(<IssueTypeIcon type={type} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      const html = svg.innerHTML
      unmount()
      return html
    })
    // Every type must produce different SVG content (colour + symbol).
    expect(new Set(markups).size).toBe(ISSUE_TYPES.length)
  })

  it.each(ISSUE_TYPES)('exposes "%s" to assistive technology', (type) => {
    render(<IssueTypeIcon type={type} />)
    const icon = screen.getByRole('img', { name: type })
    expect(icon).toBeInTheDocument()
    expect(icon).not.toHaveAttribute('aria-hidden')
  })

  it('renders a neutral fallback for an unknown type without throwing', () => {
    const known = render(<IssueTypeIcon type="Task" />)
      .container.querySelector('svg').innerHTML

    expect(() => render(<IssueTypeIcon type="Wibble" />)).not.toThrow()
    const icon = screen.getByRole('img', { name: 'Wibble' })
    expect(icon).toBeInTheDocument()
    // Fallback glyph differs from any real type's glyph.
    expect(icon.innerHTML).not.toBe(known)
  })

  it('does not throw for a null type', () => {
    expect(() => render(<IssueTypeIcon type={null} />)).not.toThrow()
    expect(screen.getByRole('img', { name: 'Unknown issue type' })).toBeInTheDocument()
  })

  it('does not throw for an undefined/missing type', () => {
    expect(() => render(<IssueTypeIcon />)).not.toThrow()
    expect(screen.getByRole('img', { name: 'Unknown issue type' })).toBeInTheDocument()
  })

  it('respects the size prop and defaults to a dense inline size', () => {
    const { container } = render(<IssueTypeIcon type="Bug" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('height', '14')

    const { container: big } = render(<IssueTypeIcon type="Bug" size={20} />)
    expect(big.querySelector('svg')).toHaveAttribute('width', '20')
  })
})
