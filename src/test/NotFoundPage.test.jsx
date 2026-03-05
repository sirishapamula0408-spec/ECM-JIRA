import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { NotFoundPage } from '../pages/NotFoundPage/NotFoundPage'

describe('NotFoundPage', () => {
  it('renders 404 message with link to dashboard', () => {
    render(
      <BrowserRouter>
        <NotFoundPage />
      </BrowserRouter>
    )
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByText(/does not exist/)).toBeInTheDocument()
    const link = screen.getByText('Go to Dashboard')
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('/')
  })
})
