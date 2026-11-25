// JL-488: a Release Monitor cannot pick the monitored project in the Create
// dialog, and every project has a Releases tab.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { canCreateInProject } from '../hooks/usePermissions'

const member = (workspaceRole, projectRoles = [], isOwner = false) => ({ workspaceRole, isOwner, projectRoles })

describe('canCreateInProject', () => {
  it('leaves out a project where the user is only a Release Monitor', () => {
    const m = member('Viewer', [{ projectId: 4, role: 'Member' }, { projectId: 8, role: 'Release Monitor' }])
    expect(canCreateInProject(m, 4)).toBe(true)
    expect(canCreateInProject(m, 8)).toBe(false)
  })

  it('an explicit project role overrides the workspace role, both ways', () => {
    expect(canCreateInProject(member('Member', [{ projectId: 8, role: 'Release Monitor' }]), 8)).toBe(false)
    expect(canCreateInProject(member('Member', [{ projectId: 8, role: 'Viewer' }]), 8)).toBe(false)
    expect(canCreateInProject(member('Member'), 9)).toBe(true)
    expect(canCreateInProject(member('Viewer', [{ projectId: 9, role: 'Lead' }]), 9)).toBe(true)
    expect(canCreateInProject(member('Viewer'), 9)).toBe(false)
  })

  it('workspace Admin and Owner can create everywhere; no member, nowhere', () => {
    expect(canCreateInProject(member('Admin', [{ projectId: 8, role: 'Release Monitor' }]), 8)).toBe(true)
    expect(canCreateInProject(member('Viewer', [], true), 8)).toBe(true)
    expect(canCreateInProject(null, 8)).toBe(false)
  })
})

describe('Releases navigation', () => {
  it('the project tab strip links to the project Releases page', () => {
    const src = readFileSync('src/components/layout/ProjectTopPanel.jsx', 'utf8')
    expect(src).toMatch(/id: 'releases', label: 'Releases', path: `\$\{prefix\}\/releases`/)
  })

  it('the Create dialog filters its projects with canCreateInProject', () => {
    const src = readFileSync('src/components/issues/CreateIssueModal.jsx', 'utf8')
    expect(src).toMatch(/filter\(\(p\) => canCreateInProject\(currentMember, p\.id\)\)/)
  })
})
