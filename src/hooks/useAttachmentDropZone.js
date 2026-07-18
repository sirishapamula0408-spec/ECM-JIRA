import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadAttachment } from '../api/attachmentApi'

/**
 * JL-216 — Drag-and-drop + paste-to-attach for the issue detail page.
 *
 * Reuses the existing base64 upload path (`uploadAttachment` → FileReader →
 * base64-over-JSON) so drops and clipboard pastes go through the exact same
 * API and validation as the file-picker. Multiple files per drop/paste are
 * supported. Server-side rejections (JL-203 size/type caps → 400/413) are
 * surfaced via the global `permission-denied` toast that App.jsx listens for.
 *
 * @param {object}   opts
 * @param {number|string} opts.issueId       Issue the attachments belong to.
 * @param {boolean}  [opts.enabled=true]      Gate on upload permission — when
 *                                            false, no drag overlay/paste capture.
 * @param {(saved:object)=>void} [opts.onUploaded]  Called per successfully saved attachment.
 * @returns {{ isDragging:boolean, uploading:boolean, uploadFiles:Function, dropZoneProps:object }}
 */
export function useAttachmentDropZone({ issueId, enabled = true, onUploaded }) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  // dragenter/dragleave fire for every child element; a counter keeps the
  // overlay stable until the cursor genuinely leaves the drop zone.
  const dragDepth = useRef(0)

  const uploadFiles = useCallback(async (files) => {
    const list = Array.from(files || [])
    if (!issueId || list.length === 0) return
    setUploading(true)
    try {
      for (const file of list) {
        try {
          const saved = await uploadAttachment(issueId, file)
          onUploaded?.(saved)
        } catch (err) {
          // Surface the server's rejection message (e.g. JL-203 size/type caps).
          window.dispatchEvent(
            new CustomEvent('permission-denied', {
              detail: { message: err?.message || `Could not attach ${file.name}` },
            }),
          )
        }
      }
    } finally {
      setUploading(false)
    }
  }, [issueId, onUploaded])

  const hasFiles = (dt) => {
    if (!dt) return false
    // dataTransfer.types is a DOMStringList; 'Files' is present while dragging files.
    const types = dt.types
    if (!types) return false
    return Array.from(types).includes('Files')
  }

  const onDragEnter = useCallback((e) => {
    if (!enabled) return
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
  }, [enabled])

  const onDragOver = useCallback((e) => {
    if (!enabled) return
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    // Signal a copy operation so the OS shows the right cursor.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }, [enabled])

  const onDragLeave = useCallback((e) => {
    if (!enabled) return
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }, [enabled])

  const onDrop = useCallback((e) => {
    if (!enabled) return
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (files && files.length) uploadFiles(files)
  }, [enabled, uploadFiles])

  // Paste-to-attach: a window-level listener so a screenshot pasted anywhere on
  // the issue detail (not just a focused input) is attached. Named
  // `pasted-image-<timestamp>.<ext>` when the clipboard file has no real name.
  useEffect(() => {
    if (!enabled || !issueId) return
    function handlePaste(e) {
      const cd = e.clipboardData
      if (!cd) return
      const collected = []
      if (cd.files && cd.files.length) {
        for (const f of cd.files) collected.push(f)
      } else if (cd.items) {
        for (const item of cd.items) {
          if (item.kind === 'file') {
            const f = item.getAsFile()
            if (f) collected.push(f)
          }
        }
      }
      if (collected.length === 0) return
      // Don't hijack ordinary text pastes.
      e.preventDefault()
      const named = collected.map((f) => {
        const generic = !f.name || f.name === 'image.png' || f.name === 'blob'
        if (!generic) return f
        const ext = (f.type && f.type.split('/')[1]) || 'png'
        try {
          return new File([f], `pasted-image-${Date.now()}.${ext}`, {
            type: f.type || 'image/png',
          })
        } catch {
          return f
        }
      })
      uploadFiles(named)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [enabled, issueId, uploadFiles])

  return {
    isDragging,
    uploading,
    uploadFiles,
    dropZoneProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
