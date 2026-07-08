import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileBottomNav } from '../components/layout/MobileBottomNav'

// NOTE: the bar is `display:none` by default (shown only < 768px via a CSS
// media query), so queries use `{ hidden: true }` to reach the DOM nodes.
function renderNav(props = {}) {
  return render(
    <MemoryRouter>
      <MobileBottomNav {...props} />
    </MemoryRouter>
  )
}

describe('MobileBottomNav', () => {
  it('renders the navigation landmark', () => {
    renderNav()
    const nav = screen.getByRole('navigation', { hidden: true })
    expect(nav).toBeInTheDocument()
    expect(nav).toHaveAttribute('aria-label', 'Mobile navigation')
  })

  it('renders Board, Backlog, Dashboard and Profile links with correct hrefs', () => {
    renderNav()
    expect(screen.getByRole('link', { name: 'Board', hidden: true }).getAttribute('href')).toBe('/board')
    expect(screen.getByRole('link', { name: 'Backlog', hidden: true }).getAttribute('href')).toBe('/backlog')
    expect(screen.getByRole('link', { name: 'Dashboard', hidden: true }).getAttribute('href')).toBe('/dashboard')
    expect(screen.getByRole('link', { name: 'Profile', hidden: true }).getAttribute('href')).toBe('/profile')
  })

  it('renders a Create button that invokes onCreate when clicked', () => {
    const onCreate = vi.fn()
    renderNav({ onCreate })
    const createBtn = screen.getByRole('button', { name: /create issue/i, hidden: true })
    expect(createBtn).toBeInTheDocument()
    createBtn.click()
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('renders exactly four navigation links', () => {
    renderNav()
    expect(screen.getAllByRole('link', { hidden: true })).toHaveLength(4)
  })
})
