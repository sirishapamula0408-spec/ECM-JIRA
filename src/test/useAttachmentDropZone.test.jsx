import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'

// Mock the base64 upload API — the whole point of JL-216 is that drop/paste
// reuse this exact function rather than reinventing the upload.
vi.mock('../api/attachmentApi', () => ({
  uploadAttachment: vi.fn(),
}))

import { uploadAttachment } from '../api/attachmentApi'
import { useAttachmentDropZone } from '../hooks/useAttachmentDropZone'

// Tiny harness that exercises the hook the way IssueDetailPage does.
function Harness({ issueId = 7, enabled = true, onUploaded = () => {} }) {
  const { isDragging, dropZoneProps } = useAttachmentDropZone({ issueId, enabled, onUploaded })
  return (
    <div data-testid="zone" {...dropZoneProps}>
      {isDragging ? <span data-testid="overlay">Drop files to attach</span> : null}
    </div>
  )
}

function firePaste(files) {
  const event = new Event('paste', { bubbles: true })
  event.clipboardData = { files, items: [] }
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('useAttachmentDropZone (JL-216)', () => {
  beforeEach(() => {
    uploadAttachment.mockReset()
    uploadAttachment.mockResolvedValue({ id: 1, filename: 'a.txt' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drop with a file calls the base64 upload for that issue', async () => {
    const onUploaded = vi.fn()
    const { getByTestId } = render(<Harness issueId={7} onUploaded={onUploaded} />)
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' })

    fireEvent.drop(getByTestId('zone'), { dataTransfer: { files: [file], types: ['Files'] } })

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1))
    expect(uploadAttachment).toHaveBeenCalledWith(7, file)
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ id: 1, filename: 'a.txt' }))
  })

  it('drop with multiple files uploads each one', async () => {
    const { getByTestId } = render(<Harness />)
    const f1 = new File(['1'], 'one.txt', { type: 'text/plain' })
    const f2 = new File(['2'], 'two.txt', { type: 'text/plain' })

    fireEvent.drop(getByTestId('zone'), { dataTransfer: { files: [f1, f2], types: ['Files'] } })

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(2))
  })

  it('paste with an image file uploads it with a generated filename', async () => {
    render(<Harness issueId={9} />)
    const img = new File(['png-bytes'], 'image.png', { type: 'image/png' })

    firePaste([img])

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1))
    const [issueId, file] = uploadAttachment.mock.calls[0]
    expect(issueId).toBe(9)
    // Generic "image.png" (a screenshot) gets renamed to pasted-image-<ts>.png
    expect(file.name).toMatch(/^pasted-image-\d+\.png$/)
  })

  it('paste with no files does nothing', async () => {
    render(<Harness />)
    firePaste([])
    // give any async work a tick
    await Promise.resolve()
    expect(uploadAttachment).not.toHaveBeenCalled()
  })

  it('does not upload when disabled (no upload permission)', async () => {
    const { getByTestId } = render(<Harness enabled={false} />)
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })

    fireEvent.drop(getByTestId('zone'), { dataTransfer: { files: [file], types: ['Files'] } })
    firePaste([new File(['y'], 'image.png', { type: 'image/png' })])

    await Promise.resolve()
    expect(uploadAttachment).not.toHaveBeenCalled()
  })

  it('shows the drag overlay on dragenter and hides it on drop', async () => {
    const { getByTestId, queryByTestId } = render(<Harness />)
    const zone = getByTestId('zone')

    fireEvent.dragEnter(zone, { dataTransfer: { files: [], types: ['Files'] } })
    expect(queryByTestId('overlay')).not.toBeNull()

    fireEvent.drop(zone, { dataTransfer: { files: [], types: ['Files'] } })
    expect(queryByTestId('overlay')).toBeNull()
  })

  it('surfaces a toast (permission-denied event) when the server rejects the upload', async () => {
    uploadAttachment.mockRejectedValueOnce(new Error('File too large'))
    const listener = vi.fn()
    window.addEventListener('permission-denied', listener)
    try {
      const { getByTestId } = render(<Harness />)
      const file = new File(['x'], 'big.bin', { type: 'application/octet-stream' })
      fireEvent.drop(getByTestId('zone'), { dataTransfer: { files: [file], types: ['Files'] } })

      await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
      expect(listener.mock.calls[0][0].detail.message).toBe('File too large')
    } finally {
      window.removeEventListener('permission-denied', listener)
    }
  })
})
