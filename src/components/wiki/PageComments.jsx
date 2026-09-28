import { useCallback, useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { LoadingState, ErrorState } from '../common/LoadingState'
import { RelativeTime } from '../common/RelativeTime'
import { useConfirm } from '../common/useConfirm'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { displayNameFromEmail } from '../../utils/helpers'
import { avatarStyle } from '../../utils/avatarColour'
import {
  fetchPageComments, addPageComment, editPageComment,
  deletePageComment, resolvePageComment,
} from '../../api/wikiCommentApi'
import './PageComments.css'

/*
 * JL-115→119 — the comments on a page.
 *
 * ── What the UI is allowed to decide ────────────────────────────────────────
 *
 * Nothing that matters. The server owns every rule — who may edit, who may
 * delete, whether a reply nests, whether the page is even visible — and this
 * only decides which controls are worth SHOWING. A control the server would
 * reject is noise; a control hidden here is not a security boundary. Both
 * statements have to be true at once, and they are, because the checks below
 * mirror the server's rather than standing in for them.
 *
 * ── Comment text is text ────────────────────────────────────────────────────
 *
 * Rendered into a text node, never as markup. A comment is short prose, and
 * admitting HTML would mean a second sanitised render path beside the page
 * body for no gain (JL-359).
 */

/** Mirrors the server: author edits; author or workspace admin deletes. */
const isMine = (comment, email) =>
  String(comment.author || '').toLowerCase() === String(email || '').toLowerCase()

function CommentBody({ comment, onSaved, canEditOwn, pageId, onError }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [busy, setBusy] = useState(false)

  async function save() {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    try {
      onSaved(await editPageComment(pageId, comment.id, body))
      setEditing(false)
    } catch (err) {
      onError(err?.message || 'Could not save that edit.')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <>
        {/* A text node, deliberately: see the module comment. */}
        <p className="wiki-comment-body">{comment.body}</p>
        {canEditOwn && (
          <button type="button" className="wiki-comment-link" onClick={() => { setDraft(comment.body); setEditing(true) }}>
            Edit
          </button>
        )}
      </>
    )
  }

  return (
    <div className="wiki-comment-edit">
      <TextField
        id={`wiki-comment-edit-${comment.id}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        multiline
        minRows={2}
        fullWidth
        size="small"
        label="Edit comment"
      />
      <div className="wiki-comment-actions">
        <Button size="small" variant="contained" onClick={save} disabled={busy || !draft.trim()}>Save</Button>
        <Button size="small" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}

function Comment({ comment, pageId, email, canModerate, onChanged, onError, children }) {
  const { confirm, confirmDialog } = useConfirm()
  const mine = isMine(comment, email)

  async function remove() {
    const ok = await confirm({
      title: 'Delete this comment?',
      message: comment.parent_id == null
        ? 'Its replies are deleted with it. This cannot be undone.'
        : 'This cannot be undone.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      await deletePageComment(pageId, comment.id)
      onChanged()
    } catch (err) {
      onError(err?.message || 'Could not delete that comment.')
    }
  }

  return (
    <div className="wiki-comment">
      {confirmDialog}
      <span className="wiki-comment-avatar" style={avatarStyle(comment.author)} aria-hidden="true">
        {displayNameFromEmail(comment.author).charAt(0).toUpperCase()}
      </span>
      <div className="wiki-comment-main">
        <p className="wiki-comment-meta">
          <strong>{displayNameFromEmail(comment.author)}</strong>
          {' · '}
          <RelativeTime value={comment.created_at} />
          {/* JL-118: an edit is disclosed, not silent. */}
          {comment.edited_at && <span className="wiki-comment-edited"> · edited</span>}
        </p>

        <CommentBody
          comment={comment}
          pageId={pageId}
          canEditOwn={mine}
          onSaved={onChanged}
          onError={onError}
        />

        <div className="wiki-comment-tools">
          {/* Mirrors the server rule: author OR workspace admin. */}
          {(mine || canModerate) && (
            <button type="button" className="wiki-comment-link" onClick={remove}>Delete</button>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

export function PageComments({ pageId }) {
  const { authUser } = useAuth()
  const { canCreateIssue: canComment, isAdmin } = usePermissions()
  const email = authUser?.email

  const [threads, setThreads] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchPageComments(pageId)
      setThreads(data.threads ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      // Say what failed. An empty list is the claim "no one has commented",
      // which is a different statement (JL-248).
      setError(err?.message || 'Could not load the comments.')
    } finally {
      setLoading(false)
    }
  }, [pageId])

  useEffect(() => { load() }, [load])

  async function submit(body, parentId = null) {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      await addPageComment(pageId, text, parentId)
      setDraft('')
      setReplyDraft('')
      setReplyTo(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not post that comment.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleResolved(thread) {
    try {
      await resolvePageComment(pageId, thread.id, thread.resolved_at == null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not update that thread.')
    }
  }

  return (
    <section className="wiki-comments" aria-labelledby="wiki-comments-heading">
      <h2 id="wiki-comments-heading">
        Comments{total > 0 && <span className="wiki-comments-count"> ({total})</span>}
      </h2>

      {loading && <LoadingState label="Loading comments…" variant="skeleton" rows={3} />}
      {!loading && error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && threads.length === 0 && (
        <p className="wiki-comments-empty">No comments yet.</p>
      )}

      {!loading && !error && threads.map((thread) => (
        <article
          key={thread.id}
          className={`wiki-thread${thread.resolved_at ? ' wiki-thread--resolved' : ''}`}
        >
          {thread.resolved_at && (
            <p className="wiki-thread-resolved">
              Resolved by {displayNameFromEmail(thread.resolved_by)}
              {' · '}
              <RelativeTime value={thread.resolved_at} />
            </p>
          )}

          <Comment
            comment={thread}
            pageId={pageId}
            email={email}
            canModerate={isAdmin}
            onChanged={load}
            onError={setError}
          >
            {canComment && (
              <>
                <button type="button" className="wiki-comment-link" onClick={() => setReplyTo(thread.id)}>
                  Reply
                </button>
                {/* JL-119: resolution belongs to the thread, so it is offered
                    on the root and nowhere else. */}
                <button type="button" className="wiki-comment-link" onClick={() => toggleResolved(thread)}>
                  {thread.resolved_at ? 'Reopen' : 'Resolve'}
                </button>
              </>
            )}
          </Comment>

          {thread.replies?.length > 0 && (
            <div className="wiki-thread-replies">
              {thread.replies.map((reply) => (
                <Comment
                  key={reply.id}
                  comment={reply}
                  pageId={pageId}
                  email={email}
                  canModerate={isAdmin}
                  onChanged={load}
                  onError={setError}
                />
              ))}
            </div>
          )}

          {replyTo === thread.id && (
            <div className="wiki-comment-edit wiki-thread-replybox">
              <TextField
                id={`wiki-reply-${thread.id}`}
                label="Reply"
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                multiline
                minRows={2}
                fullWidth
                size="small"
                autoFocus
              />
              <div className="wiki-comment-actions">
                <Button size="small" variant="contained" disabled={busy || !replyDraft.trim()} onClick={() => submit(replyDraft, thread.id)}>
                  Reply
                </Button>
                <Button size="small" onClick={() => { setReplyTo(null); setReplyDraft('') }} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </article>
      ))}

      {canComment && !loading && (
        <div className="wiki-comment-edit wiki-comments-new">
          <TextField
            id="wiki-comment-new"
            label="Add a comment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            size="small"
          />
          <div className="wiki-comment-actions">
            <Button size="small" variant="contained" disabled={busy || !draft.trim()} onClick={() => submit(draft)}>
              Comment
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

export default PageComments
