import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePermissions } from '../../hooks/usePermissions'
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning'
import { useConfirm } from '../../components/common/ConfirmDialog'
import { EmptyState } from '../../components/common/EmptyState'
import {
  fetchKbCategories, createKbCategory,
  fetchKbArticles, fetchKbArticle, createKbArticle, updateKbArticle, deleteKbArticle,
} from '../../api/kbApi'
import './KnowledgeBasePage.css'
import { usePageTitle } from '../../hooks/usePageTitle'
import { sanitizeHtml } from '../../utils/sanitizeHtml'

// Minimal, safe markdown-ish renderer: escapes HTML then applies a few inline
// rules. Good enough for help-article previews without pulling in a dependency.
//
// JL-344 (stored XSS): KB articles are written by one user and rendered to
// every reader via dangerouslySetInnerHTML below, so anything this function
// emits runs in the reader's session. Two things were wrong:
//   1. The escape step did not escape `"`. The link rule interpolates the
//      captured URL straight into a double-quoted href, so an article body of
//      `[click](https://x" onmouseover="alert(document.cookie))` closed the
//      href early and emitted a live event handler.
//   2. The generated HTML was never sanitized before injection.
// Both are fixed: quotes are escaped at the source (so no attribute breakout
// is possible in the first place), AND the result goes through sanitizeHtml()
// exactly as RichTextEditor does (JL-91). Belt and braces on purpose — the
// sanitizer alone would drop the `on*` handler, but escaping the input means a
// future rule added to this pipeline cannot silently re-open the hole.
function renderMarkdown(md) {
  const esc = String(md || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  const html = esc
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // JL-344: the URL text is now entity-escaped, so `&` became `&amp;` and
    // `'` became `&#39;`. Undo those two substitutions for the href value only
    // — sanitizeHtml re-escapes attribute values, and without this a
    // legitimate `?a=1&b=2` query string would end up double-escaped
    // (`&amp;amp;`) and the link would break. `&quot;` is deliberately NOT
    // restored: that is the character that allowed the attribute breakout.
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      (_match, text, url) => {
        const href = url.replace(/&amp;/g, '&').replace(/&#39;/g, "'")
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    )
    .replace(/\n/g, '<br />')
  // JL-344: allow-list sanitize before this string reaches
  // dangerouslySetInnerHTML — drops any on* handler, javascript:/data: href
  // and non-allow-listed tag that survives the rules above.
  return sanitizeHtml(html)
}

const EMPTY_ARTICLE = { title: '', body: '', categoryId: '', status: 'draft' }

export function KnowledgeBasePage() {
  usePageTitle('Knowledge Base')
  const { isAdmin, canCreateIssue: canAuthor } = usePermissions()
  const { confirm, confirmDialog } = useConfirm()
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

  // JL-242: warn on tab close/refresh only while the article editor has
  // genuine unsaved edits — a new article with typed content, or an existing
  // article whose form differs from the saved values.
  const hasUnsavedEdits = editing && (
    selected
      ? (form.title !== (selected.title || '') ||
         form.body !== (selected.body || '') ||
         String(form.categoryId || '') !== String(selected.category_id || '') ||
         form.status !== (selected.status || 'draft'))
      : ((form.title || '').trim() !== '' || (form.body || '').trim() !== '')
  )
  useUnsavedChangesWarning(hasUnsavedEdits)

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
    if (!selected) return
    if (!(await confirm({ title: 'Delete article?', message: `Delete article "${selected.title}"?`, confirmLabel: 'Delete', danger: true }))) return
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
      {confirmDialog}
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
            <EmptyState
              icon="📚"
              title="No articles found"
              description={search || activeCategory || statusFilter
                ? 'Try a different search, category, or status filter.'
                : 'Help articles you write will appear here for customers to browse.'}
              action={canAuthor ? (
                <button type="button" className="btn btn-primary" onClick={startCreate}>New article</button>
              ) : null}
            />
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
