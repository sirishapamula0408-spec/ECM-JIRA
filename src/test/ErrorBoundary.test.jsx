import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../components/ErrorBoundary'

function ThrowingChild({ shouldThrow }) {
  if (shouldThrow) throw new Error('Test explosion')
  return <p>All good</p>
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('renders fallback UI when child throws', () => {
    // Suppress console.error from React error boundary
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test explosion')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('recovers after clicking Try again', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Rerender with non-throwing child before clicking reset
    rerender(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByText('Try again'))
    expect(screen.getByText('All good')).toBeInTheDocument()
    spy.mockRestore()
  })
})
