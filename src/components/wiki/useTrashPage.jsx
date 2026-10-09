import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfirm } from '../common/useConfirm'
import { deleteWikiPage } from '../../api/wikiApi'

/*
 * JL-188 (fosasoft) — "Move to trash" for a Confluence Lite page.
 *
 * One hook for the page view and the editor, so the confirmation wording and
 * where you land afterwards cannot differ between them. Delete is soft
 * (JL-93): the page goes to its Space's Trash tab and can be restored, which
 * the confirmation says, along with what happens to child pages.
 *
 * Usage:
 *   const { trashPage, trashDialog, trashError } = useTrashPage({ reloadHome })
 *   …render {trashDialog}…
 *   await trashPage(page)          // page: { id, title, space_key, children? }
 */
export function useTrashPage({ reloadHome, beforeDelete } = {}) {
  const navigate = useNavigate()
  const { confirm, confirmDialog } = useConfirm()
  const [trashError, setTrashError] = useState('')

  const trashPage = useCallback(async (page) => {
    if (!page?.id) return false
    setTrashError('')
    const title = page.title?.trim() || 'Untitled'
    const childCount = Array.isArray(page.children) ? page.children.length : 0
    const ok = await confirm({
      title: 'Move this page to the trash?',
      message:
        `“${title}” will be moved to the trash. You can restore it from the Space’s Trash tab.` +
        (childCount
          ? ` Its ${childCount} child ${childCount === 1 ? 'page moves' : 'pages move'} to the top level of the Space.`
          : ''),
      confirmLabel: 'Move to trash',
      danger: true,
    })
    if (!ok) return false
    try {
      await beforeDelete?.()
      await deleteWikiPage(page.id)
      reloadHome?.()
      const trashed = { id: page.id, title }
      if (page.space_key) navigate(`/spaces/${encodeURIComponent(page.space_key)}`, { state: { trashed } })
      else navigate('/wiki/home')
      return true
    } catch (err) {
      setTrashError(err?.message || 'Could not move the page to the trash.')
      return false
    }
  }, [confirm, navigate, reloadHome, beforeDelete])

  return { trashPage, trashDialog: confirmDialog, trashError, clearTrashError: () => setTrashError('') }
}

export default useTrashPage
