import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RelativeTime } from '../components/common/RelativeTime'

describe('RelativeTime (JL-241)', () => {
  it('renders relative text for a recent timestamp', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    render(<RelativeTime value={fiveMinutesAgo} />)
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  it('renders a <time> element with dateTime and an absolute-date title tooltip', () => {
    const date = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    const { container } = render(<RelativeTime value={date.toISOString()} />)
    const timeEl = container.querySelector('time')
    expect(timeEl).not.toBeNull()
    expect(timeEl.getAttribute('datetime')).toBe(date.toISOString())
    expect(timeEl.getAttribute('title')).toBe(date.toLocaleString())
    expect(timeEl.textContent).toBe('2h ago')
  })

  it('renders the default fallback for a null date', () => {
    const { container } = render(<RelativeTime value={null} />)
    expect(container.textContent).toBe('—')
    expect(container.querySelector('time')).toBeNull()
  })

  it('renders a custom fallback for an invalid date', () => {
    const { container } = render(<RelativeTime value="not-a-date" fallback="Unknown" />)
    expect(container.textContent).toBe('Unknown')
    expect(container.querySelector('time')).toBeNull()
  })

  it('forwards extra props such as className to the <time> element', () => {
    const { container } = render(
      <RelativeTime value={new Date(Date.now() - 60 * 1000)} className="wh-log-time" />
    )
    expect(container.querySelector('time.wh-log-time')).not.toBeNull()
  })
})
