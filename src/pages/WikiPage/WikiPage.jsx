import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { fetchWikiPages, fetchWikiPage, createWikiPage, updateWikiPage, deleteWikiPage } from '../../api/wikiApi'
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

  function startEdit() {
    setForm({ title: selectedPage.title, content: selectedPage.content, parentId: selectedPage.parent_id })
    setIsEditing(true)
  }

  // Build tree structure
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
        {/* Sidebar tree */}
        <aside className="wiki-sidebar">
          <div className="wiki-sidebar-header">
            <h3>Wiki Pages</h3>
            {canEditIssue && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                + New
              </button>
            )}
          </div>
          <div className="wiki-tree">
            {pages.length === 0 ? (
              <p className="wiki-empty-tree">No pages yet.</p>
            ) : (
              renderTree(rootPages)
            )}
          </div>
        </aside>

        {/* Content area */}
        <div className="wiki-content">
          {showCreate && (
            <div className="wiki-create-form">
              <h2>Create Wiki Page</h2>
              <input
                className="wiki-input"
                placeholder="Page title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
              <select
                className="wiki-input"
                value={form.parentId || ''}
                onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">No parent (root page)</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              <textarea
                className="wiki-textarea"
                rows={12}
                placeholder="Write page content in Markdown..."
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              />
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
                      <button type="button" className="btn btn-ghost btn-sm wiki-delete-btn" onClick={() => handleDelete(selectedPage.id)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
              <div className="wiki-meta">
                <span>Created by {selectedPage.created_by}</span>
                <span>Updated {new Date(selectedPage.updated_at).toLocaleDateString()}</span>
              </div>
              <div className="wiki-body">
                {selectedPage.content ? (
                  <pre className="wiki-content-pre">{selectedPage.content}</pre>
                ) : (
                  <p className="wiki-empty-content">No content yet.</p>
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
              <input
                className="wiki-input"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
              <textarea
                className="wiki-textarea"
                rows={16}
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              />
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
