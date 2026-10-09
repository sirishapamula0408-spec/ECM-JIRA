import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Tooltip from '@mui/material/Tooltip'
import Drawer from '@mui/material/Drawer'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemText from '@mui/material/ListItemText'
import ListItemIcon from '@mui/material/ListItemIcon'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useAuth } from '../../context/AuthContext'
import { useMembers } from '../../context/MemberContext'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import { createWikiPage, fetchWikiPage, saveWikiDraft, publishWikiPage } from '../../api/wikiApi'
import { addFavorite, removeFavorite } from '../../api/wikiHomeApi'
import { fetchSpaces } from '../../api/spaceApi'
import { uploadPageAttachment, fileToBase64, attachmentDownloadUrl } from '../../api/wikiAttachmentApi'
import { sanitizeHtml } from '../../utils/sanitizeHtml'
import { isEmptyDoc } from '../../utils/editorContent'
import { useAuthedImages } from '../../hooks/useAuthedImages'
import { buildPageExtensions } from '../../components/editor/pageExtensions'
import { createSuggestionBridge } from '../../components/editor/suggestionBridge'
import { PAGE_ELEMENTS } from '../../components/editor/pageCommands'
import { BUILT_IN_TEMPLATES } from '../../components/editor/pageTemplates'
import { ConfluenceToolbar } from '../../components/editor/ConfluenceToolbar'
import { TableToolbar } from '../../components/editor/TableToolbar'
import { SuggestionMenu } from '../../components/editor/SuggestionMenu'
import { QuickInsertPanel } from '../../components/editor/QuickInsertPanel'
import { TemplatesDialog } from '../../components/editor/TemplatesDialog'
import { PublishDialog } from '../../components/wiki/PublishDialog'
import { PageLinkDialog } from '../../components/wiki/PageLinkDialog'
import { VersionHistoryPanel } from '../../components/wiki/VersionHistoryPanel'
import { useTrashPage } from '../../components/wiki/useTrashPage'
import '../../components/editor/pageContent.css'
import './WikiPageEditor.css'

/*
 * JL-187 (fosasoft) — the Confluence-style page editor.
 *
 * /wiki/new             a new page; nothing is stored until the first edit
 * /wiki/pages/:id/edit  an existing page
 *
 * ── Saving ──────────────────────────────────────────────────────────────────
 *
 * Autosave fires AUTOSAVE_MS after the last keystroke and goes through
 * PUT /api/wiki/:id/draft, which writes no version. A new page is created as
 * a draft (only its author can see it) on its first edit; a published page's
 * edits land in its pending draft, so readers keep the published text until
 * Publish. Saves are chained, never concurrent, so a slow request cannot
 * land after a later one and overwrite it.
 *
 * Publish is the only thing that writes a version (POST /api/wiki/:id/publish).
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 *
 * Sanitised HTML, the same pipeline as the page view (JL-76/JL-359), so what
 * is written here renders identically there.
 */

const AUTOSAVE_MS = 1500

const SAVE_LABEL = {
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved',
}

function initials(name) {
  const words = String(name || '').trim().split(/[\s@._-]+/).filter(Boolean)
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || '?'
}

export function WikiPageEditor() {
  const { pageId: routePageId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { home, reloadHome, onToggleSidebar, sidebarCollapsed } = useOutletContext() ?? {}
  const { authUser } = useAuth()
  const { members } = useMembers()

  // JL-180: the sidebar's home payload holds only its first few Spaces, so a
  // page started in any other Space had nowhere to be published. The full
  // list comes from /api/spaces; the sidebar's copy fills in until it lands.
  const [allSpaces, setAllSpaces] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchSpaces()
      .then((rows) => { if (!cancelled && Array.isArray(rows)) setAllSpaces(rows) })
      .catch(() => { /* the sidebar's Spaces still work */ })
    return () => { cancelled = true }
  }, [])
  const spaces = useMemo(() => allSpaces ?? home?.spaces ?? [], [allSpaces, home])

  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(Boolean(routePageId))
  const [loadError, setLoadError] = useState('')
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [linkDialog, setLinkDialog] = useState(null)
  const [moreAnchor, setMoreAnchor] = useState(null)
  const [actionsAnchor, setActionsAnchor] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [imageTick, setImageTick] = useState(0)

  usePageTitle(title.trim() ? `Editing ${title.trim()}` : 'Create page')

  // Where a NEW page goes until Publish says otherwise.
  const requestedSpace = searchParams.get('spaceId')
  const requestedParent = searchParams.get('parentId')
  const spaceId = page?.space_id ?? (requestedSpace ? Number(requestedSpace) : spaces[0]?.id ?? null)
  const parentId = page ? page.parent_id : (requestedParent ? Number(requestedParent) : null)

  // ── refs the editor's callbacks read, so they never see a stale render ──
  const pageIdRef = useRef(routePageId ? Number(routePageId) : null)
  const latest = useRef({ title: '', html: '' })
  const dirty = useRef(false)
  const timer = useRef(null)
  const saveChain = useRef(Promise.resolve())
  const creating = useRef(null)
  const placement = useRef({ spaceId, parentId })
  placement.current = { spaceId, parentId }
  const membersRef = useRef(members)
  membersRef.current = members
  const fileRef = useRef(null)
  const titleRef = useRef(null)
  const bodyRef = useRef(null)
  const actions = useRef({})

  const [slashBridge] = useState(createSuggestionBridge)
  const [mentionBridge] = useState(createSuggestionBridge)

  const extensions = useMemo(() => buildPageExtensions({
    slashBridge,
    mentionBridge,
    findMembers: (query) => {
      const q = String(query || '').toLowerCase()
      return (membersRef.current || [])
        .filter((m) => m.email && `${m.name || ''} ${m.email}`.toLowerCase().includes(q))
        .slice(0, 8)
        .map((m) => ({ id: m.email, label: m.name || m.email }))
    },
    onElement: (editor, element) => element.run(editor, { pickImage: () => actions.current.pickImage?.() }),
    onLinkShortcut: () => actions.current.pickLink?.(),
  }), [slashBridge, mentionBridge])

  const editor = useEditor({
    extensions,
    content: '',
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'pe-content', 'aria-label': 'Page content' },
    },
    onUpdate: ({ editor: ed }) => {
      latest.current.html = sanitizeHtml(ed.getHTML())
      actions.current.markDirty?.()
    },
  }, [extensions])

  /* ------------------------------ saving ------------------------------ */

  /** The page's id, creating the draft on first use. */
  const ensurePage = useCallback(async () => {
    if (pageIdRef.current) return { id: pageIdRef.current, created: false }
    if (!creating.current) {
      const { spaceId: sid, parentId: pid } = placement.current
      creating.current = createWikiPage({
        spaceId: sid,
        parentId: pid,
        title: latest.current.title.trim(),
        content: latest.current.html,
        status: 'draft',
      }).then((row) => {
        pageIdRef.current = row.id
        setPage({ ...row, version: 0 })
        // Same component on both routes, so the editor survives the switch.
        // keepFocus: the author is mid-sentence; see useFocusMainOnRouteChange.
        navigate(`/wiki/pages/${row.id}/edit`, { replace: true, state: { keepFocus: true } })
        return row.id
      }).finally(() => { creating.current = null })
      const id = await creating.current
      return { id, created: true }
    }
    return { id: await creating.current, created: false }
  }, [navigate])

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    saveChain.current = saveChain.current.then(async () => {
      if (!dirty.current) return
      const { title: t, html } = latest.current
      // A brand-new page with nothing in it is not worth storing.
      if (!pageIdRef.current && !t.trim() && isEmptyDoc(html)) {
        dirty.current = false
        setSaveState('idle')
        return
      }
      dirty.current = false
      setSaveState('saving')
      setSaveError('')
      try {
        const { id, created } = await ensurePage()
        if (!created) await saveWikiDraft(id, { title: t, content: html })
        setSaveState(dirty.current ? 'dirty' : 'saved')
      } catch (err) {
        dirty.current = true
        setSaveState('error')
        setSaveError(err?.message || 'Could not save the page.')
      }
    })
    return saveChain.current
  }, [ensurePage])

  const markDirty = useCallback(() => {
    dirty.current = true
    setSaveState('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, AUTOSAVE_MS)
  }, [flush])
  actions.current.markDirty = markDirty

  // Leaving the editor inside the app saves what is pending rather than
  // dropping it; leaving the app (reload, close tab) asks first.
  useEffect(() => () => { flush() }, [flush])
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'saving' && saveState !== 'error') return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])

  /*
   * JL-188: Move to trash. Pending autosaves are cancelled and any save in
   * flight is awaited first, so nothing writes to the page after it is gone.
   */
  const { trashPage, trashDialog, trashError, clearTrashError } = useTrashPage({
    reloadHome,
    beforeDelete: () => {
      clearTimeout(timer.current)
      dirty.current = false
      return saveChain.current
    },
  })

  /* ------------------------------ loading ----------------------------- */

  useEffect(() => {
    if (!routePageId || !editor) return undefined
    // Our own redirect after creating the draft: the page is already here.
    if (pageIdRef.current === Number(routePageId) && page) return undefined
    let cancelled = false
    setLoading(true)
    setLoadError('')
    fetchWikiPage(routePageId)
      .then((row) => {
        if (cancelled) return
        pageIdRef.current = row.id
        setPage(row)
        const startTitle = row.draft_title ?? row.title ?? ''
        const startHtml = row.draft_content ?? row.content ?? ''
        latest.current = { title: startTitle, html: sanitizeHtml(startHtml) }
        setTitle(startTitle)
        editor.commands.setContent(sanitizeHtml(startHtml), { emitUpdate: false })
        setImageTick((n) => n + 1)
      })
      .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Could not load that page.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // `page` is read only to recognise our own redirect; reloading on every
    // page change would wipe the editor after each save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePageId, editor])

  useEffect(() => {
    const id = pageIdRef.current
    setPinned(Boolean(id && (home?.starredPages ?? []).some((p) => Number(p.id) === Number(id))))
  }, [home, page?.id])

  useAuthedImages(bodyRef, [imageTick, page?.id])

  /* ------------------------------ actions ----------------------------- */

  function changeTitle(value) {
    setTitle(value)
    latest.current.title = value
    markDirty()
  }

  function titleKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      editor?.commands.focus('start')
    }
  }

  const pickLink = useCallback(() => {
    if (!editor) return
    const current = editor.getAttributes('link').href || ''
    new Promise((resolve) => setLinkDialog({ initialHref: current, resolve })).then((href) => {
      if (href === undefined || href === null) return
      if (href === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
      else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    })
  }, [editor])
  actions.current.pickLink = pickLink

  function closeLinkDialog(value) {
    linkDialog?.resolve(value)
    setLinkDialog(null)
  }

  const pickImage = useCallback(() => fileRef.current?.click(), [])
  actions.current.pickImage = pickImage

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editor) return
    setUploading(true)
    setSaveError('')
    try {
      // An attachment belongs to a page, so the draft must exist first.
      dirty.current = true
      latest.current.html = sanitizeHtml(editor.getHTML())
      const { id } = await ensurePage()
      const data = await fileToBase64(file)
      const created = await uploadPageAttachment(id, { filename: file.name, mimeType: file.type, data })
      editor.chain().focus().setImage({ src: attachmentDownloadUrl(id, created.id), alt: file.name }).run()
      setImageTick((n) => n + 1)
    } catch (err) {
      setSaveError(err?.message || 'Could not upload that image.')
    } finally {
      setUploading(false)
    }
  }

  function insertTemplate(body) {
    if (!editor) return
    if (editor.isEmpty) editor.chain().focus().setContent(body, { emitUpdate: true }).run()
    else editor.chain().focus().insertContent(body).run()
    setTemplatesOpen(false)
  }

  function insertElement(key) {
    const element = PAGE_ELEMENTS.find((e) => e.key === key)
    if (element && editor) element.run(editor, { pickImage })
  }

  async function togglePin() {
    const id = pageIdRef.current
    if (!id) return
    const next = !pinned
    setPinned(next)
    try {
      if (next) await addFavorite('page', id)
      else await removeFavorite('page', id)
      reloadHome?.()
    } catch {
      setPinned(!next)
    }
  }

  async function handleClose() {
    await flush()
    const id = pageIdRef.current
    if (id) {
      navigate(`/wiki/pages/${id}`)
      return
    }
    const space = spaces.find((s) => Number(s.id) === Number(spaceId))
    navigate(space?.key ? `/spaces/${encodeURIComponent(space.key)}` : '/wiki/home')
  }

  async function handlePublish({ title: finalTitle, spaceId: sid, parentId: pid }) {
    setPublishing(true)
    setPublishError('')
    try {
      latest.current.title = finalTitle
      setTitle(finalTitle)
      if (!pageIdRef.current) dirty.current = true
      await flush()
      const { id } = await ensurePage()
      clearTimeout(timer.current)
      await publishWikiPage(id, {
        title: finalTitle,
        content: latest.current.html,
        spaceId: sid,
        parentId: pid,
      })
      // Nothing is pending any more: the unmount flush must not write a new
      // draft on top of what was just published.
      dirty.current = false
      setSaveState('idle')
      reloadHome?.()
      navigate(`/wiki/pages/${id}`)
    } catch (err) {
      setPublishError(err?.message || 'Could not publish the page.')
    } finally {
      setPublishing(false)
    }
  }

  /* ------------------------------ render ------------------------------ */

  const authorEmail = page?.created_by || authUser?.email || ''
  const author = (members || []).find((m) => String(m.email).toLowerCase() === String(authorEmail).toLowerCase())
  const authorName = author?.name || authorEmail
  const me = (members || []).find((m) => String(m.email).toLowerCase() === String(authUser?.email || '').toLowerCase())
  const myName = me?.name || authUser?.email || ''
  const isPublished = page?.status === 'published'
  const showQuickInsert = Boolean(editor) && editor.isEmpty && !loading

  if (loadError) {
    return <div className="pe-page"><ErrorState error={loadError} onRetry={() => window.location.reload()} /></div>
  }

  return (
    <div className="pe-page">
      <input ref={fileRef} type="file" accept="image/*" className="pe-file" tabIndex={-1} aria-hidden="true" onChange={handleFile} />
      <PageLinkDialog
        open={Boolean(linkDialog)}
        initialHref={linkDialog?.initialHref || ''}
        onCancel={() => closeLinkDialog(undefined)}
        onConfirm={(href) => closeLinkDialog(href)}
      />

      {/* One sticky block for both bars, so the toolbar can never drift
          from, or slide under, the top bar above it. */}
      <div className="pe-chrome">
        <header className="pe-topbar">
          <div className="pe-topbar__left">
            {onToggleSidebar && (
              <Tooltip title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} arrow>
                <button type="button" className="pe-icon-btn" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggleSidebar}>
                  {sidebarCollapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
                </button>
              </Tooltip>
            )}
            <DescriptionOutlinedIcon fontSize="small" className="pe-topbar__page-icon" aria-hidden="true" />
            {/* The screen's <h1> (JL-409): the title being written is an input, and
                an input cannot be a heading, so the bar that names the page is. */}
            <h1 className="pe-topbar__title" title={title.trim() || 'Untitled'}>{title.trim() || 'Untitled'}</h1>
            {page && !isPublished && <span className="pill pill--lozenge pill-yellow">Draft</span>}
          </div>
          <div className="pe-topbar__right">
            {saveState !== 'idle' && (
              <span className={`pe-save pe-save--${saveState}`} role="status" aria-live="polite">{SAVE_LABEL[saveState]}</span>
            )}
            <Tooltip title={myName} arrow>
              <Avatar className="pe-avatar" sx={{ width: 28, height: 28 }}>{initials(myName)}</Avatar>
            </Tooltip>
            <Button size="small" variant="contained" onClick={() => { setPublishError(''); setPublishOpen(true) }} disabled={!editor || loading}>
              {isPublished ? 'Update…' : 'Publish…'}
            </Button>
            <Button size="small" onClick={handleClose}>Close</Button>
            <Tooltip title="More actions" arrow>
              <span>
                <button
                  type="button"
                  className="pe-icon-btn"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  // A page that was never saved has nothing to delete.
                  disabled={!page}
                  onClick={(e) => setActionsAnchor(e.currentTarget)}
                >
                  <MoreHorizIcon fontSize="small" />
                </button>
              </span>
            </Tooltip>
            <Menu anchorEl={actionsAnchor} open={Boolean(actionsAnchor)} onClose={() => setActionsAnchor(null)}>
              <MenuItem
                sx={{ color: 'error.main' }}
                onClick={() => {
                  setActionsAnchor(null)
                  const space = spaces.find((sp) => Number(sp.id) === Number(spaceId))
                  trashPage({
                    id: pageIdRef.current,
                    title,
                    space_key: page?.space_key || space?.key,
                    children: page?.children,
                  })
                }}
              >
                <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
                Move to trash
              </MenuItem>
            </Menu>
            <Tooltip title="Sharing is coming soon" arrow>
              <span>
                <Button size="small" variant="outlined" startIcon={<LockOutlinedIcon fontSize="small" />} disabled>Share</Button>
              </span>
            </Tooltip>
          </div>
        </header>

        <div className="pe-toolbar-row">
          <ConfluenceToolbar
            editor={editor}
            onLink={pickLink}
            onImage={pickImage}
            onHistory={() => setHistoryOpen(true)}
            historyDisabled={!isPublished}
            pinned={pinned}
            onTogglePin={togglePin}
            pinDisabled={!page}
            uploading={uploading}
          />
        </div>
      </div>

      <main className="pe-body" ref={bodyRef}>
        {saveError && <Alert severity="error" onClose={() => setSaveError('')} className="pe-alert">{saveError}</Alert>}
        {trashError && <Alert severity="error" onClose={clearTrashError} className="pe-alert">{trashError}</Alert>}
        {isPublished && page?.draft_updated_at && (
          <Alert severity="info" className="pe-alert">
            This page has unpublished changes{page.draft_updated_by ? ` by ${page.draft_updated_by}` : ''}. Readers see the published version until you publish again.
          </Alert>
        )}
        {loading && <LoadingState label="Loading page…" variant="skeleton" rows={6} />}
        <div hidden={loading}>
          <input
            ref={titleRef}
            className="pe-title"
            placeholder="Give this page a title"
            aria-label="Page title"
            value={title}
            onChange={(e) => changeTitle(e.target.value)}
            onKeyDown={titleKeyDown}
            autoFocus={!routePageId}
          />
          <div className="pe-byline">
            <Avatar sx={{ width: 24, height: 24 }} className="pe-avatar pe-avatar--small">{initials(authorName)}</Avatar>
            <span>By {authorName}</span>
          </div>
          <EditorContent editor={editor} className="pe-editor" />
          <TableToolbar editor={editor} />
        </div>
      </main>

      {showQuickInsert && (
        <footer className="pe-quick-wrap">
          <QuickInsertPanel
            onTemplate={(key) => insertTemplate(BUILT_IN_TEMPLATES.find((t) => t.key === key)?.body || '')}
            onAllTemplates={() => setTemplatesOpen(true)}
            onElement={insertElement}
            onMore={(anchor) => setMoreAnchor(anchor)}
          />
        </footer>
      )}
      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        {PAGE_ELEMENTS.map((el) => (
          <MenuItem key={el.key} onClick={() => { setMoreAnchor(null); el.run(editor, { pickImage }) }}>
            <ListItemText primary={el.label} secondary={el.hint} />
          </MenuItem>
        ))}
      </Menu>

      <SuggestionMenu
        bridge={slashBridge}
        label="Insert element"
        emptyText="No matching elements"
        getKey={(el) => el.key}
        renderItem={(el) => (
          <>
            <span className="pe-suggest__label">{el.label}</span>
            <span className="pe-suggest__hint">{el.hint}</span>
          </>
        )}
      />
      <SuggestionMenu
        bridge={mentionBridge}
        label="Mention someone"
        emptyText="No matching people"
        getKey={(m) => m.id}
        renderItem={(m) => (
          <>
            <span className="pe-suggest__label">{m.label}</span>
            <span className="pe-suggest__hint">{m.id}</span>
          </>
        )}
      />

      {trashDialog}
      <TemplatesDialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} onPick={insertTemplate} />
      <PublishDialog
        open={publishOpen}
        pageId={page?.id}
        initialTitle={title}
        initialSpaceId={spaceId}
        initialParentId={parentId}
        spaces={spaces}
        publishing={publishing}
        error={publishError}
        onCancel={() => setPublishOpen(false)}
        onConfirm={handlePublish}
      />
      <Drawer anchor="right" open={historyOpen} onClose={() => setHistoryOpen(false)}>
        <div className="pe-history">
          {page && (
            <VersionHistoryPanel
              pageId={page.id}
              currentVersion={page.version}
              canEdit
              onClose={() => setHistoryOpen(false)}
              onRestored={() => window.location.reload()}
            />
          )}
        </div>
      </Drawer>
    </div>
  )
}

export default WikiPageEditor
