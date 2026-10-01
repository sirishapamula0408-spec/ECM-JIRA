import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/* ================================================================
   JL-164 — the document upload dialog.

   The assertions that carry this suite are the ones about the
   transport, because they are what the requirement actually turns
   on:

     - a FormData body, never JSON — the whole reason for multipart
     - Content-Type is NOT set by hand, or the browser omits the
       multipart boundary and a valid-looking body fails to parse
     - progress is reported, and a cancel button aborts the request
     - the SERVER's refusal wording is shown, not a local rewording

   A test that only checked "a file can be chosen" would pass
   against an implementation that gets every one of those wrong.
   ================================================================ */

/** A stand-in XMLHttpRequest that records what it was given. */
class FakeXHR {
  static instances = []

  constructor() {
    this.upload = {}
    this.headers = {}
    this.status = 201
    this.responseText = JSON.stringify({ id: 11, file_name: 'a.pdf' })
    this.aborted = false
    FakeXHR.instances.push(this)
  }

  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(name, value) { this.headers[name] = value }
  send(body) { this.body = body }
  abort() { this.aborted = true; this.onabort?.() }

  /** Drive the request to completion, as the browser would. */
  finish({ status = 201, responseText } = {}) {
    this.status = status
    if (responseText !== undefined) this.responseText = responseText
    this.onload?.()
  }

  progress(loaded, total) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total })
  }
}

beforeEach(() => {
  FakeXHR.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  window.localStorage.setItem('jira_auth_token', 'tok')
})

import { DocumentUploadDialog } from '../components/documents/DocumentUploadDialog'
import { uploadDocument, formatBytes } from '../api/documentApi'

const file = (name = 'a.pdf', size = 2048) => {
  const f = new File(['x'], name, { type: 'application/pdf' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

/* ---------------------------------------------------------------- *
 * The transport
 * ---------------------------------------------------------------- */
describe('JL-164 uploads are multipart', () => {
  it('sends a FormData body, not JSON', async () => {
    /*
     * The entire reason for this design: a JSON body would have to be base64,
     * inflating a 100 MB file to ~134 MB and forcing the app's global
     * express.json limit up for every endpoint.
     */
    uploadDocument('ENG', file())
    const xhr = FakeXHR.instances[0]
    expect(xhr.body).toBeInstanceOf(FormData)
    expect(xhr.body.get('file')).toBeTruthy()
  })

  it('does NOT set Content-Type by hand', () => {
    /*
     * The browser must generate the multipart boundary and put it in the
     * header. Setting Content-Type ourselves omits the boundary, and the
     * server then fails to parse a body that looks perfectly valid — a
     * failure that is very hard to read from either end.
     */
    uploadDocument('ENG', file())
    const xhr = FakeXHR.instances[0]
    expect(Object.keys(xhr.headers)).not.toContain('Content-Type')
    expect(xhr.headers.Authorization).toBe('Bearer tok')
  })

  it('posts to the Space document endpoint', () => {
    uploadDocument('ENG', file())
    const xhr = FakeXHR.instances[0]
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/spaces/ENG/documents')
  })

  it('reports progress as the body goes up', async () => {
    const seen = []
    uploadDocument('ENG', file(), { onProgress: (p) => seen.push(p.percent) })
    const xhr = FakeXHR.instances[0]
    xhr.progress(512, 2048)
    xhr.progress(2048, 2048)
    expect(seen).toEqual([25, 100])
  })

  it('rejects with the SERVER message on refusal', async () => {
    // The server owns the wording for size, type, quota and duplicates.
    const { promise } = uploadDocument('ENG', file())
    FakeXHR.instances[0].finish({
      status: 413,
      responseText: JSON.stringify({
        error: 'File size exceeds the maximum allowed limit of 100 MB. Please select a smaller file.',
      }),
    })
    await expect(promise).rejects.toThrow(/exceeds the maximum allowed limit of 100 MB/)
  })

  it('aborts on cancel, and says it was cancelled rather than failed', async () => {
    const { promise, cancel } = uploadDocument('ENG', file())
    cancel()
    await expect(promise).rejects.toMatchObject({ cancelled: true })
    expect(FakeXHR.instances[0].aborted).toBe(true)
  })
})

/* ---------------------------------------------------------------- *
 * The dialog
 * ---------------------------------------------------------------- */
describe('JL-164 the upload dialog', () => {
  const open = (props = {}) => render(
    <DocumentUploadDialog
      open
      onClose={vi.fn()}
      spaceKey="ENG"
      maxFileBytes={100 * 1024 * 1024}
      supportedText="Supported formats: PDF, Word, Excel."
      onUploaded={vi.fn()}
      {...props}
    />,
  )

  it('states the per-file limit, from the server figure', () => {
    // Spec section 4 requires this on screen. It comes from the server's
    // storage.maxFileBytes, because the cap is configurable.
    open()
    expect(screen.getByText(/Maximum file size: 100 MB per file/)).toBeInTheDocument()
  })

  it('falls back to 100 MB when the server figure has not arrived', () => {
    open({ maxFileBytes: undefined })
    expect(screen.getByText(/Maximum file size: 100 MB per file/)).toBeInTheDocument()
  })

  it('lists the supported formats', () => {
    open()
    expect(screen.getByText(/Supported formats: PDF, Word, Excel\./)).toBeInTheDocument()
  })

  it('queues several files and uploads them one at a time', async () => {
    /*
     * Sequential rather than parallel: several 100 MB uploads at once would
     * saturate the connection and make every progress bar meaningless, and
     * the per-Space quota check only stays meaningful if each upload sees the
     * previous one's bytes.
     */
    open()
    const input = document.querySelector('#document-upload-input')
    fireEvent.change(input, { target: { files: [file('a.pdf'), file('b.pdf')] } })

    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(screen.getByText('b.pdf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Upload 2 files/ }))
    await waitFor(() => expect(FakeXHR.instances.length).toBe(1))
    FakeXHR.instances[0].finish()
    await waitFor(() => expect(FakeXHR.instances.length).toBe(2))
  })

  it('offers Cancel only while a file is in flight', async () => {
    open()
    const input = document.querySelector('#document-upload-input')
    fireEvent.change(input, { target: { files: [file('a.pdf')] } })
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Upload 1 file/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument())
  })

  it('shows the server error against the file it belongs to', async () => {
    open()
    const input = document.querySelector('#document-upload-input')
    fireEvent.change(input, { target: { files: [file('big.pdf')] } })
    fireEvent.click(screen.getByRole('button', { name: /Upload 1 file/ }))

    await waitFor(() => expect(FakeXHR.instances.length).toBe(1))
    FakeXHR.instances[0].finish({
      status: 413,
      responseText: JSON.stringify({
        error: 'File size exceeds the maximum allowed limit of 100 MB. Please select a smaller file.',
      }),
    })
    expect(await screen.findByText(/exceeds the maximum allowed limit of 100 MB/)).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * formatBytes
 * ---------------------------------------------------------------- */
describe('JL-164 formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2.0 KB'],
    [1024 * 1024 * 4.2, '4.2 MB'],
    [100 * 1024 * 1024, '100 MB'],
    [10 * 1024 * 1024 * 1024, '10 GB'],
  ])('formats %i as %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected)
  })

  it('drops the decimal above 10 so a column of sizes lines up', () => {
    expect(formatBytes(11.4 * 1024 * 1024)).toBe('11 MB')
  })
})
