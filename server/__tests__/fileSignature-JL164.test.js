// @vitest-environment node
/* ================================================================
   JL-164 — magic-byte sniffing.

   Spec section 12: never trust the extension alone. With multipart
   the filename AND the Content-Type are both client-supplied
   strings, so the leading bytes are the only part of an upload the
   uploader cannot simply relabel.

   The two assertions that matter pull in opposite directions:
   a renamed executable must be caught, and a real .docx must NOT be
   — OOXML files are zip archives, so a naive "docx must not look
   like a zip" rule would reject every genuine Word document.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import { detectSignature, signatureMismatch } from '../utils/fileSignature.js'

const bytes = (...b) => Buffer.from(b)
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
// MZ — a Windows PE executable.
const PE = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00)

describe('JL-164 detectSignature', () => {
  it.each([
    ['pdf', PDF], ['png', PNG], ['zip', ZIP], ['ole', OLE],
  ])('recognises %s', (id, buf) => {
    expect(detectSignature(buf)).toBe(id)
  })

  it('recognises webp, whose marker is offset past RIFF', () => {
    const webp = Buffer.concat([
      bytes(0x52, 0x49, 0x46, 0x46), bytes(0x00, 0x00, 0x00, 0x00),
      bytes(0x57, 0x45, 0x42, 0x50),
    ])
    expect(detectSignature(webp)).toBe('webp')
  })

  it('returns null for text, which has no signature', () => {
    expect(detectSignature(Buffer.from('id,name\n1,a\n'))).toBeNull()
  })

  it('returns null for a buffer too short to identify', () => {
    expect(detectSignature(bytes(0x25))).toBeNull()
    expect(detectSignature(Buffer.alloc(0))).toBeNull()
  })
})

describe('JL-164 signatureMismatch', () => {
  it('catches an executable renamed to .pdf', () => {
    // The case the check exists for.
    expect(signatureMismatch(PE, 'pdf')).toMatch(/do not match its "\.pdf" extension/)
  })

  it('catches a .png that is not a PNG', () => {
    expect(signatureMismatch(PDF, 'png')).toBeTruthy()
  })

  it('accepts a genuine PDF and a genuine PNG', () => {
    expect(signatureMismatch(PDF, 'pdf')).toBeNull()
    expect(signatureMismatch(PNG, 'png')).toBeNull()
  })

  it('accepts OOXML files, which legitimately ARE zips', () => {
    /*
     * docx/xlsx/pptx are zip containers. Treating "docx looks like a zip" as
     * a mismatch would reject every real Word, Excel and PowerPoint file —
     * a check that rejects the format it is meant to protect is worse than
     * no check.
     */
    for (const ext of ['docx', 'xlsx', 'pptx', 'zip']) {
      expect(signatureMismatch(ZIP, ext), ext).toBeNull()
    }
  })

  it('accepts legacy Office files, which are OLE containers', () => {
    for (const ext of ['doc', 'xls', 'ppt']) {
      expect(signatureMismatch(OLE, ext), ext).toBeNull()
    }
  })

  it('passes formats with no signature to check', () => {
    // txt, csv, json, xml, yaml, sql, log, svg are unverifiable by definition.
    for (const ext of ['txt', 'csv', 'json', 'xml', 'yaml', 'sql', 'log', 'svg']) {
      expect(signatureMismatch(Buffer.from('anything at all'), ext), ext).toBeNull()
    }
  })

  it('treats an UNRECOGNISED header on a checkable type as a mismatch', () => {
    // A .pdf whose bytes are not a PDF is exactly the case this catches; an
    // allowlist that only rejected *known* bad headers would miss it.
    expect(signatureMismatch(Buffer.from('not a pdf at all'), 'pdf')).toBeTruthy()
  })
})
