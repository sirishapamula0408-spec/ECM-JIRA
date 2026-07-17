import { useEffect, useState, useCallback } from 'react'
import { fetchPlugins, registerPlugin, updatePlugin, deletePlugin } from '../../api/pluginApi'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import './PluginsPage.css'

const EXTENSION_POINTS = ['issue-panel', 'nav-item', 'issue-action', 'dashboard-gadget', 'webhook']

const SAMPLE_MANIFEST = JSON.stringify(
  {
    appKey: 'my-app',
    name: 'My Sample App',
    version: '1.0.0',
    contributions: [
      { extensionPoint: 'nav-item', id: 'my-nav', label: 'My App', icon: '🧩', url: 'https://example.com/app' },
      { extensionPoint: 'issue-panel', id: 'my-panel', label: 'App Info', url: 'https://example.com/issue' },
    ],
  },
  null,
  2,
)

export function PluginsPage() {
  const { isAdmin } = usePermissions()
  const [plugins, setPlugins] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [manifestText, setManifestText] = useState(SAMPLE_MANIFEST)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetchPlugins()
      .then((data) => setPlugins(Array.isArray(data) ? data : []))
      .catch(() => setPlugins([]))
  }, [])

  useEffect(load, [load])

  async function handleRegister() {
    setError('')
    let parsed
    try {
      parsed = JSON.parse(manifestText)
    } catch {
      setError('Manifest is not valid JSON.')
      return
    }
    try {
      await registerPlugin(parsed)
      setShowForm(false)
      setManifestText(SAMPLE_MANIFEST)
      load()
    } catch (err) {
      const errs = err?.data?.errors
      setError(Array.isArray(errs) ? errs.join('; ') : (err?.message || 'Failed to register manifest.'))
    }
  }

  async function handleToggle(plugin) {
    await updatePlugin(plugin.id, { enabled: !plugin.enabled })
    load()
  }

  async function handleDelete(id) {
    await deletePlugin(id)
    load()
  }

  return (
    <section className="page plugins-page">
      <div className="pl-header">
        <div>
          <h1>Apps &amp; Plugins</h1>
          <p className="pl-subtitle">
            Apps register a declarative manifest that contributes to extension points
            ({EXTENSION_POINTS.join(', ')}). Contributions are safe data — links and labels rendered by the host, never executed code.
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ Register App'}
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <div className="pl-form">
          <h3>Register a manifest</h3>
          <p className="pl-hint">Paste a manifest JSON. Each contribution must target a known extension point and have an id and label. URLs must be http(s) or a relative /path.</p>
          <textarea
            className="pl-textarea"
            rows={14}
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            spellCheck={false}
          />
          {error && <div className="pl-error">{error}</div>}
          <div className="pl-form-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={handleRegister}>Register</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setError('') }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="pl-list">
        {plugins.length === 0 && (
          <EmptyState
            icon="🧩"
            title="No apps registered"
            description="Register an app manifest to contribute nav items, issue panels, and more."
          />
        )}
        {plugins.map((plugin) => (
          <div key={plugin.id} className={`pl-card${plugin.enabled ? '' : ' pl-card--disabled'}`}>
            <div className="pl-card-header">
              <div className="pl-card-title">
                <span className={`pl-status-dot${plugin.enabled ? ' pl-status-dot--active' : ''}`} />
                <strong>{plugin.name}</strong>
                <span className="pl-version">v{plugin.version}</span>
                {plugin.appKey && <span className="pl-appkey">{plugin.appKey}</span>}
              </div>
              {isAdmin && (
                <div className="pl-card-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleToggle(plugin)}>
                    {plugin.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm pl-delete-btn" onClick={() => handleDelete(plugin.id)}>Delete</button>
                </div>
              )}
            </div>
            <div className="pl-contributions">
              {(plugin.contributions || []).map((c) => (
                <div key={c.id} className="pl-contribution">
                  <span className="pl-contribution-point">{c.extensionPoint}</span>
                  {c.icon && <span className="pl-contribution-icon" aria-hidden="true">{c.icon}</span>}
                  <span className="pl-contribution-label">{c.label}</span>
                  {c.url && <span className="pl-contribution-url">{c.url}</span>}
                </div>
              ))}
              {(!plugin.contributions || plugin.contributions.length === 0) && (
                <span className="pl-empty">No contributions</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
