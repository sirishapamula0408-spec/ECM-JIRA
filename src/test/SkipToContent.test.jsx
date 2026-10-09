import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import { SkipToContent } from '../components/common/SkipToContent'
import { useFocusMainOnRouteChange } from '../hooks/useFocusMainOnRouteChange'

/** Minimal app shell mirroring App.jsx: skip link first, nav, then main. */
function Shell({ children }) {
  useFocusMainOnRouteChange()
  return (
    <div className="workspace">
      <SkipToContent />
      <nav>
        <Link to="/">Home</Link>
        <Link to="/board">Board</Link>
        <Link to="/board" state={{ keepFocus: true }}>Rename only</Link>
      </nav>
      <input aria-label="Draft" />
      <main className="content" role="main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}

function renderShell(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Shell>
        <Routes>
          <Route path="/" element={<h1>Dashboard</h1>} />
          <Route path="/board" element={<h1>Board page</h1>} />
        </Routes>
      </Shell>
    </MemoryRouter>,
  )
}

describe('SkipToContent (JL-220)', () => {
  it('renders a skip link targeting #main-content', () => {
    renderShell()
    const link = screen.getByRole('link', { name: /skip to main content/i })
    expect(link).toHaveAttribute('href', '#main-content')
    expect(link).toHaveClass('skip-to-content')
  })

  it('is the first focusable element in the shell (first in tab order)', () => {
    const { container } = renderShell()
    const firstFocusable = container.querySelector(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    expect(firstFocusable).toBe(screen.getByRole('link', { name: /skip to main content/i }))
  })

  it('moves focus to the main content region on activation', () => {
    renderShell()
    const link = screen.getByRole('link', { name: /skip to main content/i })
    fireEvent.click(link)
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(main).toHaveFocus()
  })
})

describe('useFocusMainOnRouteChange (JL-220)', () => {
  it('does not steal focus on initial render', () => {
    renderShell()
    expect(screen.getByRole('main')).not.toHaveFocus()
  })

  it('moves focus to main after client-side navigation', () => {
    renderShell()
    fireEvent.click(screen.getByRole('link', { name: 'Board' }))
    expect(screen.getByRole('heading', { name: 'Board page' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('keeps focus on main across successive navigations', () => {
    renderShell()
    fireEvent.click(screen.getByRole('link', { name: 'Board' }))
    expect(screen.getByRole('main')).toHaveFocus()
    fireEvent.click(screen.getByRole('link', { name: 'Home' }))
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('leaves focus alone for a navigation marked keepFocus (JL-187)', () => {
    // The page editor's first autosave renames /wiki/new to /wiki/pages/:id/edit
    // while the author is typing; focus must stay where they are typing.
    renderShell()
    const draft = screen.getByLabelText('Draft')
    draft.focus()
    // fireEvent.click does not move focus in jsdom, so focus is still in the
    // draft when the route changes — exactly the editor's situation.
    fireEvent.click(screen.getByRole('link', { name: 'Rename only' }))
    expect(screen.getByRole('heading', { name: 'Board page' })).toBeInTheDocument()
    expect(draft).toHaveFocus()
    expect(screen.getByRole('main')).not.toHaveFocus()
  })
})
