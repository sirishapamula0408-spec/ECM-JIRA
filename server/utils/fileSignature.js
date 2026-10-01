/*
 * JL-164 — magic-byte sniffing for uploaded documents.
 *
 * Spec section 12: never trust the file extension alone. With multipart the
 * filename AND the Content-Type both come straight from the client, so both
 * are trivially forged; the first bytes of the file are the only part of an
 * upload the uploader cannot relabel.
 *
 * Deliberately NOT a full content-type detector. It answers one question —
 * "do the leading bytes contradict the claimed extension?" — for the formats
 * that have a stable signature. Text formats (txt, csv, json, xml, yaml, sql,
 * log, md, svg) have none, so they are unverifiable here by definition and
 * pass; they are also the formats that are served as text/plain and can
 * therefore do the least harm.
 */

/** Signatures, as byte arrays at a fixed offset. */
const SIGNATURES = [
  { id: 'pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { id: 'png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { id: 'jpg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { id: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  { id: 'webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // 'WEBP' after RIFF....
  { id: '7z', offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  // PK\x03\x04 — a plain zip AND every OOXML office format, which are zips.
  { id: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  // Legacy OLE compound file: .doc, .xls, .ppt.
  { id: 'ole', offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
]

/**
 * Which signature, if any, the buffer's leading bytes match.
 * @returns {string|null} the signature id, or null when nothing matched
 */
export function detectSignature(buffer) {
  if (!buffer || buffer.length < 4) return null
  for (const sig of SIGNATURES) {
    const end = sig.offset + sig.bytes.length
    if (buffer.length < end) continue
    let match = true
    for (let i = 0; i < sig.bytes.length; i += 1) {
      if (buffer[sig.offset + i] !== sig.bytes[i]) { match = false; break }
    }
    if (match) return sig.id
  }
  return null
}

/*
 * What each extension's bytes are allowed to look like.
 *
 * The OOXML formats are zip archives, so "docx" legitimately sniffs as `zip`
 * — treating that as a mismatch would reject every real Word document. An
 * extension absent from this map is one with no signature to check.
 */
const EXPECTED = {
  pdf: ['pdf'],
  png: ['png'],
  jpg: ['jpg'],
  jpeg: ['jpg'],
  gif: ['gif'],
  webp: ['webp'],
  zip: ['zip'],
  '7z': ['7z'],
  docx: ['zip'],
  xlsx: ['zip'],
  pptx: ['zip'],
  doc: ['ole'],
  xls: ['ole'],
  ppt: ['ole'],
}

/**
 * Do the leading bytes contradict the claimed extension?
 *
 * Returns null when acceptable, or a rejection message. An unknown signature
 * on a checkable extension is a mismatch: a .pdf whose bytes are not a PDF is
 * exactly the case this exists to catch.
 *
 * @param {Buffer} head       the first bytes of the file
 * @param {string} extension  the claimed extension, without a dot
 */
export function signatureMismatch(head, extension) {
  const ext = String(extension || '').toLowerCase()
  const expected = EXPECTED[ext]
  // No signature defined for this type — nothing to contradict.
  if (!expected) return null

  const found = detectSignature(head)
  if (found && expected.includes(found)) return null

  return `The contents of this file do not match its ".${ext}" extension. `
    + 'The file may be corrupt or renamed.'
}

export { SIGNATURES, EXPECTED }
