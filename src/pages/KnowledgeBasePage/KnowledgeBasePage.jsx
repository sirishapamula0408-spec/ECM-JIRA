import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePermissions } from '../../hooks/usePermissions'
import {
  fetchKbCategories, createKbCategory,
  fetchKbArticles, fetchKbArticle, createKbArticle, updateKbArticle, deleteKbArticle,
} from '../../api/kbApi'
import './KnowledgeBasePage.css'

// Minimal, safe markdown-ish renderer: escapes HTML then applies a few inline
// rules. Good enough for help-article previews without pulling in a dependency.
function renderMarkdown(md) {
  const esc = String(md || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return esc
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, '<br />')
}

const EMPTY_ARTICLE = { title: '', body: '', categoryId: '', status: 'draft' }

export function KnowledgeBasePage() {
  const { isAdmin, canCreateIssue: canAuthor } = usePermissions()
  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState([])
  const [activeCategory, setActiveCategory] = useState(null) // null = all
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null) // full article object
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_ARTICLE)
  const [newCategory, setNewCategory] = useState('')
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('') // '', 'draft', 'published'

  const loadCategories = useCallback(() => {
    fetchKbCategories().then((d) => setCategories(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const loadArticles = useCallback(() => {
    fetchKbArticles({ search: search || undefined, category: activeCategory || undefined, status: statusFilter || undefined })
      .then((d) => setArticles(Array.isArray(d) ? d : []))
      .catch(() => setArticles([]))
  }, [search, activeCategory, statusFilter])

  useEffect(() => { loadCategories() }, [loadCategories])
  useEffect(() => { loadArticles() }, [loadArticles])

  const openArticle = useCallback((id) => {
    setEditing(false)
    fetchKbArticle(id).then((a) => setSelected(a)).catch(() => setError('Failed to load article'))
  }, [])

  function startCreate() {
    setSelected(null)
    setForm({ ...EMPTY_ARTICLE, categoryId: activeCategory || '' })
    setEditing(true)
    setError('')
  }

  function startEdit() {
    if (!selected) return
    setForm({
      title: selected.title || '',
      body: selected.body || '',
      categoryId: selected.category_id || '',
      status: selected.status || 'draft',
    })
    setEditing(true)
    setError('')
  }

  async function saveArticle(e) {
    e.preventDefault()
    setError('')
    const payload = {
      title: form.title,
      body: form.body,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      status: form.status,
    }
    try {
      const saved = selected
        ? await updateKbArticle(selected.id, payload)
        : await createKbArticle(payload)
      setEditing(false)
      setSelected(saved)
      loadArticles()
    } catch (err) {
      setError(err?.message || 'Failed to save article')
    }
  }

  async function publishToggle() {
    if (!selected) return
    const next = selected.status === 'published' ? 'draft' : 'published'
    try {
      const saved = await updateKbArticle(selected.id, { status: next })
      setSelected(saved)
      loadArticles()
    } catch (err) {
      setError(err?.message || 'Failed to update status')
    }
  }

  async function removeArticle() {
    if (!selected || !window.confirm(`Delete article "${selected.title}"?`)) return
    await deleteKbArticle(selected.id).catch(() => {})
    setSelected(null)
    loadArticles()
  }

  async function addCategory(e) {
    e.preventDefault()
    if (!newCategory.trim()) return
    try {
      await createKbCategory({ name: newCategory.trim() })
      setNewCategory('')
      loadCategories()
    } catch (err) {
      setError(err?.message || 'Failed to add category')
    }
  }

  const rendered = useMemo(() => renderMarkdown(selected?.body), [selected])

  return (
    <div className="page kb-page">
      <header className="kb-header">
        <h1>Knowledge Base</h1>
        <p className="kb-subtitle">Help articles for customers — searchable, categorized, publishable.</p>
      </header>

      <div className="kb-layout">
        {/* Category sidebar */}
        <aside className="kb-sidebar" aria-label="Categories">
          <button
            type="button"
            className={`kb-cat${activeCategory === null ? ' kb-cat--active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            All articles
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`kb-cat${activeCategory === c.id ? ' kb-cat--active' : ''}`}
              onClick={() => setActiveCategory(c.id)}
            >
              <span className="kb-cat-name">{c.name}</span>
              <span className="kb-cat-count">{c.article_count ?? 0}</span>
            </button>
          ))}
          {isAdmin && (
            <form className="kb-add-cat" onSubmit={addCategory}>
              <input
                type="text"
                placeholder="New category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                aria-label="New category name"
              />
              <button type="submit" className="btn btn-ghost">Add</button>
            </form>
          )}
        </aside>

        {/* Article list */}
        <section className="kb-list" aria-label="Articles">
          <div className="kb-list-toolbar">
            <input
              type="search"
              className="search kb-search"
              placeholder="Search articles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search articles"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="">All</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
            {canAuthor && (
              <button type="button" className="btn btn-primary" onClick={startCreate}>New article</button>
            )}
          </div>
          {articles.length === 0 ? (
            <p className="kb-empty">No articles found.</p>
          ) : (
            <ul className="kb-article-list">
              {articles.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={`kb-article-row${selected?.id === a.id ? ' kb-article-row--active' : ''}`}
                    onClick={() => openArticle(a.id)}
                  >
                    <span className="kb-article-title">{a.title}</span>
                    <span className={`kb-badge kb-badge--${a.status}`}>{a.status}</span>
                    {a.category_name && <span className="kb-article-cat">{a.category_name}</span>}
                    <span className="kb-article-views">{a.views ?? 0} views</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Viewer / editor */}
        <section className="kb-viewer" aria-label="Article">
          {error && <p className="banner error" role="alert">{error}</p>}

          {editing ? (
            <form className="kb-editor" onSubmit={saveArticle}>
              <input
                type="text"
                placeholder="Article title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
                aria-label="Article title"
              />
              <div className="kb-editor-meta">
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                  aria-label="Category"
                >
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  aria-label="Status"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
              <textarea
                rows={16}
                placeholder="Write the article body (markdown supported)..."
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                aria-label="Article body"
              />
              <div className="kb-editor-actions">
                <button type="submit" className="btn btn-primary">Save</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setError('') }}>Cancel</button>
              </div>
            </form>
          ) : selected ? (
            <article className="kb-article">
              <div className="kb-article-head">
                <h2>{selected.title}</h2>
                <span className={`kb-badge kb-badge--${selected.status}`}>{selected.status}</span>
              </div>
              <p className="kb-article-byline">
                {selected.category_name && <span>{selected.category_name} · </span>}
                {selected.author_email && <span>by {selected.author_email} · </span>}
                <span>{selected.views ?? 0} views</span>
              </p>
              {/* eslint-disable-next-line react/no-danger */}
              <div className="kb-article-body" dangerouslySetInnerHTML={{ __html: rendered }} />
              {canAuthor && (
                <div className="kb-article-actions">
                  <button type="button" className="btn btn-ghost" onClick={startEdit}>Edit</button>
                  <button type="button" className="btn btn-ghost" onClick={publishToggle}>
                    {selected.status === 'published' ? 'Unpublish' : 'Publish'}
                  </button>
                  {isAdmin && <button type="button" className="btn btn-danger" onClick={removeArticle}>Delete</button>}
                </div>
              )}
            </article>
          ) : (
            <p className="kb-empty">Select an article to read, or create a new one.</p>
          )}
        </section>
      </div>
    </div>
  )
}
