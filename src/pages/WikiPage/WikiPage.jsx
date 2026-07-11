import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { fetchWikiPages, fetchWikiPage, createWikiPage, updateWikiPage, deleteWikiPage, searchWikiPages, fetchWikiVersions, fetchWikiVersion, linkIssueToWiki, unlinkIssueFromWiki } from '../../api/wikiApi'
import { usePermissions } from '../../hooks/usePermissions'
import './WikiPage.css'

export function WikiPage() {
  const { projectId } = useParams()
  const { canEditIssue } = usePermissions(projectId)
  const [pages, setPages] = useState([])
  const [selectedPage, setSelectedPage] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ title: '', content: '', parentId: null })
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [versions, setVersions] = useState([])
  const [showVersions, setShowVersions] = useState(false)
  const [diffVersion, setDiffVersion] = useState(null)
  const [linkIssueId, setLinkIssueId] = useState('')

  const loadPages = useCallback(async () => {
    if (!projectId) return
    try {
      const data = await fetchWikiPages(projectId)
      setPages(Array.isArray(data) ? data : [])
    } catch {
      setPages([])
    }
  }, [projectId])

  useEffect(() => { loadPages() }, [loadPages])

  async function handleSelectPage(page) {
    setLoading(true)
    try {
      const full = await fetchWikiPage(page.id)
      setSelectedPage(full)
      setIsEditing(false)
      setShowVersions(false)
      setDiffVersion(null)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!form.title.trim()) return
    try {
      await createWikiPage({ projectId: Number(projectId), ...form })
      setShowCreate(false)
      setForm({ title: '', content: '', parentId: null })
      loadPages()
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    if (!selectedPage) return
    try {
      const updated = await updateWikiPage(selectedPage.id, {
        title: form.title,
        content: form.content,
      })
      setSelectedPage(updated)
      setIsEditing(false)
      loadPages()
    } catch {
      // ignore
    }
  }

  async function handleDelete(id) {
    try {
      await deleteWikiPage(id)
      if (selectedPage?.id === id) setSelectedPage(null)
      loadPages()
    } catch {
      // ignore
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) { setSearchResults(null); return }
    try {
      const results = await searchWikiPages(searchQuery, projectId)
      setSearchResults(Array.isArray(results) ? results : [])
    } catch {
      setSearchResults([])
    }
  }

  async function handleShowVersions() {
    if (!selectedPage) return
    try {
      const data = await fetchWikiVersions(selectedPage.id)
      setVersions(Array.isArray(data) ? data : [])
      setShowVersions(true)
    } catch {
      setVersions([])
    }
  }

  async function handleViewVersion(versionId) {
    if (!selectedPage) return
    try {
      const ver = await fetchWikiVersion(selectedPage.id, versionId)
      setDiffVersion(ver)
    } catch {
      // ignore
    }
  }

  async function handleLinkIssue() {
    if (!selectedPage || !linkIssueId.trim()) return
    try {
      await linkIssueToWiki(selectedPage.id, Number(linkIssueId))
      setLinkIssueId('')
      const full = await fetchWikiPage(selectedPage.id)
      setSelectedPage(full)
    } catch {
      // ignore
    }
  }

  async function handleUnlinkIssue(issueId) {
    if (!selectedPage) return
    try {
      await unlinkIssueFromWiki(selectedPage.id, issueId)
      const full = await fetchWikiPage(selectedPage.id)
      setSelectedPage(full)
    } catch {
      // ignore
    }
  }

  function startEdit() {
    setForm({ title: selectedPage.title, content: selectedPage.content, parentId: selectedPage.parent_id })
    setIsEditing(true)
  }

  const rootPages = pages.filter((p) => !p.parent_id)
  const childMap = {}
  pages.forEach((p) => {
    if (p.parent_id) {
      if (!childMap[p.parent_id]) childMap[p.parent_id] = []
      childMap[p.parent_id].push(p)
    }
  })

  function renderTree(pageList, depth = 0) {
    return pageList.map((p) => (
      <div key={p.id}>
        <button
          type="button"
          className={`wiki-tree-item${selectedPage?.id === p.id ? ' wiki-tree-item--active' : ''}`}
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => handleSelectPage(p)}
        >
          <span className="wiki-tree-icon">{childMap[p.id] ? '\uD83D\uDCC2' : '\uD83D\uDCC4'}</span>
          <span className="wiki-tree-title">{p.title}</span>
        </button>
        {childMap[p.id] && renderTree(childMap[p.id], depth + 1)}
      </div>
    ))
  }

  if (!projectId) {
    return <section className="page"><p>Select a project to view its wiki.</p></section>
  }

  return (
    <section className="page wiki-page">
      <div className="wiki-layout">
        <aside className="wiki-sidebar">
          <div className="wiki-sidebar-header">
            <h3>Wiki Pages</h3>
            {canEditIssue && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                + New
              </button>
            )}
          </div>
          {/* Search bar */}
          <div className="wiki-search">
            <input
              className="wiki-search-input"
              placeholder="Search pages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            />
          </div>
          {searchResults !== null ? (
            <div className="wiki-search-results">
              <div className="wiki-search-header">
                <span>{searchResults.length} results</span>
                <button type="button" className="wiki-search-clear" onClick={() => setSearchResults(null)}>Clear</button>
              </div>
              {searchResults.map((p) => (
                <button key={p.id} type="button" className="wiki-tree-item" onClick={() => handleSelectPage(p)}>
                  <span className="wiki-tree-title">{p.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="wiki-tree">
              {pages.length === 0 ? (
                <p className="wiki-empty-tree">No pages yet.</p>
              ) : (
                renderTree(rootPages)
              )}
            </div>
          )}
        </aside>

        <div className="wiki-content">
          {showCreate && (
            <div className="wiki-create-form">
              <h2>Create Wiki Page</h2>
              <input className="wiki-input" placeholder="Page title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              <select className="wiki-input" value={form.parentId || ''} onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">No parent (root page)</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              <textarea className="wiki-textarea" rows={12} placeholder="Write page content in Markdown..." value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
              <div className="wiki-form-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate}>Create</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
              </div>
            </div>
          )}

          {!showCreate && !selectedPage && (
            <div className="wiki-placeholder">
              <h2>Project Wiki</h2>
              <p>Select a page from the sidebar or create a new one.</p>
            </div>
          )}

          {!showCreate && selectedPage && !isEditing && (
            <div className="wiki-view">
              <div className="wiki-view-header">
                <h1>{selectedPage.title}</h1>
                <div className="wiki-view-actions">
                  {canEditIssue && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>Edit</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={handleShowVersions}>
                        History
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm wiki-delete-btn" onClick={() => handleDelete(selectedPage.id)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
              <div className="wiki-meta">
                <span>Created by {selectedPage.created_by}</span>
                <span>Updated {new Date(selectedPage.updated_at).toLocaleDateString()}</span>
              </div>

              {/* Version diff view */}
              {diffVersion && (
                <div className="wiki-diff-panel">
                  <div className="wiki-diff-header">
                    <strong>Version {diffVersion.version_number}</strong> by {diffVersion.edited_by} on {new Date(diffVersion.created_at).toLocaleDateString()}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDiffVersion(null)}>Close</button>
                  </div>
                  <pre className="wiki-content-pre wiki-diff-content">{diffVersion.content}</pre>
                </div>
              )}

              {/* Version history */}
              {showVersions && !diffVersion && (
                <div className="wiki-versions-panel">
                  <div className="wiki-versions-header">
                    <strong>Version History</strong>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowVersions(false)}>Close</button>
                  </div>
                  {versions.length === 0 ? (
                    <p className="wiki-empty-content">No version history.</p>
                  ) : (
                    versions.map((v) => (
                      <button key={v.id} type="button" className="wiki-version-item" onClick={() => handleViewVersion(v.id)}>
                        <span>v{v.version_number}</span>
                        <span>{v.edited_by}</span>
                        <span>{new Date(v.created_at).toLocaleDateString()}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="wiki-body">
                {selectedPage.content ? (
                  <pre className="wiki-content-pre">{selectedPage.content}</pre>
                ) : (
                  <p className="wiki-empty-content">No content yet.</p>
                )}
              </div>

              {/* Linked issues */}
              <div className="wiki-linked-section">
                <h3>Linked Issues</h3>
                {selectedPage.linkedIssues && selectedPage.linkedIssues.length > 0 ? (
                  <div className="wiki-linked-list">
                    {selectedPage.linkedIssues.map((li) => (
                      <div key={li.link_id} className="wiki-linked-item">
                        <span className="wiki-linked-key">{li.issue_key}</span>
                        <span className="wiki-linked-title">{li.issue_title}</span>
                        {canEditIssue && (
                          <button type="button" className="wiki-linked-remove" onClick={() => handleUnlinkIssue(li.issue_id)}>&times;</button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="wiki-empty-content">No linked issues.</p>
                )}
                {canEditIssue && (
                  <div className="wiki-link-form">
                    <input className="wiki-input" placeholder="Issue ID to link" value={linkIssueId} onChange={(e) => setLinkIssueId(e.target.value)} style={{ width: '120px', display: 'inline-block', marginRight: '8px', marginBottom: 0 }} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleLinkIssue}>Link</button>
                  </div>
                )}
              </div>

              {selectedPage.children && selectedPage.children.length > 0 && (
                <div className="wiki-children">
                  <h3>Child Pages</h3>
                  {selectedPage.children.map((c) => (
                    <button key={c.id} type="button" className="wiki-child-link" onClick={() => handleSelectPage(c)}>
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!showCreate && selectedPage && isEditing && (
            <div className="wiki-edit-form">
              <h2>Edit Page</h2>
              <input className="wiki-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              <textarea className="wiki-textarea" rows={16} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
              <div className="wiki-form-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsEditing(false)}>Cancel</button>
              </div>
            </div>
          )}

          {loading && <p className="wiki-loading">Loading...</p>}
        </div>
      </div>
    </section>
  )
}
