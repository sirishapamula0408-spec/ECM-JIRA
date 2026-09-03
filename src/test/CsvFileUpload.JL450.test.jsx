// JL-450 — CSV file upload for import.
//
// Before this, the ONLY way to get CSV into the app was pasting into a
// textarea, even though the app does file upload in three other places
// (attachments, profile avatar, team avatar). Import was the outlier.
//
// The server needed no change: it takes `{ csv }` as a JSON string and cannot
// tell a pasted string from a read one. So the whole feature is client-side,
// and these tests cover the part that can actually go wrong — reading the file.
//
// The encoding cases are not hypothetical. A CSV that comes out of Excel is the
// normal case here, and Excel is exactly where UTF-16 and semicolon separators
// come from. Both previously failed with "title is required" on every row,
// which tells the user nothing.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readCsvFile, CsvReadError, MAX_CSV_BYTES } from '../api/importExportApi'

vi.mock('../api/client.js', () => ({ api: vi.fn() }))

/** A File whose bytes are exactly what the test wants, encoding included. */
const fileOf = (bytes, name = 'issues.csv') =>
  new File([bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes)], name, { type: 'text/csv' })

describe('JL-450 — readCsvFile', () => {
  it('reads a plain UTF-8 CSV to text', async () => {
    const csv = 'title,priority\nFix login,High\n'
    await expect(readCsvFile(fileOf(csv))).resolves.toBe(csv)
  })

  it('accepts a UTF-8 BOM rather than choking on it', async () => {
    // A BOM is NOT a problem and must not be "fixed": U+FEFF is whitespace to
    // String.prototype.trim, and the server trims its headers
    // (importExport.js). Excel's "CSV UTF-8" always writes one, so rejecting it
    // would reject the most common export in the world.
    const withBom = '﻿title,priority\nFix login,High\n'
    const text = await readCsvFile(fileOf(withBom))
    expect(text.split(/\r?\n/)[0].trim()).toBe('title,priority')
  })

  it('rejects UTF-16 with an instruction, not a parse failure', async () => {
    // Excel's "Unicode Text (*.txt)" is UTF-16LE. readAsText assumes UTF-8 and
    // returns NUL-interleaved garbage; every row then fails validation with a
    // message that explains nothing.
    const utf16le = new Uint8Array([0xff, 0xfe, 0x74, 0x00, 0x69, 0x00, 0x74, 0x00])
    await expect(readCsvFile(fileOf(utf16le))).rejects.toThrow(/UTF-16/i)
    await expect(readCsvFile(fileOf(utf16le))).rejects.toBeInstanceOf(CsvReadError)
  })

  it('catches semicolon-separated CSV, which would otherwise fail every row', async () => {
    // The server's parser splits on "," only. European Excel locales export
    // with ";", so the whole line becomes one column and every row reports
    // "title is required" with no clue why.
    await expect(readCsvFile(fileOf('title;priority\nFix login;High\n')))
      .rejects.toThrow(/semicolon/i)
  })

  it('allows a semicolon INSIDE a comma-separated file', async () => {
    // Only the separator matters. A description containing a semicolon is fine
    // and must not trip the check.
    const csv = 'title,description\nFix login,"first; second"\n'
    await expect(readCsvFile(fileOf(csv))).resolves.toBe(csv)
  })

  it('rejects an empty file', async () => {
    await expect(readCsvFile(fileOf('   \n'))).rejects.toThrow(/empty/i)
  })

  it('rejects a file over the size cap, and says the limit', async () => {
    const big = fileOf('title\n')
    Object.defineProperty(big, 'size', { value: MAX_CSV_BYTES + 1 })
    await expect(readCsvFile(big)).rejects.toThrow(/limit is 2MB/i)
  })

  it('rejects no file at all rather than throwing something opaque', async () => {
    await expect(readCsvFile(null)).rejects.toBeInstanceOf(CsvReadError)
  })
})

describe('JL-450 — the modal exposes the file route', () => {
  // Imported lazily so the api mock above is in place first.
  async function renderModal(props = {}) {
    const { ImportExportModal } = await import('../components/issues/ImportExportModal')
    return render(<ImportExportModal projectId={1} onClose={vi.fn()} initialTab="import" {...props} />)
  }

  it('offers a file picker on the Import tab', async () => {
    const { container } = await renderModal()
    expect(screen.getByRole('button', { name: /choose csv file/i })).toBeInTheDocument()
    const input = container.querySelector('input[type="file"]')
    expect(input).toBeTruthy()
    // Scoped to CSV so the picker does not offer every file on the machine.
    expect(input.getAttribute('accept')).toContain('.csv')
  })

  it('keeps the paste textarea — the file is an addition, not a replacement', async () => {
    const { container } = await renderModal()
    expect(container.querySelector('.ie-textarea')).toBeTruthy()
  })

  it('hides the whole import section from a Viewer', async () => {
    // JL-288 gates import on canCreateIssue. A file picker must not become a
    // way around that.
    const { container } = await renderModal({ canImport: false })
    expect(screen.queryByRole('button', { name: /choose csv file/i })).toBeNull()
    expect(container.querySelector('input[type="file"]')).toBeNull()
  })

  it('loads a dropped file into the textarea', async () => {
    const { container } = await renderModal()
    const body = container.querySelector('.ie-body')
    const file = fileOf('title,priority\nDropped issue,High\n')
    fireEvent.drop(body, { dataTransfer: { files: [file], types: ['Files'] } })
    await waitFor(() => {
      expect(container.querySelector('.ie-textarea').value).toContain('Dropped issue')
    })
    expect(screen.getByText(/Loaded: issues\.csv/)).toBeInTheDocument()
  })

  it('surfaces a read failure as a message instead of silently doing nothing', async () => {
    const { container } = await renderModal()
    const body = container.querySelector('.ie-body')
    fireEvent.drop(body, {
      dataTransfer: { files: [fileOf('title;priority\na;b\n')], types: ['Files'] },
    })
    await waitFor(() => {
      expect(screen.getByText(/semicolon/i)).toBeInTheDocument()
    })
    expect(container.querySelector('.ie-textarea').value).toBe('')
  })
})
