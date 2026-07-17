import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// --- Mock contexts used by CreateIssueModal ---
const handleCreate = vi.fn().mockResolvedValue({ id: 1 })
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ handleCreate }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    profile: { full_name: 'Test User' },
    members: [{ id: 1, name: 'Test User' }],
  }),
}))
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: [] }),
}))
vi.mock('../context/AppDataContext', () => ({
  useAppData: () => ({ setAppError: vi.fn() }),
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'test@test.com' } }),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([{ id: 1, name: 'Test Project', key: 'TP' }]),
}))

import { CreateIssueModal } from '../components/issues/CreateIssueModal'

describe('CreateIssueModal — rich text description (JL-3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the formatting toolbar (Bold/Italic) on the Description field', async () => {
    render(<CreateIssueModal onClose={() => {}} />)

    // Toolbar buttons come from RichTextEditor, keyed by title attribute
    expect(screen.getByTitle('Bold')).toBeInTheDocument()
    expect(screen.getByTitle('Italic')).toBeInTheDocument()

    // Description field is now the rich text editor's textarea
    expect(screen.getByPlaceholderText('Add a description...')).toBeInTheDocument()
  })

  it('updates the description value when typing into the editor', () => {
    render(<CreateIssueModal onClose={() => {}} />)

    const textarea = screen.getByPlaceholderText('Add a description...')
    fireEvent.change(textarea, { target: { value: 'Hello **world**' } })

    expect(textarea).toHaveValue('Hello **world**')
  })

  it('applies bold markdown to the description when the Bold button is clicked', () => {
    render(<CreateIssueModal onClose={() => {}} />)

    const textarea = screen.getByPlaceholderText('Add a description...')
    fireEvent.click(screen.getByTitle('Bold'))

    // Bold inserts the ** ** markdown wrapper into the description value
    expect(textarea.value).toContain('**')
  })

  it('submits the typed description through handleCreate', async () => {
    render(<CreateIssueModal onClose={() => {}} />)

    // Wait for projects to load so the form has a project id
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Test Project/ })).toBeInTheDocument()
    )

    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), {
      target: { value: 'A summary' },
    })
    fireEvent.change(screen.getByPlaceholderText('Add a description...'), {
      target: { value: 'A rich description' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(handleCreate).toHaveBeenCalledTimes(1))
    expect(handleCreate.mock.calls[0][0]).toMatchObject({
      title: 'A summary',
      description: 'A rich description',
    })
  })
})
