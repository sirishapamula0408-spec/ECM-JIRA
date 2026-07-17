import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '../components/common/EmptyState'

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(
      <EmptyState title="No webhooks configured" description="Add one to get started." />
    )
    expect(screen.getByText('No webhooks configured')).toBeInTheDocument()
    expect(screen.getByText('Add one to get started.')).toBeInTheDocument()
  })

  it('renders the action node when provided', () => {
    render(
      <EmptyState
        title="Nothing here"
        action={<button type="button">Create</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('does not render an action region when action is omitted', () => {
    const { container } = render(<EmptyState title="Nothing here" />)
    expect(container.querySelector('.empty-state__action')).toBeNull()
  })

  it('does not render a description region when description is omitted', () => {
    const { container } = render(<EmptyState title="Nothing here" />)
    expect(container.querySelector('.empty-state__description')).toBeNull()
  })

  it('renders the provided icon', () => {
    render(
      <EmptyState
        title="Nothing here"
        icon={<svg data-testid="empty-icon" />}
      />
    )
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument()
  })
})
