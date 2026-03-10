import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchFilters, createFilter, updateFilter, deleteFilter, searchIssues, searchByJql, aiSearch } from '../../api/filterApi'
import { fetchProjects } from '../../api/projectApi'
import { FilterChip } from '../../components/filters/FilterChip'
import { ISSUE_STATUSES, PRIORITIES, ISSUE_TYPES } from '../../constants'
import './FiltersPage.css'

const EMPTY_CRITERIA = { status: 'All', priority: 'All', issueType: 'All', assignee: '', text: '', projectId: 'All' }

export function FiltersPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeFilterId, setActiveFilterId] = useState(null)
  const [criteria, setCriteria] = useState({ ...EMPTY_CRITERIA })
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDesc, setSaveDesc] = useState('')
  const [saveError, setSaveError] = useState('')
  const [view, setView] = useState('list') // 'list' or 'search'
  const [searchMode, setSearchMode] = useState('basic') // 'basic', 'jql', or 'ai'
  const [jqlQuery, setJqlQuery] = useState('')
  const [jqlError, setJqlError] = useState('')
  const [showJqlHelp, setShowJqlHelp] = useState(false)
  const [aiQuery, setAiQuery] = useState('')
  const [aiError, setAiError] = useState('')
  const [aiInterpreted, setAiInterpreted] = useState([])
  const [projects, setProjects] = useState([])

  const loadFilters = useCallback(() => {
    fetchFilters()
      .then((data) => setFilters(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadFilters() }, [loadFilters])

  useEffect(() => {
    fetchProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  function handleSearch() {
    setSearching(true)
    setResults(null)
    const searchCriteria = { ...criteria }
    if (searchCriteria.projectId === 'All') delete searchCriteria.projectId
    searchIssues(searchCriteria)
      .then((data) => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }

  function handleJqlSearch() {
    if (!jqlQuery.trim()) return
    setSearching(true)
    setResults(null)
    setJqlError('')
    searchByJql(jqlQuery.trim())
      .then((data) => setResults(Array.isArray(data) ? data : []))
      .catch((err) => { setJqlError(err.message || 'Invalid JQL query'); setResults([]) })
      .finally(() => setSearching(false))
  }

  function handleAiSearch() {
    if (!aiQuery.trim()) return
    setSearching(true)
    setResults(null)
    setAiError('')
    setAiInterpreted([])
    aiSearch(aiQuery.trim())
      .then((data) => {
        setResults(Array.isArray(data.issues) ? data.issues : [])
        setAiInterpreted(Array.isArray(data.interpreted) ? data.interpreted : [])
      })
      .catch((err) => { setAiError(err.message || 'Could not process your query.'); setResults([]) })
      .finally(() => setSearching(false))
  }

  function handleClear() {
    setCriteria({ ...EMPTY_CRITERIA })
    setResults(null)
    setActiveFilterId(null)
    setJqlQuery('')
    setJqlError('')
    setAiQuery('')
    setAiError('')
    setAiInterpreted([])
  }

  function handleLoadFilter(filter) {
    setActiveFilterId(filter.id)
    const c = filter.criteria || {}
    setCriteria({
      status: c.status || 'All',
      priority: c.priority || 'All',
      issueType: c.issueType || 'All',
      assignee: c.assignee || '',
      text: c.text || '',
      projectId: c.projectId || 'All',
    })
    setView('search')
    setSearching(true)
    searchIssues(filter.criteria || {})
      .then((data) => setResults(Array.isArray(data) ? data : []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }

  async function handleSaveFilter(event) {
    event.preventDefault()
    setSaveError('')
    if (!saveName.trim()) { setSaveError('Filter name is required'); return }
    try {
      const created = await createFilter({ name: saveName.trim(), description: saveDesc.trim(), criteria })
      setFilters((prev) => [created, ...prev])
      setActiveFilterId(created.id)
      setShowSave(false)
      setSaveName('')
      setSaveDesc('')
    } catch (err) { setSaveError(err.message) }
  }

  async function handleUpdateFilter() {
    if (!activeFilterId) return
    const updated = await updateFilter(activeFilterId, { criteria })
    setFilters((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
  }

  async function handleToggleStar(filter) {
    const updated = await updateFilter(filter.id, { isStarred: !filter.isStarred })
    setFilters((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
  }

  async function handleDeleteFilter(filter) {
    if (!window.confirm(`Delete filter "${filter.name}"?`)) return
    await deleteFilter(filter.id)
    setFilters((prev) => prev.filter((f) => f.id !== filter.id))
    if (activeFilterId === filter.id) { setActiveFilterId(null); handleClear() }
  }

  const hasCriteria = criteria.status !== 'All' || criteria.priority !== 'All' || criteria.issueType !== 'All' || criteria.projectId !== 'All' || criteria.assignee.trim() || criteria.text.trim()
  const activeFilter = filters.find((f) => f.id === activeFilterId)

  const statusOptions = ['All', ...ISSUE_STATUSES]
  const priorityOptions = ['All', ...PRIORITIES]
  const typeOptions = ['All', ...ISSUE_TYPES]
  const projectOptions = ['All', ...projects.map((p) => p.name)]

  return (
    <section className="page filters-page">
      <div className="filters-header">
        <div>
          <h1>Filters</h1>
          <p className="filters-subtitle">Create and manage saved filters to quickly find issues.</p>
        </div>
        <div className="filters-header-actions">
          <button
            className={`btn ${view === 'list' ? 'btn-primary' : 'btn-ghost'}`}
            type="button"
            onClick={() => setView('list')}
          >
            My Filters
          </button>
          <button
            className={`btn ${view === 'search' ? 'btn-primary' : 'btn-ghost'}`}
            type="button"
            onClick={() => setView('search')}
          >
            Search Issues
          </button>
        </div>
      </div>

      {view === 'search' && (
        <>
          {/* Mode toggle: Basic / JQL */}
          <div className="filters-mode-toggle">
            <button
              className={`filters-mode-btn ${searchMode === 'basic' ? 'filters-mode-btn--active' : ''}`}
              type="button"
              onClick={() => setSearchMode('basic')}
            >
              Basic
            </button>
            <button
              className={`filters-mode-btn ${searchMode === 'jql' ? 'filters-mode-btn--active' : ''}`}
              type="button"
              onClick={() => setSearchMode('jql')}
            >
              JQL
            </button>
            <button
              className={`filters-mode-btn filters-mode-btn--ai ${searchMode === 'ai' ? 'filters-mode-btn--active' : ''}`}
              type="button"
              onClick={() => setSearchMode('ai')}
            >
              Ask AI
            </button>
          </div>

          {searchMode === 'basic' && (
            <>
              {/* Filter criteria bar */}
              <div className="filters-criteria-bar">
                <FilterChip label="Status" value={criteria.status} options={statusOptions} onChange={(v) => setCriteria((c) => ({ ...c, status: v }))} onClear={() => setCriteria((c) => ({ ...c, status: 'All' }))} />
                <FilterChip label="Priority" value={criteria.priority} options={priorityOptions} onChange={(v) => setCriteria((c) => ({ ...c, priority: v }))} onClear={() => setCriteria((c) => ({ ...c, priority: 'All' }))} />
                <FilterChip label="Type" value={criteria.issueType} options={typeOptions} onChange={(v) => setCriteria((c) => ({ ...c, issueType: v }))} onClear={() => setCriteria((c) => ({ ...c, issueType: 'All' }))} />
                <FilterChip
                  label="Project"
                  value={criteria.projectId === 'All' ? 'All' : (projects.find((p) => String(p.id) === String(criteria.projectId))?.name || 'All')}
                  options={projectOptions}
                  onChange={(v) => {
                    if (v === 'All') {
                      setCriteria((c) => ({ ...c, projectId: 'All' }))
                    } else {
                      const proj = projects.find((p) => p.name === v)
                      setCriteria((c) => ({ ...c, projectId: proj ? String(proj.id) : 'All' }))
                    }
                  }}
                  onClear={() => setCriteria((c) => ({ ...c, projectId: 'All' }))}
                />
                <div className="filters-text-input-wrap">
                  <input
                    className="filters-text-input"
                    type="text"
                    placeholder="Assignee"
                    value={criteria.assignee}
                    onChange={(e) => setCriteria((c) => ({ ...c, assignee: e.target.value }))}
                  />
                </div>
                <div className="filters-text-input-wrap">
                  <input
                    className="filters-text-input"
                    type="text"
                    placeholder="Search text or key"
                    value={criteria.text}
                    onChange={(e) => setCriteria((c) => ({ ...c, text: e.target.value }))}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="filters-actions-bar">
                <button className="btn btn-primary" type="button" onClick={handleSearch} disabled={searching}>
                  {searching ? 'Searching...' : 'Search'}
                </button>
                {hasCriteria && (
                  <button className="btn btn-ghost" type="button" onClick={handleClear}>Clear All</button>
                )}
                {hasCriteria && !activeFilterId && (
                  <button className="btn btn-ghost filters-save-btn" type="button" onClick={() => setShowSave(true)}>
                    Save as Filter
                  </button>
                )}
                {activeFilterId && hasCriteria && (
                  <button className="btn btn-ghost" type="button" onClick={handleUpdateFilter}>
                    Update Filter
                  </button>
                )}
                {activeFilter && (
                  <span className="filters-active-label">Active: <strong>{activeFilter.name}</strong></span>
                )}
              </div>
            </>
          )}

          {searchMode === 'jql' && (
            <>
              {/* JQL Editor */}
              <div className="jql-editor-wrap">
                <div className="jql-editor-header">
                  <label className="jql-editor-label" htmlFor="jql-input">JQL Query</label>
                  <button className="link-btn jql-help-toggle" type="button" onClick={() => setShowJqlHelp((v) => !v)}>
                    {showJqlHelp ? 'Hide syntax help' : 'Syntax help'}
                  </button>
                </div>
                <textarea
                  id="jql-input"
                  className="jql-editor-textarea"
                  rows={3}
                  placeholder='e.g. status = "In Progress" AND priority = High ORDER BY created DESC'
                  value={jqlQuery}
                  onChange={(e) => setJqlQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleJqlSearch() }}
                />
                {jqlError && <p className="jql-error">{jqlError}</p>}
              </div>

              {showJqlHelp && (
                <div className="jql-help-panel">
                  <h4>JQL Syntax Reference</h4>
                  <table className="jql-help-table">
                    <thead>
                      <tr><th>Field</th><th>Operators</th><th>Example</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>status</td><td>= != IN NOT IN</td><td>status = "In Progress"</td></tr>
                      <tr><td>priority</td><td>= != IN NOT IN</td><td>priority IN (High, Medium)</td></tr>
                      <tr><td>type / issueType</td><td>= != IN NOT IN</td><td>type = Bug</td></tr>
                      <tr><td>assignee</td><td>= != ~ !~ IS IS NOT</td><td>assignee ~ "john"</td></tr>
                      <tr><td>summary / title</td><td>~ !~</td><td>summary ~ "login"</td></tr>
                      <tr><td>key</td><td>= ~</td><td>key = "PROJ-10"</td></tr>
                      <tr><td>project</td><td>=</td><td>project = 1</td></tr>
                    </tbody>
                  </table>
                  <p className="jql-help-note">
                    Combine clauses with <code>AND</code>. Add <code>ORDER BY field ASC/DESC</code> at the end.
                    <br />
                    Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to run the query.
                  </p>
                </div>
              )}

              {/* JQL Action buttons */}
              <div className="filters-actions-bar">
                <button className="btn btn-primary" type="button" onClick={handleJqlSearch} disabled={searching || !jqlQuery.trim()}>
                  {searching ? 'Searching...' : 'Search'}
                </button>
                {jqlQuery.trim() && (
                  <button className="btn btn-ghost" type="button" onClick={handleClear}>Clear</button>
                )}
              </div>
            </>
          )}

          {searchMode === 'ai' && (
            <>
              {/* Ask AI Editor */}
              <div className="ai-search-wrap">
                <div className="ai-search-header">
                  <div className="ai-search-label-row">
                    <span className="ai-search-icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
                        <path d="M6 10a6 6 0 0 0 12 0" />
                        <line x1="12" y1="16" x2="12" y2="22" />
                        <line x1="8" y1="22" x2="16" y2="22" />
                      </svg>
                    </span>
                    <label className="ai-search-label" htmlFor="ai-input">Describe what you're looking for</label>
                  </div>
                </div>
                <textarea
                  id="ai-input"
                  className="ai-search-textarea"
                  rows={2}
                  placeholder='e.g. "Show me all high priority bugs assigned to John that are in progress"'
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAiSearch() }}
                />
                {aiError && <p className="ai-search-error">{aiError}</p>}
              </div>

              {/* Interpreted criteria chips */}
              {aiInterpreted.length > 0 && (
                <div className="ai-interpreted">
                  <span className="ai-interpreted-label">Understood as:</span>
                  {aiInterpreted.map((item, i) => (
                    <span key={i} className="ai-interpreted-chip">{item}</span>
                  ))}
                </div>
              )}

              {/* AI search example hints */}
              {!aiQuery.trim() && results === null && (
                <div className="ai-examples">
                  <p className="ai-examples-title">Try asking things like:</p>
                  <div className="ai-examples-list">
                    {[
                      'Show me all high priority bugs',
                      'Tasks assigned to John that are in progress',
                      'Unassigned stories in backlog',
                      'Latest bugs in code review',
                      'Critical issues containing login',
                    ].map((example) => (
                      <button
                        key={example}
                        className="ai-example-btn"
                        type="button"
                        onClick={() => { setAiQuery(example); }}
                      >
                        "{example}"
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Action buttons */}
              <div className="filters-actions-bar">
                <button className="btn btn-primary ai-search-btn" type="button" onClick={handleAiSearch} disabled={searching || !aiQuery.trim()}>
                  {searching ? 'Searching...' : 'Ask AI'}
                </button>
                {aiQuery.trim() && (
                  <button className="btn btn-ghost" type="button" onClick={handleClear}>Clear</button>
                )}
              </div>
            </>
          )}

          {/* Save filter form */}
          {showSave && (
            <article className="panel filters-save-panel">
              <h3>Save Filter</h3>
              <form className="filters-save-form" onSubmit={handleSaveFilter}>
                <label>
                  Name <span className="filters-required">*</span>
                  <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. My Open Bugs" required />
                </label>
                <label>
                  Description
                  <input value={saveDesc} onChange={(e) => setSaveDesc(e.target.value)} placeholder="Optional description" />
                </label>
                <div className="filters-save-actions">
                  <button className="btn btn-primary" type="submit">Save</button>
                  <button className="btn btn-ghost" type="button" onClick={() => { setShowSave(false); setSaveError('') }}>Cancel</button>
                </div>
              </form>
              {saveError && <p className="banner error">{saveError}</p>}
            </article>
          )}

          {/* Search results */}
          {results !== null && (
            <article className="panel filters-results-panel">
              <div className="filters-results-header">
                <h3>{results.length} issue{results.length !== 1 ? 's' : ''} found</h3>
              </div>
              {results.length === 0 ? (
                <div className="filters-empty">No issues match the current filter criteria.</div>
              ) : (
                <table className="table filters-results-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Summary</th>
                      <th>Type</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Assignee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((issue) => (
                      <tr key={issue.id} className="filters-result-row" onClick={() => navigate(`/issues/${issue.id}`)}>
                        <td><span className="filters-issue-key">{issue.key}</span></td>
                        <td className="filters-issue-title">{issue.title}</td>
                        <td><span className={`filters-type-badge filters-type-${issue.issueType.toLowerCase()}`}>{issue.issueType}</span></td>
                        <td><span className={`filters-priority-badge filters-priority-${issue.priority.toLowerCase()}`}>{issue.priority}</span></td>
                        <td><span className="filters-status-pill">{issue.status}</span></td>
                        <td>
                          <div className="filters-assignee-cell">
                            <span className="filters-assignee-avatar">{issue.assignee.charAt(0).toUpperCase()}</span>
                            {issue.assignee}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          )}
        </>
      )}

      {view === 'list' && (
        <article className="panel filters-list-panel">
          {loading ? (
            <div className="filters-empty">Loading filters...</div>
          ) : filters.length === 0 ? (
            <div className="filters-empty-state">
              <div className="filters-empty-icon" aria-hidden="true">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#b3bac5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
              </div>
              <h3>No saved filters</h3>
              <p>Use the "Search Issues" tab to create criteria and save them as a reusable filter.</p>
              <button className="btn btn-primary" type="button" onClick={() => setView('search')}>Create a Filter</button>
            </div>
          ) : (
            <table className="table filters-list-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Criteria</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filters.map((filter) => {
                  const c = filter.criteria || {}
                  const chips = []
                  if (c.status && c.status !== 'All') chips.push(`Status: ${c.status}`)
                  if (c.priority && c.priority !== 'All') chips.push(`Priority: ${c.priority}`)
                  if (c.issueType && c.issueType !== 'All') chips.push(`Type: ${c.issueType}`)
                  if (c.projectId && c.projectId !== 'All') {
                    const proj = projects.find((p) => String(p.id) === String(c.projectId))
                    chips.push(`Project: ${proj ? proj.name : c.projectId}`)
                  }
                  if (c.assignee) chips.push(`Assignee: ${c.assignee}`)
                  if (c.text) chips.push(`Text: "${c.text}"`)

                  return (
                    <tr key={filter.id} className="filters-list-row">
                      <td>
                        <button className="filters-star-btn" type="button" onClick={() => handleToggleStar(filter)} title={filter.isStarred ? 'Unstar' : 'Star'}>
                          {filter.isStarred ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="#ffab00" stroke="#ffab00" strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b3bac5" strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                          )}
                        </button>
                      </td>
                      <td>
                        <button className="filters-name-link" type="button" onClick={() => handleLoadFilter(filter)}>
                          {filter.name}
                        </button>
                      </td>
                      <td className="filters-desc-cell">{filter.description || '-'}</td>
                      <td>
                        <div className="filters-criteria-chips">
                          {chips.length > 0 ? chips.map((chip) => (
                            <span key={chip} className="filters-criteria-chip">{chip}</span>
                          )) : <span className="filters-criteria-chip filters-criteria-chip--empty">All issues</span>}
                        </div>
                      </td>
                      <td className="filters-date-cell">{new Date(filter.updatedAt).toLocaleDateString()}</td>
                      <td>
                        <div className="filters-row-actions">
                          <button className="link-btn" type="button" onClick={() => handleLoadFilter(filter)}>Run</button>
                          <button className="link-btn filters-delete-btn" type="button" onClick={() => handleDeleteFilter(filter)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </article>
      )}
    </section>
  )
}
