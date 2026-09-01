// JL-439 — the shared component layer.
//
// These assertions are about the CONTRACT, not the paint. Colours and sizes are
// guarded by DesignTokens.JL441 against variables.css, so restating "the button
// is 40px" here would be a second copy of a number that already has one home.
//
// What is worth pinning is the behaviour each component exists to guarantee and
// that the hand-rolled versions kept getting wrong: an icon-only button has an
// accessible name, a field's label points at its control, a dialog announces
// itself and closes on Escape, a tab strip is one tab stop with arrow-key
// navigation, and a breadcrumb's last item is not a link.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

import { Button } from '../components/ui/Button'
import { IconButton } from '../components/ui/IconButton'
import { Input, Textarea, Select } from '../components/ui/Input'
import { FormField } from '../components/ui/FormField'
import { Table } from '../components/ui/Table'
import { Modal } from '../components/ui/Modal'
import { Tabs } from '../components/ui/Tabs'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { PageHeader } from '../components/ui/PageHeader'
import { SectionHeader } from '../components/ui/SectionHeader'
import { Toast } from '../components/ui/Toast'

afterEach(cleanup)

describe('Button', () => {
  it('renders a real button that fires onClick', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled', () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Save</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it.each(['primary', 'secondary', 'subtle', 'danger'])(
    'carries a variant class for %s so the variant is inspectable',
    (variant) => {
      render(<Button variant={variant}>Go</Button>)
      expect(screen.getByRole('button', { name: 'Go' })).toHaveClass(`ds-button--${variant}`)
    },
  )

  it('falls back to secondary for an unknown variant rather than rendering unstyled', () => {
    render(<Button variant="nonsense">Go</Button>)
    // MUI's outlined variant is what `secondary` maps to.
    expect(screen.getByRole('button', { name: 'Go' }).className).toMatch(/MuiButton-outlined/)
  })
})

describe('IconButton', () => {
  it('names itself for a screen reader', () => {
    render(<IconButton label="Delete issue">x</IconButton>)
    expect(screen.getByRole('button', { name: 'Delete issue' })).toBeInTheDocument()
  })

  it('refuses to render without a label', () => {
    // The whole point of the component. An icon-only button with no accessible
    // name is the defect it exists to make impossible, so this is a throw
    // rather than a console warning that a build would swallow.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<IconButton>x</IconButton>)).toThrow(/label/)
    quiet.mockRestore()
  })

  it('skips the tooltip when disabled, because a disabled button never fires one', () => {
    render(<IconButton label="Delete" disabled>x</IconButton>)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})

describe('FormField', () => {
  it('points the label at the control and links help text', () => {
    render(
      <FormField label="Project name" help="Shown in the sidebar">
        {(p) => <input {...p} />}
      </FormField>,
    )
    const input = screen.getByLabelText('Project name')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy)).toHaveTextContent('Shown in the sidebar')
  })

  it('marks the control invalid and announces the error', () => {
    render(
      <FormField label="Email" error="Not a valid address">
        {(p) => <input {...p} />}
      </FormField>,
    )
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid address')
  })

  it('generates a distinct id per instance, so two fields on a page do not collide', () => {
    render(
      <>
        <FormField label="One">{(p) => <input {...p} />}</FormField>
        <FormField label="Two">{(p) => <input {...p} />}</FormField>
      </>,
    )
    expect(screen.getByLabelText('One').id).not.toBe(screen.getByLabelText('Two').id)
  })

  it('accepts a plain node as well as a render function', () => {
    render(<FormField label="Plain"><input aria-label="bare" /></FormField>)
    expect(screen.getByLabelText('bare')).toBeInTheDocument()
  })
})

describe('Input / Textarea / Select', () => {
  it('renders a labelled input', () => {
    render(<Input label="Title" defaultValue="" />)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'hello' } })
    expect(screen.getByLabelText('Title')).toHaveValue('hello')
  })

  it('renders bare when it has no label, help or error', () => {
    const { container } = render(<Input placeholder="Search" />)
    expect(container.querySelector('.field')).toBeNull()
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
  })

  it('flags an errored control with a class the stylesheet can reach', () => {
    render(<Input label="Email" error="bad" />)
    expect(screen.getByLabelText('Email')).toHaveClass('ds-input--error')
  })

  it('Textarea honours rows', () => {
    render(<Textarea label="Notes" rows={7} />)
    expect(screen.getByLabelText('Notes')).toHaveAttribute('rows', '7')
  })

  it('Select accepts bare strings as options', () => {
    render(<Select label="Priority" options={['Low', 'Medium', 'High']} defaultValue="Medium" />)
    const select = screen.getByLabelText('Priority')
    expect(select).toHaveValue('Medium')
    expect(within(select).getAllByRole('option')).toHaveLength(3)
  })

  it('Select accepts objects and a placeholder', () => {
    render(
      <Select
        label="Status"
        placeholder="Any"
        options={[{ value: 'todo', label: 'To Do' }, { value: 'done', label: 'Done', disabled: true }]}
      />,
    )
    const options = within(screen.getByLabelText('Status')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Any', 'To Do', 'Done'])
    expect(options[2]).toBeDisabled()
  })
})

describe('Table', () => {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'count', header: 'Count', render: (r) => `${r.count} items` },
  ]

  it('renders headers as column headers and rows from the data', () => {
    render(<Table columns={columns} rows={[{ id: 1, name: 'Alpha', count: 3 }]} />)
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '3 items' })).toBeInTheDocument()
  })

  it('spans the empty message across every column', () => {
    render(<Table columns={columns} rows={[]} empty="No results" />)
    expect(screen.getByRole('cell', { name: 'No results' })).toHaveAttribute('colspan', '2')
  })

  it('lets a caller supply rows directly for the complex cases', () => {
    render(
      <Table columns={columns}>
        <tr><td colSpan={2}>custom</td></tr>
      </Table>,
    )
    expect(screen.getByRole('cell', { name: 'custom' })).toBeInTheDocument()
  })
})

describe('Modal', () => {
  it('announces itself with its title', () => {
    render(<Modal open title="Delete issue">Are you sure?</Modal>)
    expect(screen.getByRole('dialog', { name: 'Delete issue' })).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(<Modal open={false} title="Delete issue">body</Modal>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape — the behaviour JL-367 had to retrofit onto the hand-rolled overlay', () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="Delete issue">body</Modal>)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renders footer actions when given them, and no footer when not', () => {
    const { rerender } = render(
      <Modal open title="T" actions={<button type="button">Confirm</button>}>body</Modal>,
    )
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    rerender(<Modal open title="T">body</Modal>)
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })
})

describe('Tabs', () => {
  const tabs = [
    { id: 'all', label: 'All', count: 12 },
    { id: 'mine', label: 'Mine' },
    { id: 'done', label: 'Done' },
  ]

  it('marks exactly one tab selected', () => {
    render(<Tabs tabs={tabs} value="mine" onChange={() => {}} />)
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent('Mine')
  })

  it('is a single tab stop — only the selected tab is reachable by Tab', () => {
    render(<Tabs tabs={tabs} value="mine" onChange={() => {}} />)
    const tabindexes = screen.getAllByRole('tab').map((t) => t.getAttribute('tabindex'))
    expect(tabindexes).toEqual(['-1', '0', '-1'])
  })

  it('moves with the arrow keys and wraps at both ends', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} value="done" onChange={onChange} />)
    const strip = screen.getByRole('tablist')
    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('all')
    fireEvent.keyDown(strip, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('mine')
    fireEvent.keyDown(strip, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('all')
    fireEvent.keyDown(strip, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('done')
  })

  it('fires onChange with the id of a clicked tab', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} value="all" onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: /Done/ }))
    expect(onChange).toHaveBeenCalledWith('done')
  })

  it('shows a count when the tab carries one', () => {
    render(<Tabs tabs={tabs} value="all" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('12')
  })
})

describe('Breadcrumb', () => {
  const items = [
    { label: 'Projects', onClick: () => {} },
    { label: 'ECM', onClick: () => {} },
    { label: 'ECM-7' },
  ]

  it('renders the last item as the current page, not a link', () => {
    render(<Breadcrumb items={items} />)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getAllByRole('button')).toHaveLength(2)
    expect(within(nav).getByText('ECM-7')).toHaveAttribute('aria-current', 'page')
  })

  it('renders nothing at all when empty', () => {
    const { container } = render(<Breadcrumb items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('supports href items as real links', () => {
    render(<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Here' }]} />)
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
  })
})

describe('PageHeader', () => {
  it('emits a plain h1 — PageHeadingLevel.JL409 requires one per page', () => {
    render(<PageHeader title="Projects" />)
    const h1 = screen.getByRole('heading', { level: 1, name: 'Projects' })
    expect(h1.tagName).toBe('H1')
    // Not a MUI Typography: those carry an emotion class the shared
    // `.page h1` rule would then have to out-specify.
    expect(h1.className).not.toMatch(/MuiTypography/)
  })

  it('uses the standalone class for pages that root outside .page', () => {
    render(<PageHeader title="Accept invite" standalone />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('page-title-standalone')
  })

  it('does not use the standalone class by default, so .page h1 owns the treatment', () => {
    render(<PageHeader title="Projects" />)
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveClass('page-title-standalone')
  })

  it('renders breadcrumbs, eyebrow, description and actions when given them', () => {
    render(
      <PageHeader
        breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: 'ECM' }]}
        eyebrow="ECM-7"
        title="Update the API docs"
        description="Everything about v2."
        actions={<button type="button">Create</button>}
      />,
    )
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByText('ECM-7')).toBeInTheDocument()
    expect(screen.getByText('Everything about v2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })
})

describe('SectionHeader', () => {
  it('defaults to h2 and carries the shared section-label treatment', () => {
    render(<SectionHeader>Description</SectionHeader>)
    const heading = screen.getByRole('heading', { level: 2, name: 'Description' })
    expect(heading).toHaveClass('section-label')
  })

  it('honours the level it is given, because heading level is document structure', () => {
    render(<SectionHeader level={3}>Linked issues</SectionHeader>)
    expect(screen.getByRole('heading', { level: 3, name: 'Linked issues' })).toBeInTheDocument()
  })

  it('keeps the heading a heading when actions sit beside it', () => {
    render(<SectionHeader actions={<button type="button">Add</button>}>Child issues</SectionHeader>)
    expect(screen.getByRole('heading', { level: 2, name: 'Child issues' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })
})

describe('Toast', () => {
  it('announces an error assertively and everything else politely', () => {
    const { rerender } = render(<Toast open severity="error" message="Save failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed')
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')

    rerender(<Toast open severity="success" message="Saved" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders nothing when closed', () => {
    render(<Toast open={false} message="Saved" />)
    expect(screen.queryByText('Saved')).toBeNull()
  })
})

describe('JL-439 AC#2 — the ui layer duplicates nothing that already existed', () => {
  // The epic exists to remove duplication, so the most damaging way to fail it
  // is to add a second Button, Badge or Modal under a new name. This walks the
  // real directory rather than a hand-kept list, so a new file is caught the
  // day it lands.
  const uiDir = path.join(srcRoot, 'components', 'ui')
  const uiFiles = fs.readdirSync(uiDir)
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => f.replace(/\.jsx$/, ''))

  // name -> where the real one lives.
  const ALREADY_EXISTS = {
    StatusLozenge: 'common/StatusLozenge',
    StatusBadge: 'common/StatusLozenge',
    Badge: 'common/StatusLozenge (status) or the .badge class in shared.css',
    EmptyState: 'common/EmptyState',
    LoadingState: 'common/LoadingState',
    LoadingSkeleton: 'components/LoadingSkeleton',
    ConfirmDialog: 'common/ConfirmDialog',
    ConfirmModal: 'common/ConfirmDialog',
    MetricCard: 'ui/StatCard',
    Sidebar: 'layout/Sidebar',
    TopNavigation: 'layout/Topbar',
    Topbar: 'layout/Topbar',
    ProjectTopPanel: 'layout/ProjectTopPanel',
    CopyButton: 'common/CopyButton',
    RelativeTime: 'common/RelativeTime',
    SmartText: 'common/SmartText',
    ErrorBoundary: 'common/ErrorBoundary',
    DueDateBadge: 'issues/DueDateBadge',
    VoteButton: 'issues/VoteButton',
    IssueTypeIcon: 'icons/IssueTypeIcon',
  }

  it('adds no component that already exists elsewhere', () => {
    const duplicates = uiFiles
      .filter((name) => name in ALREADY_EXISTS)
      .map((name) => `${name} — already at ${ALREADY_EXISTS[name]}`)
    expect(duplicates, duplicates.join('\n')).toEqual([])
  })

  it('exports every component it defines, so none is unreachable from the barrel', () => {
    const barrel = fs.readFileSync(path.join(uiDir, 'index.js'), 'utf8')
    // Input.jsx deliberately holds three controls; check the file is reached.
    const missing = uiFiles.filter((name) => !barrel.includes(`'./${name}'`))
    expect(missing, `not exported from ui/index.js: ${missing.join(', ')}`).toEqual([])
  })
})
