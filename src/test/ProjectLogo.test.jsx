// Project logos in the UI: the shared avatar shows the logo (or the coloured
// initial), the Settings field offers Upload/Change/Remove only to people who
// may change project settings, and the create form uploads an optional logo
// right after creating the project.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../api/projectApi', async (importOriginal) => ({
  ...(await importOriginal()),
  createProject: vi.fn(),
  uploadProjectLogo: vi.fn(),
  removeProjectLogo: vi.fn(),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ members: [{ id: 5, name: 'Lee Lead', email: 'lee@x.com' }], profile: null }),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { email: 'lee@x.com' } }) }))

import { createProject, uploadProjectLogo, removeProjectLogo } from '../api/projectApi'
import { projectLogoProblem, PROJECT_CHANGED_EVENT } from '../utils/projectLogo'
import { ProjectAvatar } from '../components/common/ProjectAvatar'
import { ProjectLogoField } from '../components/projects/ProjectLogoField'
import { CreateProjectModal } from '../components/projects/CreateProjectModal'

// A real PNG signature: the form checks the file's bytes, not just its name.
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]
const png = (size = 16, name = 'logo.png') => {
  const bytes = new Uint8Array(Math.max(size, 12))
  bytes.set(PNG_SIG)
  return new File([bytes], name, { type: 'image/png' })
}
const fakePng = () => new File(['just some text, not an image'], 'fake.png', { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
  global.URL.createObjectURL = vi.fn(() => 'blob:preview')
  global.URL.revokeObjectURL = vi.fn()
})

describe('ProjectAvatar', () => {
  it('shows the logo when the project has one', () => {
    const { container } = render(<ProjectAvatar project={{ key: 'ECM', logo_url: '/api/projects/1/logo?v=1' }} className="x" />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/api/projects/1/logo?v=1')
    expect(container.firstChild).toHaveClass('x', 'project-avatar--logo')
  })

  it('shows the coloured initial without a logo, and falls back to it if the logo fails to load', () => {
    const { container, rerender } = render(<ProjectAvatar project={{ key: 'ECM', avatar_color: '#123456' }} className="x" />)
    expect(container.firstChild).toHaveTextContent('E')
    expect(container.firstChild).toHaveStyle({ background: '#123456' })

    rerender(<ProjectAvatar project={{ key: 'ECM', logo_url: '/broken' }} className="x" />)
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toBeNull()
    expect(container.firstChild).toHaveTextContent('E')
  })
})

describe('projectLogoProblem', () => {
  it('accepts a real PNG and refuses SVG, oversize files, and a non-image renamed .png', async () => {
    expect(await projectLogoProblem(png())).toBe('')
    expect(await projectLogoProblem(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))).toMatch(/PNG, JPEG, GIF or WebP/)
    expect(await projectLogoProblem(png(1024 * 1024 + 1))).toMatch(/1 MB/)
    expect(await projectLogoProblem(fakePng())).toMatch(/PNG, JPEG, GIF or WebP/)
  })
})

describe('ProjectLogoField (Project settings → Details)', () => {
  const project = { id: 7, key: 'ECM', logo_url: null }

  it('people who may not change project settings see the logo only', () => {
    render(<ProjectLogoField project={project} canEdit={false} />)
    expect(screen.queryByRole('button', { name: /logo/i })).toBeNull()
    expect(screen.queryByLabelText('Project logo file')).toBeNull()
  })

  it('uploads a chosen file, updates the page and tells the sidebar', async () => {
    const updated = { ...project, logo_url: '/api/projects/7/logo?v=2' }
    uploadProjectLogo.mockResolvedValue(updated)
    const onChange = vi.fn()
    const onMessage = vi.fn()
    const announced = vi.fn()
    window.addEventListener(PROJECT_CHANGED_EVENT, announced)

    render(<ProjectLogoField project={project} canEdit onChange={onChange} onMessage={onMessage} />)
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeInTheDocument()
    const file = png()
    fireEvent.change(screen.getByLabelText('Project logo file'), { target: { files: [file] } })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated))
    expect(uploadProjectLogo).toHaveBeenCalledWith(7, file)
    expect(onMessage).toHaveBeenCalledWith({ type: 'success', message: 'Project logo updated.' })
    expect(announced).toHaveBeenCalled()
    window.removeEventListener(PROJECT_CHANGED_EVENT, announced)
  })

  it('refuses a bad file (SVG, or text renamed .png) before uploading anything', async () => {
    const onMessage = vi.fn()
    render(<ProjectLogoField project={project} canEdit onMessage={onMessage} />)
    for (const bad of [new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }), fakePng()]) {
      fireEvent.change(screen.getByLabelText('Project logo file'), { target: { files: [bad] } })
    }
    await waitFor(() => expect(onMessage).toHaveBeenCalledTimes(2))
    expect(onMessage).toHaveBeenCalledWith({ type: 'error', message: 'Use a PNG, JPEG, GIF or WebP image' })
    expect(uploadProjectLogo).not.toHaveBeenCalled()
  })

  it('offers Change and Remove when there is a logo', async () => {
    removeProjectLogo.mockResolvedValue(project)
    const onChange = vi.fn()
    render(<ProjectLogoField project={{ ...project, logo_url: '/l' }} canEdit onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Change logo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removeProjectLogo).toHaveBeenCalledWith(7))
    expect(onChange).toHaveBeenCalledWith(project)
  })
})

describe('CreateProjectModal — optional logo', () => {
  it('creates the project, then uploads the chosen logo to it', async () => {
    createProject.mockResolvedValue({ id: 42, key: 'MA' })
    uploadProjectLogo.mockResolvedValue({ id: 42 })
    const onClose = vi.fn()
    const onProjectCreated = vi.fn()
    render(<CreateProjectModal onClose={onClose} onProjectCreated={onProjectCreated} />)

    const file = png()
    fireEvent.change(screen.getByLabelText(/Project logo/), { target: { files: [file] } })
    // The chosen file is named — the hidden native input no longer says "No file chosen".
    expect(await screen.findByText('logo.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. Website Redesign'), { target: { value: 'Mobile App' } })
    const [, leadSelect] = screen.getAllByRole('combobox')
    fireEvent.change(leadSelect, { target: { value: 'Lee Lead' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(uploadProjectLogo).toHaveBeenCalledWith(42, file)
    expect(onProjectCreated).toHaveBeenCalled()
  })

  it('creates without a logo when none is chosen', async () => {
    createProject.mockResolvedValue({ id: 43 })
    const onClose = vi.fn()
    render(<CreateProjectModal onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Website Redesign'), { target: { value: 'Web' } })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Lee Lead' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(uploadProjectLogo).not.toHaveBeenCalled()
  })

  it('if the logo upload fails, says the project WAS created and offers Close, not Create again', async () => {
    createProject.mockResolvedValue({ id: 44 })
    uploadProjectLogo.mockRejectedValue(new Error('Project logo is too large'))
    const onClose = vi.fn()
    render(<CreateProjectModal onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/Project logo/), { target: { files: [png()] } })
    await screen.findByText('logo.png')
    fireEvent.change(screen.getByPlaceholderText('e.g. Website Redesign'), { target: { value: 'Web' } })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Lee Lead' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/Project created, but the logo could not be uploaded/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0)
    expect(onClose).not.toHaveBeenCalled()
    expect(createProject).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-image renamed .png up front, before the project is created', async () => {
    render(<CreateProjectModal onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Project logo/), { target: { files: [fakePng()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a PNG, JPEG, GIF or WebP image')
    expect(screen.queryByText('fake.png')).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose image' })).toBeInTheDocument()
  })

  it('a refused pick drops the earlier good one, so Create uploads nothing', async () => {
    createProject.mockResolvedValue({ id: 45 })
    const onClose = vi.fn()
    render(<CreateProjectModal onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/Project logo/), { target: { files: [png()] } })
    await screen.findByText('logo.png')
    fireEvent.change(screen.getByLabelText(/Project logo/), { target: { files: [new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })] } })
    await screen.findByRole('alert')
    expect(screen.queryByText('logo.png')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('e.g. Website Redesign'), { target: { value: 'Web' } })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Lee Lead' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(uploadProjectLogo).not.toHaveBeenCalled()
  })
})
